import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from './client'
import { asset, assetValue, debt, goal, goalContribution, recurring, savingsRule, scenario, transaction } from './schema'
import { balances, listAccounts, listCategories } from './repo'
import { currentPeriod, getBudget, resteAVivreFor, occurrencesBetween, listRecurring, liquidBalance, periodBounds, totalBalance } from './budgetRepo'
import { balanceHistory } from './analyticsRepo'
import { addMonths, daysInMonth, endOfMonth, monthOf } from '@/core/dates'
import { amortize, balanceAt, type Loan } from '@/core/debt'
import { dailyForecast, roundUp, simulate, suggestedMonthly, type Change } from '@/core/planning'
import { monthEnds } from '@/core/analytics'
import { monthlyEquivalent } from '@/core/recurring'

export type Goal = typeof goal.$inferSelect
export type Debt = typeof debt.$inferSelect
export type Asset = typeof asset.$inferSelect
export type Scenario = Omit<typeof scenario.$inferSelect, 'changes'> & { changes: Change[] }
const now = sql`(datetime('now'))`

// ---------- objectifs ----------
export const createGoal = (db: Db, v: typeof goal.$inferInsert) => db.insert(goal).values(v).returning().get()
export const updateGoal = (db: Db, id: string, v: Partial<typeof goal.$inferInsert>) => db.update(goal).set({ ...v, updatedAt: now }).where(eq(goal.id, id)).run()
export const deleteGoal = (db: Db, id: string) => db.delete(goal).where(eq(goal.id, id)).run()
export const addContribution = (db: Db, goalId: string, date: string, amount: number, note?: string) => {
  if (!Number.isInteger(amount) || amount === 0) throw new Error('Montant invalide')
  return db.insert(goalContribution).values({ goalId, date, amount, note: note ?? null }).run()
}

export function goalsStatus(db: Db, today: string) {
  const bal = balances(db)
  const contribs = db.select({ g: goalContribution.goalId, s: sql<number>`sum(${goalContribution.amount})` }).from(goalContribution).groupBy(goalContribution.goalId).all()
  return db.select().from(goal).orderBy(goal.deadline).all().map((g) => {
    const current = g.accountId ? (bal.get(g.accountId) ?? 0) : (contribs.find((c) => c.g === g.id)?.s ?? 0)
    return { g, current, pct: g.target ? Math.min(1, current / g.target) : 0, monthly: suggestedMonthly(g.target, current, g.deadline, today) }
  })
}

// ---------- règles d'épargne ----------
export const listSavingsRules = (db: Db) => db.select().from(savingsRule).all()
export const createSavingsRule = (db: Db, v: typeof savingsRule.$inferInsert) => db.insert(savingsRule).values(v).run()
export const deleteSavingsRule = (db: Db, id: string) => db.delete(savingsRule).where(eq(savingsRule.id, id)).run()

/** Montant que chaque règle propose de mettre de côté pour un mois donné. */
export function savingsRuleAmounts(db: Db, month: string) {
  const { start, end } = periodBounds(db, month)
  const range = and(gte(transaction.date, start), lte(transaction.date, end), sql`${transaction.transferGroupId} is null`)
  const tx = db.select({ a: transaction.amountEur }).from(transaction).where(range).all()
  const income = getBudget(db, month, month)[0]!.actualIncome
  return listSavingsRules(db).filter((r) => r.active).map((r) => ({
    r, amount: r.kind === 'arrondi' ? roundUp(tx.filter((t) => t.a < 0).map((t) => t.a), Math.max(1, Math.round(r.value))) : Math.round((income * r.value) / 100),
  }))
}

// ---------- dettes ----------
export const listDebts = (db: Db) => db.select().from(debt).orderBy(debt.name).all()
/** Crée un crédit ; si `day` est donné, sa mensualité devient une charge fixe datée (budget, calendrier, alertes la voient). */
export function createDebt(db: Db, v: typeof debt.$inferInsert, day?: number) {
  const rows = amortize(toLoan(v as Debt))
  const d = db.insert(debt).values(v).returning().get()
  if (day) {
    const cat = listCategories(db).find((c) => c.name === 'Loyer / crédit')
    db.insert(recurring).values({ name: `Crédit : ${d.name}`, kind: 'charge', amount: -d.payment, freq: 'month', interval: 1,
      startDate: `${d.startMonth}-${String(Math.min(day, daysInMonth(d.startMonth))).padStart(2, '0')}`, dayOfMonth: day, endDate: endOfMonth(rows.at(-1)!.month), categoryId: cat?.id ?? null, debtId: d.id }).run()
  }
  return d
}
export const updateDebt = (db: Db, id: string, v: Partial<typeof debt.$inferInsert>) => db.update(debt).set({ ...v, updatedAt: now }).where(eq(debt.id, id)).run()
export function deleteDebt(db: Db, id: string) {
  db.delete(recurring).where(eq(recurring.debtId, id)).run() // sa mensualité disparaît des charges fixes
  db.delete(debt).where(eq(debt.id, id)).run()
}
export const toLoan = (d: Pick<Debt, 'principal' | 'rate' | 'payment' | 'startMonth' | 'extraMonthly'>): Loan =>
  ({ principal: d.principal, rate: d.rate, payment: d.payment, startMonth: d.startMonth, extraMonthly: d.extraMonthly })
export const debtBalanceAt = (d: Debt, month: string) => balanceAt(toLoan(d), month)

