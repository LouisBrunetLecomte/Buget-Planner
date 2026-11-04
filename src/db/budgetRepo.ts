import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from './client'
import { account, budgetException, budgetLine, category, recurring, transaction, transactionSplit } from './schema'
import { balances, cachedRates, getSetting, linkTransfer, listCategories, putSetting, transferSuggestions, type Category } from './repo'
import { normalizeLabel } from '@/core/labels'
import { addDays, addMonths, daysInMonth, endOfMonth, monthOf } from '@/core/dates'
import { periodEnd, periodLabel, periodName, periodOf, periodStart } from '@/core/period'
import { rateOn } from '@/core/fx'
import { detectRecurring, matchOccurrences, monthlyEquivalent, occurrences, priceIncrease, type MatchTx, type Suggestion } from '@/core/recurring'
import { applyScope, computeBudget, resteAVivre, type Actuals, type PlannedItem, type RecurringPlan, type Scope } from '@/core/budget'
import { buildForecast, everydayRate, type Forecast } from '@/core/forecast'

export type Recurring = typeof recurring.$inferSelect
const LIQUID: string[] = ['courant', 'carte', 'especes']
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
export function updateRecurringFrom(db: Db, id: string, fromMonth: string, patch: { amount?: number; day?: number; name?: string; endDate?: string | null; kind?: Recurring['kind'] }) {
  const r = db.select().from(recurring).where(eq(recurring.id, id)).get()
  if (!r) throw new Error('Échéance introuvable')
  const clamp = (m: string, d: number) => `${m}-${String(Math.min(d, daysInMonth(m))).padStart(2, '0')}`
  // le signe suit le type : un abonnement passé de « revenu » à « charge » devient une sortie
  const amount = patch.amount ?? (patch.kind ? (patch.kind === 'revenu' ? 1 : -1) * Math.abs(r.amount) : undefined)
  const v = {
    ...(amount !== undefined ? { amount } : {}), ...(patch.name ? { name: patch.name } : {}),
    ...(patch.day ? { dayOfMonth: patch.day } : {}), ...(patch.kind ? { kind: patch.kind } : {}),
  }
  if (patch.endDate !== undefined) db.update(recurring).set({ endDate: patch.endDate, updatedAt: now }).where(eq(recurring.id, id)).run()
  if (!Object.keys(v).length) return
  if (fromMonth <= monthOf(r.startDate))
    return db.update(recurring).set({ ...v, ...(patch.day ? { startDate: clamp(monthOf(r.startDate), patch.day) } : {}), updatedAt: now }).where(eq(recurring.id, id)).run()
  const next = occurrences({ ...r, endDate: patch.endDate !== undefined ? patch.endDate : r.endDate }, `${fromMonth}-01`, addDays(`${fromMonth}-01`, 800))[0]
  if (!next) throw new Error('Plus aucune échéance après cette date')
  db.update(recurring).set({ endDate: endOfMonth(addMonths(fromMonth, -1)), updatedAt: now }).where(eq(recurring.id, id)).run()
  const { id: _old, createdAt: _c, updatedAt: _u, ...copy } = r
  void _old; void _c; void _u
  return db.insert(recurring).values({ ...copy, ...v, ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}), startDate: patch.day ? clamp(monthOf(next), patch.day) : next }).returning().get()
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
 * Dépense courante observée (R) : dépenses des comptes courants des 90 derniers jours, hors virements, coches,
 * opérations rapprochées d'une échéance et catégories qui ont une ligne de budget sur leur période.
 */
