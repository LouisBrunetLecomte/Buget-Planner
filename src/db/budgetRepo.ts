import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from './client'
import { account, budgetException, budgetLine, category, recurring, transaction, transactionSplit } from './schema'
import { balances, cachedRates, getSetting, listCategories, putSetting, transferSuggestions } from './repo'
import { normalizeLabel } from '@/core/labels'
import { addDays, addMonths, daysInMonth, endOfMonth, monthOf } from '@/core/dates'
import { periodEnd, periodLabel, periodOf, periodStart } from '@/core/period'
import { rateOn } from '@/core/fx'
import { detectRecurring, matchOccurrences, monthlyEquivalent, occurrences, priceIncrease, type MatchTx, type Suggestion } from '@/core/recurring'
import { applyScope, computeBudget, resteAVivre, type Actuals, type PlannedItem, type RecurringPlan, type Scope } from '@/core/budget'

export type Recurring = typeof recurring.$inferSelect
const now = sql`(datetime('now'))`

// ---------- récurrences ----------
export const listRecurring = (db: Db) => db.select().from(recurring).orderBy(recurring.kind, recurring.name).all()
export const createRecurring = (db: Db, v: typeof recurring.$inferInsert) => db.insert(recurring).values(v).returning().get()
export const updateRecurring = (db: Db, id: string, v: Partial<typeof recurring.$inferInsert>) =>
  db.update(recurring).set({ ...v, updatedAt: now }).where(eq(recurring.id, id)).run()
export const deleteRecurring = (db: Db, id: string) => db.delete(recurring).where(eq(recurring.id, id)).run()

/**
 * Modifie une échéance « à partir d'un mois » sans réécrire le passé : l'ancienne s'arrête le mois précédent,
 * une copie modifiée prend le relais. Si le mois est celui du début (ou avant), modification sur place.
 */
export function updateRecurringFrom(db: Db, id: string, fromMonth: string, patch: { amount?: number; day?: number; name?: string }) {
  const r = db.select().from(recurring).where(eq(recurring.id, id)).get()
  if (!r) throw new Error('Échéance introuvable')
  const clamp = (m: string, d: number) => `${m}-${String(Math.min(d, daysInMonth(m))).padStart(2, '0')}`
  const v = {
    ...(patch.amount !== undefined ? { amount: patch.amount } : {}), ...(patch.name ? { name: patch.name } : {}),
    ...(patch.day ? { dayOfMonth: patch.day } : {}),
  }
  if (fromMonth <= monthOf(r.startDate))
    return db.update(recurring).set({ ...v, ...(patch.day ? { startDate: clamp(monthOf(r.startDate), patch.day) } : {}), updatedAt: now }).where(eq(recurring.id, id)).run()
  const next = occurrences(r, `${fromMonth}-01`, addDays(`${fromMonth}-01`, 800))[0]
  if (!next) throw new Error('Plus aucune échéance après cette date')
  db.update(recurring).set({ endDate: endOfMonth(addMonths(fromMonth, -1)), updatedAt: now }).where(eq(recurring.id, id)).run()
  const { id: _old, createdAt: _c, updatedAt: _u, ...copy } = r
  void _old; void _c; void _u
  return db.insert(recurring).values({ ...copy, ...v, startDate: patch.day ? clamp(monthOf(next), patch.day) : next }).returning().get()
}

/** Échéances datées de chaque mois, rangées par catégorie : elles alimentent directement le budget. */
export function recurringPlan(db: Db, from: string, to: string): RecurringPlan {
  const plan: RecurringPlan = new Map(), day = periodDay(db), refs = pointed(db)
  for (const r of listRecurring(db).filter((x) => x.active && x.categoryId)) {
    const dates = occurrences(r, periodStart(from, day), periodEnd(to, day))
    const paid = paidFor(db, r, dates, refs)
    for (const date of dates) {
      const k = periodOf(date, day)
      const m = plan.get(k) ?? new Map<string, PlannedItem[]>()
      m.set(r.categoryId!, [...(m.get(r.categoryId!) ?? []), { id: r.id, name: r.name, date, amount: r.amount, paid: paid.has(date) }])
      plan.set(k, m)
    }
  }
  return plan
}

