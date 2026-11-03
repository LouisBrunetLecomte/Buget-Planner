import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from './client'
import { account, budgetException, budgetLine, category, recurring, transaction, transactionSplit } from './schema'
import { balances, cachedRates, getSetting, listCategories, putSetting, transferSuggestions } from './repo'
import { normalizeLabel } from '@/core/labels'
import { addDays, addMonths, endOfMonth } from '@/core/dates'
import { rateOn } from '@/core/fx'
import { detectRecurring, matchOccurrences, monthlyEquivalent, occurrences, priceIncrease, type MatchTx, type Suggestion } from '@/core/recurring'
import { applyScope, computeBudget, type Actuals, type Scope } from '@/core/budget'

export type Recurring = typeof recurring.$inferSelect
const now = sql`(datetime('now'))`

// ---------- récurrences ----------
export const listRecurring = (db: Db) => db.select().from(recurring).orderBy(recurring.kind, recurring.name).all()
export const createRecurring = (db: Db, v: typeof recurring.$inferInsert) => db.insert(recurring).values(v).returning().get()
export const updateRecurring = (db: Db, id: string, v: Partial<typeof recurring.$inferInsert>) =>
  db.update(recurring).set({ ...v, updatedAt: now }).where(eq(recurring.id, id)).run()
export const deleteRecurring = (db: Db, id: string) => db.delete(recurring).where(eq(recurring.id, id)).run()

/** Opérations qui correspondent à une récurrence : même motif, même sens, même compte si précisé. */
function matchingTxs(db: Db, r: Recurring): MatchTx[] {
  if (!r.pattern) return []
  const p = normalizeLabel(r.pattern)
  return db.select({ id: transaction.id, date: transaction.date, amountEur: transaction.amountEur, labelNorm: transaction.labelNorm, accountId: transaction.accountId })
    .from(transaction).where(and(isNull(transaction.transferGroupId), r.amount < 0 ? sql`${transaction.amountEur} < 0` : sql`${transaction.amountEur} > 0`)).all()
    .filter((t) => t.labelNorm.includes(p) && (!r.accountId || t.accountId === r.accountId))
}

export interface Occurrence { recurring: Recurring; date: string; paid: MatchTx | null }