function everydayFor(db: Db, today: string) {
  const day = periodDay(db), first = db.select({ d: sql<string | null>`min(${transaction.date})` }).from(transaction).get()?.d ?? null
  const started = appStart(db), firstDate = [first, started].filter((x): x is string => !!x).sort()[0] ?? null
  const from = addDays(today, -90)
  const liquid = new Set(db.select().from(account).all().filter((a) => LIQUID.includes(a.type)).map((a) => a.id))
  const settled = new Set(occurrencesBetween(db, addDays(from, -6), addDays(today, 6)).flatMap((o) => (o.paid ? [o.paid.id] : [])))
  const cats = listCategories(db), parent = new Map(cats.map((c) => [c.id, c.parentId]))
  const budgeted = new Set(getBudget(db, periodOf(from, day), periodOf(today, day)).flatMap((m) => m.rows.filter((r) => r.kind === 'depense').map((r) => `${m.month}|${r.categoryId}`)))
  const isBudgeted = (k: string, c: string | null) => !!c && (budgeted.has(`${k}|${c}`) || budgeted.has(`${k}|${parent.get(c)}`))
  const txs = db.select({ id: transaction.id, date: transaction.date, amount: transaction.amountEur, c: transaction.categoryId, acc: transaction.accountId }).from(transaction)
    .where(and(gte(transaction.date, from), lte(transaction.date, today), isNull(transaction.transferGroupId), isNull(transaction.plannedRef), sql`${transaction.amountEur} < 0`)).all()
  // ponytail: une opération ventilée compte entière dans le quotidien, même si une part est budgétée
  return everydayRate(txs.filter((t) => liquid.has(t.acc) && !settled.has(t.id) && !isBudgeted(periodOf(t.date, day), t.c)), today, firstDate)
}

function buildFor(db: Db, today: string, horizon: number, scope: 'liquid' | 'total') {
  const day = periodDay(db), cur = periodOf(today, day)
  const months = getBudget(db, cur, addMonths(cur, Math.max(1, horizon) - 1))
  const periods = months.map((m) => ({ key: m.month, name: periodName(m.month, day), start: periodStart(m.month, day), end: periodEnd(m.month, day), budget: m }))
  const cats = listCategories(db), label = (id: string) => cats.find((c) => c.id === id)?.name ?? '?'
  // échéances qui ne passent pas par le budget : sans catégorie, ou virements (épargne)
  const extra = occurrencesBetween(db, periods[0]!.start, periods.at(-1)!.end).flatMap((o) => {
    const c = cats.find((x) => x.id === o.recurring.categoryId)
    if (o.paid || (c && c.kind !== 'transfert')) return []
    return [{ date: o.date < today ? today : o.date, amount: o.recurring.amount, label: o.recurring.name, savings: !!o.recurring.toAccountId || c?.kind === 'transfert' }]
  })
  const start = scope === 'liquid' ? liquidBalance(db) : totalBalance(db)
  return { f: buildForecast({ scope, today, start, rate: everydayFor(db, today), periods, extra, label }), first: months[0]! }
}

/** Prévision unique du solde (voir core/forecast.ts) : `horizon` périodes à partir de celle en cours. */
export const forecast = (db: Db, today: string, horizon: number, scope: 'liquid' | 'total' = 'liquid'): Forecast => buildFor(db, today, horizon, scope).f

/**
 * À vivre jusqu'à la prochaine paie = comptes courants + à recevoir − échéances à payer − ponctuels restants
 * − enveloppes restantes. forecastEnd = à vivre − dépense courante × jours restants = première case de prévision.
 */
export function resteAVivreFor(db: Db, today: string) {
  const { f, first } = buildFor(db, today, 1, 'liquid'), p = f.periods[0]!
  const dated = p.fixed + p.savings
  const r = resteAVivre(f.start, p.income, dated + p.oneOff + p.envelopes, today, p.end)
  return { ...r, liquid: f.start, incoming: p.income, dated, oneOff: p.oneOff, envelopes: p.envelopes, end: p.end, day: periodDay(db), proratedFrom: first.proratedFrom ?? null,
    forecastEnd: p.balance, dailyEveryday: f.dailyEveryday, confidence: f.confidence }
}

/**
 * Opérations qui peuvent régler une récurrence : même sens, ni pointées ni virement, même compte si précisé,
 * libellé contenant le motif (ou à défaut le nom) ou même catégorie, et montant proche (±20 %, 5 € au moins).
 * Ainsi « +180 CAF » saisi au Journal règle l'échéance CAF créée à la main, sans motif.
 */