/**
 * Reste à vivre de la période en cours, détaillé : solde des comptes courants + à recevoir − charges datées à payer
 * − enveloppes pas encore dépensées − échéances hors budget (sans catégorie, virements d'épargne…).
 */
export function resteAVivreFor(db: Db, today: string) {
  const cur = currentPeriod(db, today), { start, end } = periodBounds(db, cur)
  const m = getBudget(db, cur, cur)[0]!
  const cats = listCategories(db)
  let incoming = 0, dated = 0, envelopes = 0
  for (const r of m.rows) {
    if (r.kind === 'revenu') incoming += r.toCome
    else if (r.items.length && !r.exception) dated += r.toCome
    else envelopes += r.toCome
  }
  // échéances qui ne passent pas par le budget : sans catégorie, ou vers l'épargne (catégorie de transfert)
  let other = 0
  for (const o of occurrencesBetween(db, start, end)) {
    const c = cats.find((x) => x.id === o.recurring.categoryId)
    if (!o.paid && (!c || c.kind === 'transfert')) other += o.recurring.amount
  }
  const liquid = liquidBalance(db)
  const r = resteAVivre(liquid, incoming + Math.max(0, other), dated + envelopes + Math.max(0, -other), today, end)
  return { ...r, liquid, incoming: incoming + Math.max(0, other), dated: dated + Math.max(0, -other), envelopes, end, day: periodDay(db), proratedFrom: m.proratedFrom ?? null }
}

/** Opérations qui correspondent à une récurrence : même motif, même sens, même compte si précisé. */
function matchingTxs(db: Db, r: Recurring): MatchTx[] {
  if (!r.pattern) return []
  const p = normalizeLabel(r.pattern)
  return db.select({ id: transaction.id, date: transaction.date, amountEur: transaction.amountEur, labelNorm: transaction.labelNorm, accountId: transaction.accountId })
    .from(transaction).where(and(isNull(transaction.transferGroupId), r.amount < 0 ? sql`${transaction.amountEur} < 0` : sql`${transaction.amountEur} > 0`)).all()
    .filter((t) => t.labelNorm.includes(p) && (!r.accountId || t.accountId === r.accountId))
}

export interface Occurrence { recurring: Recurring; date: string; paid: MatchTx | null }

/** Opérations pointées depuis le budget, par référence (rec:<échéance>:<date> ou line:<catégorie>:<période>). */
export function pointed(db: Db): Map<string, MatchTx & { ref: string }> {
  return new Map(db.select({ id: transaction.id, date: transaction.date, amountEur: transaction.amountEur, ref: transaction.plannedRef })
    .from(transaction).where(sql`${transaction.plannedRef} is not null`).all().map((t) => [t.ref!, { ...t, ref: t.ref! }]))
}
export const occurrenceRef = (recurringId: string, date: string) => `rec:${recurringId}:${date}`
export const lineRef = (categoryId: string, period: string) => `line:${categoryId}:${period}`

/** Échéance réglée : cochée à la main, ou retrouvée dans les opérations importées (motif du libellé, ±6 jours). */
function paidFor(db: Db, r: Recurring, dates: string[], refs = pointed(db)): Map<string, MatchTx> {
  const out = new Map<string, MatchTx>()
  const used = new Set([...refs.values()].map((t) => t.id))
  const auto = matchOccurrences(dates.filter((d) => !refs.has(occurrenceRef(r.id, d))), matchingTxs(db, r).filter((t) => !used.has(t.id)), r)
  // avant le premier jour d'utilisation (date du solde saisi), tout est déjà dans le solde : considéré comme réglé
  const started = appStart(db)
  for (const d of dates) {
    const t = refs.get(occurrenceRef(r.id, d)) ?? auto.get(d) ?? (started && d < started ? { id: 'avant-buget', date: d, amountEur: 0 } : undefined)
    if (t) out.set(d, t)
  }
  return out
}