/** Échéances de toutes les récurrences actives entre deux dates, avec l'opération qui les a réglées. */
export function occurrencesBetween(db: Db, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = []
  for (const r of listRecurring(db).filter((x) => x.active)) {
    const dates = occurrences(r, from, to)
    const paid = matchOccurrences(dates, matchingTxs(db, r), r)
    for (const d of dates) out.push({ recurring: r, date: d, paid: paid.get(d) ?? null })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Prochaine échéance à partir d'aujourd'hui, en sautant celle déjà réglée (prélèvement en avance ou du jour). */
function nextUnpaid(r: Recurring, txs: MatchTx[], today: string): string | null {
  const dates = occurrences(r, today, addDays(today, 800)).slice(0, 2)
  const paid = matchOccurrences(dates, txs.filter((t) => t.date >= addDays(today, -6)), r)
  return dates.find((d) => !paid.has(d)) ?? null
}

export interface RecurringStatus {
  r: Recurring; next: string | null; monthly: number; lastPaid: MatchTx | null
  increase: ReturnType<typeof priceIncrease>; missed: string[] // échéances passées non retrouvées (30 derniers jours)
}
export function recurringStatus(db: Db, today: string): RecurringStatus[] {
  return listRecurring(db).map((r) => {
    const txs = matchingTxs(db, r).sort((a, b) => a.date.localeCompare(b.date))
    const past = occurrences(r, addDays(today, -30), addDays(today, -3))
    const paid = matchOccurrences(past, txs, r)
    return {
      r, next: nextUnpaid(r, txs, today), monthly: monthlyEquivalent(r, r.amount),
      lastPaid: txs.at(-1) ?? null, increase: priceIncrease(txs), missed: r.pattern && r.active ? past.filter((d) => !paid.has(d)) : [],
    }
  })
}

/** Récurrences détectées dans les 13 derniers mois et pas encore suivies. */
export function recurringSuggestions(db: Db, today: string): (Suggestion & { kind: Recurring['kind'] })[] {
  // les virements internes en attente de confirmation ne sont pas des charges
  const pending = new Set(transferSuggestions(db).flatMap(([a, c]) => [a.id, c.id]))
  const txs = db.select().from(transaction).where(and(isNull(transaction.transferGroupId), gte(transaction.date, addDays(today, -400)))).all().filter((t) => !pending.has(t.id))
  // déjà suivie si l'un des motifs contient l'autre ("NETFLIX" suivi ⇒ "NETFLIX COM" ignoré)
  const known = listRecurring(db).flatMap((r) => (r.pattern ? [normalizeLabel(r.pattern)] : []))
  const ignored = new Set(getSetting<string[]>(db, 'ignoredRecurring') ?? [])
  const cats = listCategories(db), abo = cats.find((c) => c.name === 'Abonnements' && !c.parentId)?.id
  return detectRecurring(txs, today)
    .filter((s) => !known.some((k) => s.pattern.includes(k) || k.includes(s.pattern)) && !ignored.has(s.pattern))
    .map((s) => {
      const c = cats.find((x) => x.id === s.categoryId)
      return { ...s, kind: s.amount > 0 ? 'revenu' : c && (c.id === abo || c.parentId === abo) ? 'abonnement' : 'charge' }
    })
}
export const ignoreSuggestion = (db: Db, pattern: string) =>
  putSetting(db, 'ignoredRecurring', [...(getSetting<string[]>(db, 'ignoredRecurring') ?? []), pattern])

// ---------- réel par mois ----------
/** Somme signée en EUR par mois et catégorie (ventilations comprises, virements internes exclus). */
export function actualsBetween(db: Db, from: string, to: string): Actuals {
  const range = and(gte(transaction.date, `${from}-01`), lte(transaction.date, endOfMonth(to)), isNull(transaction.transferGroupId))
  const plain = db.select({ m: sql<string>`substr(${transaction.date}, 1, 7)`, c: sql<string>`coalesce(${transaction.categoryId}, '')`, s: sql<number>`sum(${transaction.amountEur})` })
    .from(transaction).where(and(range, sql`not exists (select 1 from ${transactionSplit} where ${transactionSplit.transactionId} = ${transaction.id})`))
    .groupBy(sql`1`, sql`2`).all()
  // part en EUR d'une ventilation = part × (montant EUR / montant d'origine)
  const splits = db.select({ m: sql<string>`substr(${transaction.date}, 1, 7)`, c: transactionSplit.categoryId,
    s: sql<number>`sum(round(${transactionSplit.amount} * 1.0 * ${transaction.amountEur} / ${transaction.amount}))` })
    .from(transactionSplit).innerJoin(transaction, eq(transaction.id, transactionSplit.transactionId)).where(range)
    .groupBy(sql`1`, sql`2`).all()
  const out: Actuals = new Map()
  for (const r of [...plain, ...splits]) {
    const m = out.get(r.m) ?? new Map<string, number>()
    m.set(r.c, (m.get(r.c) ?? 0) + r.s)
    out.set(r.m, m)
  }
  return out
}

// ---------- budget ----------
const START = 'budgetStart'
export const budgetStart = (db: Db) => getSetting<string>(db, START) ?? null

/** Budget de `from` à `to`, report calculé depuis le début du budget. */
export function getBudget(db: Db, from: string, to: string) {
  const start = budgetStart(db) ?? from
  const first = start < from ? start : from
  const cats = listCategories(db)
  const months = computeBudget(cats, db.select().from(budgetLine).all(), db.select().from(budgetException).all(), actualsBetween(db, first, to), first, to)
  return months.filter((m) => m.month >= from)
}

/**
 * Modifie le budget d'une catégorie selon la portée :
 * "month" = exception pour ce mois seulement ; "from" = à partir de ce mois ; "all" = tous les mois.
 */
export function setBudget(db: Db, categoryId: string, month: string, amount: number, scope: Scope, reason?: string | null) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('Montant invalide')
  db.transaction((t) => {
    const tdb = t as unknown as Db
    const start = budgetStart(tdb)
    if (!start || month < start) putSetting(tdb, START, month)
    if (scope === 'month') {
      t.insert(budgetException).values({ categoryId, month, amount, reason: reason?.trim() || null })
        .onConflictDoUpdate({ target: [budgetException.categoryId, budgetException.month], set: { amount, reason: reason?.trim() || null, updatedAt: now } }).run()
      return
    }
    const lines = t.select().from(budgetLine).where(eq(budgetLine.categoryId, categoryId)).all()
    t.delete(budgetLine).where(eq(budgetLine.categoryId, categoryId)).run()
    for (const l of applyScope(lines, categoryId, month, amount, scope)) t.insert(budgetLine).values(l).run()
    // l'exception de ce mois deviendrait trompeuse : la nouvelle valeur s'applique
    t.delete(budgetException).where(and(eq(budgetException.categoryId, categoryId), eq(budgetException.month, month))).run()
  })
}
export const removeException = (db: Db, id: string) => db.delete(budgetException).where(eq(budgetException.id, id)).run()
export function removeBudget(db: Db, categoryId: string) {
  db.delete(budgetLine).where(eq(budgetLine.categoryId, categoryId)).run()
  db.delete(budgetException).where(eq(budgetException.categoryId, categoryId)).run()
}
export const setCategoryOptions = (db: Db, id: string, v: { rollover?: boolean; bucket?: 'besoin' | 'envie' | null }) =>
  db.update(category).set({ ...v, updatedAt: now }).where(eq(category.id, id)).run()

/**
 * Premier budget proposé : moyenne des 3 derniers mois complets par catégorie principale (arrondie à 10 € au-dessus),
 * plus la provision mensuelle des charges annuelles non vues sur la période.
 */
export function suggestBudget(db: Db, month: string): { categoryId: string; amount: number }[] {
  const cats = listCategories(db), root = (id: string) => { const c = cats.find((x) => x.id === id); return c?.parentId ?? c?.id }
  const from = addMonths(month, -3), to = addMonths(month, -1)
  const sums = new Map<string, number>()
  for (const [, m] of actualsBetween(db, from, to)) for (const [c, s] of m) {
    const r = c && root(c)
    if (r) sums.set(r, (sums.get(r) ?? 0) + s)
  }
  for (const r of listRecurring(db).filter((x) => x.active && x.freq === 'year' && x.categoryId)) {
    const seen = occurrences(r, `${from}-01`, endOfMonth(to)).length
    if (!seen) { const k = root(r.categoryId!)!; sums.set(k, (sums.get(k) ?? 0) + monthlyEquivalent(r, r.amount) * 3) }
  }
  const out: { categoryId: string; amount: number }[] = []
  for (const [id, s] of sums) {
    const c = cats.find((x) => x.id === id)
    if (!c || c.kind === 'transfert') continue
    const avg = Math.abs(s) / 3
    if (avg >= 500) out.push({ categoryId: id, amount: Math.ceil(avg / 1000) * 1000 })
  }
  return out
}

/** Solde des comptes disponibles au quotidien (courant, carte, espèces), en EUR. */
export function liquidBalance(db: Db): number {
  const b = balances(db)
  return db.select().from(account).where(eq(account.archived, false)).all()
    .filter((a) => a.type === 'courant' || a.type === 'carte' || a.type === 'especes')
    .reduce((s, a) => s + (a.currency === 'EUR' ? b.get(a.id)! : Math.round(b.get(a.id)! * (rateOn(cachedRates(db, a.currency), '9999') ?? 0))), 0)
}

/** Solde total EUR de tous les comptes actifs. */
export function totalBalance(db: Db): number {
  const b = balances(db)
  return db.select().from(account).where(eq(account.archived, false)).all()
    .reduce((s, a) => s + (a.currency === 'EUR' ? b.get(a.id)! : Math.round(b.get(a.id)! * (rateOn(cachedRates(db, a.currency), '9999') ?? 0))), 0)
}