function matchingTxs(db: Db, r: Recurring): MatchTx[] {
  const p = normalizeLabel(r.pattern ?? r.name), tol = Math.max(Math.abs(r.amount) / 5, 500)
  return db.select({ id: transaction.id, date: transaction.date, amountEur: transaction.amountEur, labelNorm: transaction.labelNorm, accountId: transaction.accountId, categoryId: transaction.categoryId })
    .from(transaction).where(and(isNull(transaction.transferGroupId), isNull(transaction.plannedRef), r.amount < 0 ? sql`${transaction.amountEur} < 0` : sql`${transaction.amountEur} > 0`)).all()
    .filter((t) => ((p && t.labelNorm.includes(p)) || (r.categoryId && t.categoryId === r.categoryId)) && Math.abs(t.amountEur - r.amount) <= tol && (!r.accountId || t.accountId === r.accountId))
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
export function tickOccurrence(db: Db, recurringId: string, date: string, today: string, amount?: number): 'cree' | 'deja' {
  const r = db.select().from(recurring).where(eq(recurring.id, recurringId)).get()
  if (!r) throw new Error('Échéance introuvable')
  // déjà cochée, retrouvée dans le Journal ou comprise dans le solde de départ : ne rien créer (pas de double compte)
  if (paidFor(db, r, [date]).has(date)) return 'deja'
  const acc = defaultAccount(db, r.accountId)
  const v = { date: date > today ? today : date, currency: 'EUR', label: r.name, labelNorm: normalizeLabel(r.name) }
  const a = amount ?? r.amount
  const debit = db.insert(transaction).values({ ...v, accountId: acc.id, amount: a, amountEur: a, categoryId: r.toAccountId ? null : r.categoryId, plannedRef: occurrenceRef(r.id, date) }).returning().get()
  if (r.toAccountId) {
    const credit = db.insert(transaction).values({ ...v, accountId: r.toAccountId, amount: -a, amountEur: -a, categoryId: null }).returning().get()
    linkTransfer(db, [debit.id, credit.id])
  }
  return 'cree'
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
export function untick(db: Db, ref: string) {
  const t = db.select().from(transaction).where(eq(transaction.plannedRef, ref)).get()
  if (!t) return
  // un virement vers l'épargne a créé deux opérations liées : on retire les deux
  db.delete(transaction).where(t.transferGroupId ? eq(transaction.transferGroupId, t.transferGroupId) : eq(transaction.id, t.id)).run()
}

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
  for (const r of listRecurring(db).filter((x) => x.active)) {
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
      for (const r of m.rows) if (r.kind === 'depense' && !(r.items.length && !r.exception) && r.base !== null) r.toCome = Math.max(0, Math.round((r.planned + r.carry) * ratio) - r.actual)
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
/**
 * Ajout « une seule fois » sur une période. Sans jour : une exception pleine (jamais proratisée ni étalée), qui s'ajoute
 * au prévu existant de la catégorie. Avec un jour : une échéance datée unique (fin = début).
 */
export function addOneOff(db: Db, v: { categoryId: string; period: string; amount: number; day?: number | null; reason?: string | null }) {
  if (!Number.isInteger(v.amount) || v.amount <= 0) throw new Error('Montant invalide')
  const cat = listCategories(db).find((c) => c.id === v.categoryId)
  if (!cat) throw new Error('Catégorie introuvable')
  if (v.day) {
    const date = dateInPeriod(db, v.period, v.day)
    createRecurring(db, { name: v.reason?.trim() || cat.name, kind: cat.kind === 'revenu' ? 'revenu' : 'charge', amount: cat.kind === 'revenu' ? v.amount : -v.amount,
      freq: 'month', interval: 1, startDate: date, dayOfMonth: v.day, endDate: date, categoryId: cat.id })
    return
  }
  const row = getBudget(db, v.period, v.period)[0]?.rows.find((r) => r.categoryId === v.categoryId)
  setBudget(db, v.categoryId, v.period, (row?.planned ?? 0) + v.amount, 'month', v.reason)
}

/** Date du jour `day` (du mois) qui tombe dans la période `key` : paie le 28, le 5 de la période d'octobre est le 5 novembre. */
function dateInPeriod(db: Db, key: string, day: number) {
  const at = (m: string) => `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`
  return at(key) < periodStart(key, periodDay(db)) ? at(addMonths(key, 1)) : at(key)
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Catégorie existante du même nom (sans accents ni casse, « s » final toléré), sous-catégories comprises. */
export function findCategory(db: Db, name: string, kind: 'depense' | 'revenu'): Category | null {
  const n = fold(name), bare = (x: string) => x.replace(/s$/, '')
  if (!n) return null
  const cats = listCategories(db).filter((c) => c.kind === kind)
  return cats.find((c) => fold(c.name) === n) ?? cats.find((c) => bare(fold(c.name)) === bare(n)) ?? null
}

/** Virement mensuel vers un compte épargne : sort des comptes courants, n'est pas une dépense. */
/** `startMonth` est la clé de la période de la première échéance. */
export function createSavingsTransfer(db: Db, v: { name: string; fromAccountId: string | null; toAccountId: string; amount: number; day: number; startMonth: string; endDate?: string | null }) {
  if (!Number.isInteger(v.amount) || v.amount === 0) throw new Error('Montant invalide')
  const transfer = listCategories(db).find((c) => c.kind === 'transfert' && !c.parentId)
  return createRecurring(db, { name: v.name, kind: 'charge', accountId: v.fromAccountId, toAccountId: v.toAccountId, categoryId: transfer?.id ?? null,
    amount: -Math.abs(v.amount), freq: 'month', interval: 1, dayOfMonth: v.day, endDate: v.endDate ?? null,
    startDate: dateInPeriod(db, v.startMonth, v.day) })
}

/**
 * Corrige le sens d'une ligne (abonnement saisi en revenu…). Catégorie sans opération ni sous-catégorie : on change son type.
 * Sinon on bascule ses lignes, exceptions et échéances vers la catégorie du même nom de l'autre type (créée au besoin).
 * Les échéances prennent le type et le signe correspondants. Renvoie la catégorie finale.
 */
export function changeLineKind(db: Db, categoryId: string, kind: 'depense' | 'revenu'): string {
  return db.transaction((t) => {
    const tdb = t as unknown as Db
    const c = t.select().from(category).where(eq(category.id, categoryId)).get()
    if (!c) throw new Error('Catégorie introuvable')
    if (c.kind === kind) return c.id
    const used = t.select({ id: transaction.id }).from(transaction).where(eq(transaction.categoryId, c.id)).limit(1).get()
      || t.select({ id: category.id }).from(category).where(eq(category.parentId, c.id)).limit(1).get()
    let target = c.id
    if (!used && !c.parentId) t.update(category).set({ kind, updatedAt: now }).where(eq(category.id, c.id)).run()
    else {
      target = findCategory(tdb, c.name, kind)?.id ?? t.insert(category).values({ name: c.name, kind }).returning().get().id
      t.update(budgetLine).set({ categoryId: target }).where(eq(budgetLine.categoryId, c.id)).run()
      t.update(budgetException).set({ categoryId: target }).where(eq(budgetException.categoryId, c.id)).run()
      t.update(recurring).set({ categoryId: target }).where(eq(recurring.categoryId, c.id)).run()
    }
    for (const r of t.select().from(recurring).where(eq(recurring.categoryId, target)).all())
      t.update(recurring).set({ kind: kind === 'revenu' ? 'revenu' : r.kind === 'revenu' ? 'charge' : r.kind, amount: (kind === 'revenu' ? 1 : -1) * Math.abs(r.amount), updatedAt: now }).where(eq(recurring.id, r.id)).run()
    return target
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

