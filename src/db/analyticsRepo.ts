import { eq, gte, inArray, lte, and, sql } from 'drizzle-orm'
import type { Db } from './client'
import { account, transaction } from './schema'
import { balances, cachedRates, effectiveOpenings, getSetting, listCategories, putSetting } from './repo'
import { actualsBetween, appStart, currentPeriod, forecast, getBudget, periodDay, resteAVivreFor, liquidBalance, occurrencesBetween, recurringStatus } from './budgetRepo'
import type { Forecast } from '@/core/forecast'
import { addDays, addMonths } from '@/core/dates'
import { periodOf, periodStart } from '@/core/period'
import { rateOn } from '@/core/fx'
import { computeAlerts, dailyBalances, DEFAULT_ALERTS, findAnomalies, healthScore, savingsRate, type Alert, type AlertSettings } from '@/core/analytics'

export { forecast }
export type { Forecast, PeriodForecast } from '@/core/forecast'

const LIQUID = ['courant', 'carte', 'especes'] as const

function accountsIn(db: Db, liquidOnly: boolean) {
  return db.select().from(account).where(eq(account.archived, false)).all().filter((a) => !liquidOnly || (LIQUID as readonly string[]).includes(a.type))
}
const toEur = (db: Db, currency: string, cents: number) => currency === 'EUR' ? cents : Math.round(cents * (rateOn(cachedRates(db, currency), '9999') ?? 0))

/**
 * Solde EUR jour par jour (tous comptes actifs, ou seulement courants/cartes/espèces).
 * Les comptes en devise sont valorisés au dernier taux connu, comme le solde affiché aujourd'hui.
 */
export function balanceHistory(db: Db, from: string, to: string, liquidOnly = false) {
  const accs = accountsIn(db, liquidOnly), ids = accs.map((a) => a.id)
  if (!ids.length) return []
  const eff = effectiveOpenings(db)
  const opening = accs.reduce((s, a) => s + toEur(db, a.currency, eff.get(a.id)!), 0)
  const rows = db.select({ d: transaction.date, c: transaction.currency, s: sql<number>`sum(${transaction.amount})` }).from(transaction)
    .where(and(inArray(transaction.accountId, ids), lte(transaction.date, to))).groupBy(transaction.date, transaction.currency).all()
  let before = 0
  const daily = new Map<string, number>()
  for (const r of rows) {
    const v = toEur(db, r.c, r.s)
    if (r.d < from) before += v
    else daily.set(r.d, (daily.get(r.d) ?? 0) + v)
  }
  return dailyBalances(opening + before, daily, from, to)
}

/** 12 fins de mois passées + projection budgétaire sur `horizon` mois (tous comptes). */
export function balanceAndForecast(db: Db, today: string, horizon: number) {
  const cur = currentPeriod(db, today), day = periodDay(db), started = appStart(db)
  // historique : fins de période (de paie à paie), à partir du premier jour dans l'app seulement (pas d'historique inventé)
  let from = periodStart(addMonths(cur, -11), day)
  if (started && started > from) from = started
  const ends = new Map<string, number>()
  for (const p of balanceHistory(db, from, today)) ends.set(periodOf(p.date, day), p.balance)
  const hist = [...ends].map(([month, balance]) => ({ month, balance }))
  return { hist, proj: periodEnds(forecast(db, today, horizon, 'total')) }
}

const periodEnds = (f: Forecast) => f.periods.map((p) => ({ month: p.key, balance: p.balance, end: p.end, name: p.name }))
/** Projection des seuls comptes courants (= forecast liquide) : sert à l'alerte de découvert. */
export const liquidProjection = (db: Db, today: string, horizon = 3) => periodEnds(forecast(db, today, horizon, 'liquid'))

/** Dépenses réelles du mois par catégorie principale, triées. */
export function spendingByRoot(db: Db, month: string) {
  const cats = listCategories(db), m = getBudget(db, month, month)[0]!
  const root = (id: string) => { const c = cats.find((x) => x.id === id); return c?.parentId ?? id }
  // getBudget agrège par ligne de budget ; on repart des montants bruts pour couvrir les catégories hors budget
  const sums = new Map<string, number>()
  for (const [c, s] of actualsFor(db, month)) {
    const cat = cats.find((x) => x.id === c)
    if (cat && cat.kind !== 'depense') continue
    if (!cat && s >= 0) continue
    const k = cat ? root(c) : ''
    sums.set(k, (sums.get(k) ?? 0) - s)
  }
  return { total: m.actualExpense, income: m.actualIncome, rows: [...sums].filter(([, v]) => v > 0).map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount) }
}
const actualsFor = (db: Db, month: string) => actualsBetween(db, month, month).get(month) ?? new Map<string, number>()