export interface Occurrence { recurring: Recurring; date: string; paid: MatchTx | null; ticked: boolean }

/** Échéances de toutes les récurrences actives entre deux dates, avec l'opération qui les a réglées. */
export function occurrencesBetween(db: Db, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [], refs = pointed(db)
  for (const r of listRecurring(db).filter((x) => x.active)) {
    const dates = occurrences(r, from, to)
    const paid = paidFor(db, r, dates, refs)
    for (const d of dates) out.push({ recurring: r, date: d, paid: paid.get(d) ?? null, ticked: refs.has(occurrenceRef(r.id, d)) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ---------- pointage : « c'est payé / reçu » ----------
function defaultAccount(db: Db, preferred: string | null) {
  const accs = db.select().from(account).where(eq(account.archived, false)).all()
  const a = accs.find((x) => x.id === preferred) ?? accs.find((x) => x.type === 'courant' && x.currency === 'EUR') ?? accs.find((x) => x.currency === 'EUR')
  if (!a) throw new Error('Crée d’abord un compte en euros (onglet Comptes) : c’est là que le montant sera enregistré.')
  return a
}

/**
 * Coche une échéance : enregistre l'opération réelle (montant prévu, ou celui saisi) sur le compte de l'échéance.
 * Date : celle de l'échéance, ou aujourd'hui si on coche en avance. Elle compte quand même pour la période de l'échéance.
 */
export function tickOccurrence(db: Db, recurringId: string, date: string, today: string, amount?: number) {
  const r = db.select().from(recurring).where(eq(recurring.id, recurringId)).get()
  if (!r) throw new Error('Échéance introuvable')
  const ref = occurrenceRef(r.id, date)
  if (pointed(db).has(ref)) return
  const acc = defaultAccount(db, r.accountId)
  db.insert(transaction).values({ accountId: acc.id, date: date > today ? today : date, amount: amount ?? r.amount, currency: 'EUR', amountEur: amount ?? r.amount,
    label: r.name, labelNorm: normalizeLabel(r.name), categoryId: r.categoryId, plannedRef: ref }).run()
}

/** Coche une ligne de budget sans date (courses, sorties…) : le montant indiqué est enregistré comme payé pour la période. */
export function tickLine(db: Db, categoryId: string, period: string, amount: number, today: string) {
  const ref = lineRef(categoryId, period)
  if (pointed(db).has(ref)) return
  if (!Number.isInteger(amount) || amount === 0) throw new Error('Montant invalide')
  const cat = listCategories(db).find((c) => c.id === categoryId)
  if (!cat) throw new Error('Catégorie introuvable')
  const acc = defaultAccount(db, null)
  const { start, end } = { start: periodStart(period, periodDay(db)), end: periodEnd(period, periodDay(db)) }
  if (start > today) throw new Error('Cette période n’a pas encore commencé.')
  const date = today > end ? end : today
  const signed = cat.kind === 'revenu' ? Math.abs(amount) : -Math.abs(amount)
  db.insert(transaction).values({ accountId: acc.id, date, amount: signed, currency: 'EUR', amountEur: signed,
    label: cat.name, labelNorm: normalizeLabel(cat.name), categoryId, plannedRef: ref }).run()
}

/** Décoche : l'opération créée par le pointage est supprimée, tout revient comme avant. */
export const untick = (db: Db, ref: string) => db.delete(transaction).where(eq(transaction.plannedRef, ref)).run()

/** Prochaine échéance à partir d'aujourd'hui, en sautant celle déjà réglée (cochée, ou prélevée en avance). */
function nextUnpaid(db: Db, r: Recurring, today: string): string | null {
  const dates = occurrences(r, today, addDays(today, 800)).slice(0, 2)
  const paid = paidFor(db, r, dates)
  return dates.find((d) => !paid.has(d)) ?? null
}

export interface RecurringStatus {
  r: Recurring; next: string | null; monthly: number; lastPaid: MatchTx | null
  increase: ReturnType<typeof priceIncrease>; missed: string[] // échéances passées (30 derniers jours) ni cochées ni retrouvées dans les opérations
}
export function recurringStatus(db: Db, today: string): RecurringStatus[] {
  return listRecurring(db).map((r) => {
    const txs = matchingTxs(db, r).sort((a, b) => a.date.localeCompare(b.date))
    const past = occurrences(r, addDays(today, -30), addDays(today, -3))
    const paid = paidFor(db, r, past)
    return {
      r, next: nextUnpaid(db, r, today), monthly: monthlyEquivalent(r, r.amount),
      lastPaid: txs.at(-1) ?? null, increase: priceIncrease(txs), missed: r.active ? past.filter((d) => !paid.has(d)) : [], // passées, ni cochées ni retrouvées
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

// ---------- période budgétaire (d'une paie à l'autre) ----------
/** Jour de paie : celui du salaire (échéance mensuelle de la catégorie « Salaire », sinon le plus gros revenu mensuel). */
export function salaryDay(db: Db): number | null {
  const cats = listCategories(db), sal = cats.find((c) => c.name === 'Salaire')?.id
  const revs = listRecurring(db).filter((r) => r.active && r.kind === 'revenu' && r.freq === 'month' && r.interval === 1 && (!r.endDate || r.endDate >= new Date().toISOString().slice(0, 10)))
  const r = revs.find((x) => x.categoryId === sal) ?? [...revs].sort((a, b) => b.amount - a.amount)[0]
  return r ? (r.dayOfMonth ?? Number(r.startDate.slice(8, 10))) : null
}
/** Réglage « mois budgétaire » : 'auto' (jour du salaire, par défaut) ou un jour fixe (1 = mois calendaires). */
export const periodSetting = (db: Db) => getSetting<number | 'auto'>(db, 'periodStartDay') ?? 'auto'
export function periodDay(db: Db): number {
  const s = periodSetting(db)
  return s === 'auto' ? (salaryDay(db) ?? 1) : s
}
export const currentPeriod = (db: Db, today: string) => periodOf(today, periodDay(db))
/** Début de l'utilisation : la plus ancienne date de solde saisie sur un compte. */
export function appStart(db: Db): string | null {
  const d = db.select({ d: sql<string | null>`min(${account.balanceDate})` }).from(account).get()?.d
  return d ?? null
}
const daysBetweenIso = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
export const periodBounds = (db: Db, key: string) => { const d = periodDay(db); return { start: periodStart(key, d), end: periodEnd(key, d), label: periodLabel(key, d), day: d } }

// ---------- réel par période ----------
/**
 * Somme signée en EUR par période et catégorie (ventilations comprises, virements internes exclus).
 * Une opération reconnue comme une échéance (salaire versé le 10 au lieu du 12) compte pour la période de l'échéance.
 */
export function actualsBetween(db: Db, from: string, to: string): Actuals {
  const day = periodDay(db), lo = addDays(periodStart(from, day), -10), hi = addDays(periodEnd(to, day), 10)
  const range = and(gte(transaction.date, lo), lte(transaction.date, hi), isNull(transaction.transferGroupId))
  const override = new Map<string, string>()
  for (const r of listRecurring(db).filter((x) => x.active && x.pattern)) {
    const dates = occurrences(r, lo, hi)
    for (const [date, t] of matchOccurrences(dates, matchingTxs(db, r).filter((t) => t.date >= lo && t.date <= hi), r)) override.set(t.id, periodOf(date, day))
  }
  for (const [ref, t] of pointed(db)) {
    const [kind, , rest] = [ref.split(':')[0], ref.split(':')[1], ref.split(':').slice(2).join(':')]
    override.set(t.id, kind === 'rec' ? periodOf(rest, day) : rest)
  }
  const keyOf = (id: string, date: string) => override.get(id) ?? periodOf(date, day)
  const out: Actuals = new Map()
  const add = (k: string, c: string, v: number) => {
    if (k < from || k > to) return
    const m = out.get(k) ?? new Map<string, number>()
    m.set(c, (m.get(c) ?? 0) + v)
    out.set(k, m)
  }
  const splitTx = new Set(db.selectDistinct({ id: transactionSplit.transactionId }).from(transactionSplit).all().map((x) => x.id))
  for (const t of db.select({ id: transaction.id, date: transaction.date, c: transaction.categoryId, a: transaction.amountEur }).from(transaction).where(range).all())
    if (!splitTx.has(t.id)) add(keyOf(t.id, t.date), t.c ?? '', t.a)
  // part en EUR d'une ventilation = part × (montant EUR / montant d'origine)
  for (const s of db.select({ id: transaction.id, date: transaction.date, c: transactionSplit.categoryId, part: transactionSplit.amount, a: transaction.amountEur, o: transaction.amount })
    .from(transactionSplit).innerJoin(transaction, eq(transaction.id, transactionSplit.transactionId)).where(range).all())
    add(keyOf(s.id, s.date), s.c, Math.round((s.part * s.a) / s.o))
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
  const months = computeBudget(cats, db.select().from(budgetLine).all(), db.select().from(budgetException).all(), actualsBetween(db, first, to), first, to, recurringPlan(db, first, to))
  // période où l'on a commencé l'app : les dépenses d'avant la saisie du solde y sont déjà ; l'enveloppe restante est
  // comptée au prorata des jours qui restent (sinon « découvert probable » dès l'installation)
  const startedOn = appStart(db)
  if (startedOn) {
    const day = periodDay(db), k = periodOf(startedOn, day), m = months.find((x) => x.month === k)
    if (m) {
      const s0 = periodStart(k, day), e0 = periodEnd(k, day)
      const ratio = (daysBetweenIso(startedOn, e0) + 1) / (daysBetweenIso(s0, e0) + 1)
      for (const r of m.rows) if (r.kind === 'depense' && !(r.items.length && !r.exception)) r.toCome = Math.max(0, Math.round((r.planned + r.carry) * ratio) - r.actual)
      m.proratedFrom = startedOn
    }
  }
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
/** Supprime les montants saisis d'une catégorie (pas ses exceptions). */
export const removeLines = (db: Db, categoryId: string) => db.delete(budgetLine).where(eq(budgetLine.categoryId, categoryId)).run()
export function removeBudget(db: Db, categoryId: string) {
  db.delete(budgetLine).where(eq(budgetLine.categoryId, categoryId)).run()
  db.delete(budgetException).where(eq(budgetException.categoryId, categoryId)).run()
}
export const setCategoryOptions = (db: Db, id: string, v: { rollover?: boolean; bucket?: 'besoin' | 'envie' | null }) =>
  db.update(category).set({ ...v, updatedAt: now }).where(eq(category.id, id)).run()

/**
 * Premier budget proposé : moyenne des 3 derniers mois complets par catégorie principale (arrondie à 10 € au-dessus),
 * moins ce que couvrent déjà les échéances datées de cette catégorie (loyer, abonnements…) : pas de double compte.
 */
export function suggestBudget(db: Db, month: string): { categoryId: string; amount: number }[] {
  const cats = listCategories(db), root = (id: string) => { const c = cats.find((x) => x.id === id); return c?.parentId ?? c?.id }
  const from = addMonths(month, -3), to = addMonths(month, -1)
  const sums = new Map<string, number>()
  for (const [, m] of actualsBetween(db, from, to)) for (const [c, s] of m) {
    const r = c && root(c)
    if (r) sums.set(r, (sums.get(r) ?? 0) + s)
  }
  const covered = new Map<string, number>()
  for (const r of listRecurring(db).filter((x) => x.active && x.categoryId)) {
    const k = root(r.categoryId!)!
    covered.set(k, (covered.get(k) ?? 0) + Math.abs(monthlyEquivalent(r, r.amount)))
  }
  const out: { categoryId: string; amount: number }[] = []
  for (const [id, s] of sums) {
    const c = cats.find((x) => x.id === id)
    if (!c || c.kind === 'transfert') continue
    const avg = Math.abs(s) / 3 - (covered.get(id) ?? 0)
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