// ---------- patrimoine ----------
export const listAssets = (db: Db) => db.select().from(asset).orderBy(asset.name).all()
export const createAsset = (db: Db, name: string, kind: Asset['kind'], value: number, date: string) =>
  db.transaction((t) => { const a = t.insert(asset).values({ name, kind }).returning().get(); t.insert(assetValue).values({ assetId: a.id, date, value }).run(); return a })
export const deleteAsset = (db: Db, id: string) => db.delete(asset).where(eq(asset.id, id)).run()
export const setAssetValue = (db: Db, assetId: string, date: string, value: number) =>
  db.insert(assetValue).values({ assetId, date, value }).onConflictDoUpdate({ target: [assetValue.assetId, assetValue.date], set: { value } }).run()
export const assetHistory = (db: Db, assetId: string) => db.select().from(assetValue).where(eq(assetValue.assetId, assetId)).orderBy(desc(assetValue.date)).all()
function assetValueAt(db: Db, assetId: string, date: string) {
  return db.select().from(assetValue).where(and(eq(assetValue.assetId, assetId), lte(assetValue.date, date))).orderBy(desc(assetValue.date)).limit(1).get()?.value ?? 0
}

/** Patrimoine net aujourd'hui : comptes + biens − capital restant dû. */
export function netWorth(db: Db, today: string) {
  const cur = monthOf(today)
  const accounts = totalBalance(db)
  const assets = listAssets(db).map((a) => ({ a, value: assetValueAt(db, a.id, today) }))
  const debts = listDebts(db).map((d) => ({ d, balance: debtBalanceAt(d, addMonths(cur, -1)) }))
  const assetsTotal = assets.reduce((s, x) => s + x.value, 0), debtsTotal = debts.reduce((s, x) => s + x.balance, 0)
  return { accounts, assets, debts, assetsTotal, debtsTotal, net: accounts + assetsTotal - debtsTotal }
}

/** Patrimoine net en fin de mois sur 12 mois. */
export function netWorthHistory(db: Db, today: string, n = 12) {
  const cur = monthOf(today)
  const ends = monthEnds(balanceHistory(db, `${addMonths(cur, -(n - 1))}-01`, today))
  const assets = listAssets(db), debts = listDebts(db)
  return ends.map(({ month, balance }) => {
    const date = month === cur ? today : endOfMonth(month)
    const a = assets.reduce((s, x) => s + assetValueAt(db, x.id, date), 0)
    const d = debts.reduce((s, x) => s + debtBalanceAt(x, month), 0)
    return { month, accounts: balance, assets: a, debts: d, net: balance + a - d }
  })
}

// ---------- scénarios ----------
export const listScenarios = (db: Db) => db.select().from(scenario).orderBy(scenario.createdAt).all() as Scenario[]
export const saveScenario = (db: Db, s: { id?: string; name: string; changes: Change[] }) =>
  s.id ? db.update(scenario).set({ name: s.name, changes: s.changes, updatedAt: now }).where(eq(scenario.id, s.id)).run()
    : db.insert(scenario).values({ name: s.name, changes: s.changes }).run()
export const deleteScenario = (db: Db, id: string) => db.delete(scenario).where(eq(scenario.id, id)).run()

/** Base des simulations : solde des comptes courants + flux nets prévus par le budget (repli : moyenne des 3 derniers mois). */
export function scenarioBase(db: Db, today: string, months: number) {
  const cur = currentPeriod(db, today)
  const plan = getBudget(db, cur, addMonths(cur, months - 1))
  const hist = getBudget(db, addMonths(cur, -3), addMonths(cur, -1))
  const avgNet = Math.round(hist.reduce((s, m) => s + m.actualIncome - m.actualExpense, 0) / Math.max(1, hist.length))
  // période en cours : seulement ce qui reste à recevoir / à payer (le déjà payé est dans le solde de départ)
  const toCome = (m: (typeof plan)[number]) => m.rows.reduce((t, r) => t + (r.kind === 'revenu' ? r.toCome : -r.toCome), 0)
  const base = plan.map((m) => ({ month: m.month, net: m.month === cur ? toCome(m) : m.rows.length ? m.plannedIncome - m.plannedExpense : avgNet }))
  return { start: liquidBalance(db), base }
}
export const runScenario = (db: Db, today: string, months: number, changes: Change[]) => {
  const { start, base } = scenarioBase(db, today, months)
  return simulate(start, base, changes)
}

// ---------- calendrier jour par jour ----------
/** Solde des comptes courants jour par jour : échéances suivies + dépense courante moyenne (hors charges fixes). */
export function financialCalendar(db: Db, today: string, days = 60) {
  const cur = currentPeriod(db, today)
  const hist = getBudget(db, addMonths(cur, -3), addMonths(cur, -1))
  const avgExpense = hist.reduce((s, m) => s + m.actualExpense, 0) / Math.max(1, hist.length)
  const fixed = -listRecurring(db).filter((r) => r.active && r.amount < 0).reduce((s, r) => s + monthlyEquivalent(r, r.amount), 0)
  const rav = resteAVivreFor(db, today)
  const dailyVariable = rav.envelopes > 0 ? Math.round(rav.envelopes / rav.daysLeft) : Math.max(0, Math.round((avgExpense - fixed) / 30.44))
  const to = new Date(Date.parse(today) + (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const events = occurrencesBetween(db, today, to).filter((o) => !o.paid).map((o) => ({ date: o.date, label: o.recurring.name, amount: o.recurring.amount }))
  return { dailyVariable, days: dailyForecast(liquidBalance(db), today, days, events, dailyVariable) }
}
export const accountsForGoals = (db: Db) => listAccounts(db).filter((a) => !a.archived)