/** Flux du mois pour le Sankey : sources de revenus → Revenus → postes de dépense + épargne (ou déficit). */
export function sankeyData(db: Db, month: string, maxOut = 7) {
  const cats = listCategories(db), name = (id: string) => cats.find((c) => c.id === id)?.name ?? 'Non catégorisé'
  const incomes = new Map<string, number>()
  for (const [c, s] of actualsFor(db, month)) {
    const cat = cats.find((x) => x.id === c)
    if (s > 0 && (!cat || cat.kind === 'revenu')) incomes.set(cat ? c : '', (incomes.get(cat ? c : '') ?? 0) + s)
  }
  const sp = spendingByRoot(db, month)
  const outs = sp.rows.slice(0, maxOut).map((r) => ({ name: r.id ? name(r.id) : 'Non catégorisé', value: r.amount }))
  const rest = sp.rows.slice(maxOut).reduce((s, r) => s + r.amount, 0)
  if (rest > 0) outs.push({ name: 'Autres', value: rest })
  const inTotal = [...incomes.values()].reduce((s, v) => s + v, 0), outTotal = outs.reduce((s, o) => s + o.value, 0)
  const ins = [...incomes].map(([id, v]) => ({ name: id ? name(id) : 'Autres revenus', value: v }))
  const hasSavings = accountsIn(db, false).some((a) => a.type === 'epargne')
  if (outTotal > inTotal) ins.push({ name: hasSavings ? 'Puisé dans l’épargne' : 'Dépensé au-delà des revenus', value: outTotal - inTotal })
  if (inTotal > outTotal) outs.push({ name: 'Épargne', value: inTotal - outTotal })
  const nodes = [...ins.map((i) => ({ name: i.name })), { name: 'Budget du mois' }, ...outs.map((o) => ({ name: o.name }))]
  const hub = ins.length
  const links = [...ins.map((i, k) => ({ source: k, target: hub, value: i.value })), ...outs.map((o, k) => ({ source: hub, target: hub + 1 + k, value: o.value }))]
  return { nodes, links, inTotal, outTotal }
}

/** Revenus et dépenses réels des 12 derniers mois. */
export function monthlyTotals(db: Db, today: string, n = 12) {
  const cur = currentPeriod(db, today), started = appStart(db)
  let from = addMonths(cur, -(n - 1))
  if (started && periodOf(started, periodDay(db)) > from) from = periodOf(started, periodDay(db))
  return getBudget(db, from, cur).map((m) => ({ month: m.month, income: m.actualIncome, expense: m.actualExpense }))
}

/** Dépenses mensuelles de l'année et de la précédente. */
export function yearOverYear(db: Db, year: number) {
  const cur = getBudget(db, `${year}-01`, `${year}-12`), prev = getBudget(db, `${year - 1}-01`, `${year - 1}-12`)
  return cur.map((m, i) => ({ month: m.month, current: m.actualExpense, previous: prev[i]!.actualExpense }))
}

// ---------- santé ----------
export function health(db: Db, today: string) {
  const cur = currentPeriod(db, today)
  const last3 = getBudget(db, addMonths(cur, -3), addMonths(cur, -1))
  const avgExp = last3.reduce((s, m) => s + m.actualExpense, 0) / Math.max(1, last3.length)
  const reserve = accountsIn(db, false).filter((a) => a.type === 'epargne')
  const bal = balances(db)
  const reserveBal = reserve.reduce((s, a) => s + toEur(db, a.currency, bal.get(a.id) ?? 0), 0)
  const lastRows = last3.at(-1)?.rows.filter((r) => r.kind === 'depense' && r.planned + r.carry > 0) ?? []
  const negativeDays = balanceHistory(db, addDays(today, -89), today, true).filter((p) => p.balance < 0).length
  const fees = findAnomaliesFor(db, today).find((a) => a.kind === 'frais')
  return {
    enough: last3.some((m) => m.actualIncome > 0), // au moins une période complète avec un revenu reçu
    rate: savingsRate(last3),
    ...healthScore({
      savingsRate: savingsRate(last3), monthsOfReserve: avgExp > 0 ? reserveBal / avgExp : 0,
      budgetRespect: lastRows.length ? lastRows.filter((r) => r.remaining >= 0).length / lastRows.length : null,
      negativeDays, fees90: fees?.kind === 'frais' ? -fees.total : 0,
    }),
  }
}

export function findAnomaliesFor(db: Db, today: string) {
  const fees = listCategories(db).find((c) => c.name === 'Frais bancaires' && !c.parentId)?.id ?? null
  return findAnomalies(db.select().from(transaction).where(gte(transaction.date, addDays(today, -400))).all(), today, fees)
}

// ---------- alertes ----------
export const alertSettings = (db: Db): AlertSettings => {
  const s = getSetting<Partial<AlertSettings>>(db, 'alertSettings') ?? {}
  return { ...DEFAULT_ALERTS, ...s, enabled: { ...DEFAULT_ALERTS.enabled, ...s.enabled } }
}
export const saveAlertSettings = (db: Db, s: AlertSettings) => putSetting(db, 'alertSettings', s)

export function alerts(db: Db, today: string): Alert[] {
  const s = alertSettings(db), cur = currentPeriod(db, today)
  const cats = listCategories(db), catLabel = (id: string) => cats.find((c) => c.id === id)?.name ?? '?'
  const month = getBudget(db, cur, cur)[0] ?? null
  const soon = occurrencesBetween(db, today, addDays(today, s.daysBefore)).filter((o) => !o.paid)
  const missedIncome = recurringStatus(db, today).filter((x) => x.r.kind === 'revenu').flatMap((x) => x.missed.map((d) => ({ name: x.r.name, date: d, amount: x.r.amount, imported: !!x.r.pattern })))
  const dismissed = new Set(getSetting<string[]>(db, 'dismissedAlerts') ?? [])
  return computeAlerts({
    today, period: cur, month: month && month.rows.length ? month : null, catLabel,
    liquid: liquidBalance(db), resteAVivre: resteAVivreFor(db, today).amount,
    liquidProjection: liquidProjection(db, today),
    upcoming: soon.map((o) => ({ name: o.recurring.name, date: o.date, amount: o.recurring.amount })),
    missedIncome, anomalies: findAnomaliesFor(db, today),
  }, s).filter((a) => !dismissed.has(a.id))
}

export function dismissAlert(db: Db, id: string) {
  const list = getSetting<string[]>(db, 'dismissedAlerts') ?? []
  putSetting(db, 'dismissedAlerts', [...list, id].slice(-500))
}
