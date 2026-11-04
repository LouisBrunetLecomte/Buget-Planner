import { and, gte, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from './client'
import { account, transaction } from './schema'
import { balances, cachedRates, listCategories } from './repo'
import { appStart, currentPeriod, getBudget, listRecurring, occurrencesBetween, periodBounds, resteAVivreFor, forecast } from './budgetRepo'
import { addDays, addMonths } from '@/core/dates'
import { rateOn } from '@/core/fx'
import { monthlyEquivalent } from '@/core/recurring'
import { budgetStreak, challenges, noSpendDays } from '@/core/challenges'
import { coach, spendingProfile, type Advice, type Profile, type SpendTx } from '@/core/coach'

/** Dépenses d'une période, en distinguant les échéances (loyer, abonnements…) des dépenses du quotidien. */
function periodTxs(db: Db, key: string): { txs: SpendTx[]; start: string; end: string } {
  const { start, end } = periodBounds(db, key)
  const settled = new Set(occurrencesBetween(db, start, end).flatMap((o) => (o.paid ? [o.paid.id] : [])))
  const rows = db.select().from(transaction).where(and(gte(transaction.date, start), lte(transaction.date, end), isNull(transaction.transferGroupId))).all()
  return {
    start, end,
    txs: rows.map((t) => ({ id: t.id, date: t.date, amount: t.amountEur, categoryId: t.categoryId, label: t.label, labelNorm: t.labelNorm,
      fixed: settled.has(t.id) || !!t.plannedRef?.startsWith('rec:') })),
  }
}

export interface PeriodReport {
  key: string; start: string; end: string; current: boolean
  profile: Profile; previous: Profile | null
  income: number; savingRate: number | null
  advice: Advice[]
  catName: (id: string | null) => string
}

/** Bilan d'une période : profil de dépenses, comparaison avec la précédente et conseils sur mesure. */
export function periodReport(db: Db, key: string, today: string): PeriodReport {
  const cats = listCategories(db)
  const catName = (id: string | null) => (id ? cats.find((c) => c.id === id)?.name ?? '?' : 'Non catégorisé')
  const cur = periodTxs(db, key), prev = periodTxs(db, addMonths(key, -1))
  const profile = spendingProfile(cur.txs, cur.start, cur.end, today)
  // période en cours : on compare à la même date de la période précédente (4 jours contre 4 jours, pas contre 30)
  const isCurrentKey = key === currentPeriod(db, today)
  const prevUntil = isCurrentKey ? addDays(prev.start, profile.elapsed - 1) : today
  const previous = prev.txs.some((t) => t.amount < 0) ? spendingProfile(prev.txs, prev.start, prev.end, prevUntil) : null
  const m = getBudget(db, key, key)[0]!
  const income = m.actualIncome || m.plannedIncome

  // dépense mensuelle de référence : moyenne des 3 périodes précédentes, à défaut le prévu
  const past = getBudget(db, addMonths(key, -3), addMonths(key, -1)).filter((x) => x.actualExpense > 0)
  const monthlyExpense = past.length ? past.reduce((s, x) => s + x.actualExpense, 0) / past.length : m.plannedExpense
  const bal = balances(db)
  const savingsBalance = db.select().from(account).all().filter((a) => !a.archived && a.type === 'epargne')
    .reduce((s, a) => s + (a.currency === 'EUR' ? bal.get(a.id) ?? 0 : Math.round((bal.get(a.id) ?? 0) * (rateOn(cachedRates(db, a.currency), '9999') ?? 0))), 0)
  const rec = listRecurring(db).filter((r) => r.active && (!r.endDate || r.endDate >= today))
  const monthly = (rs: typeof rec) => Math.abs(rs.reduce((s, r) => s + monthlyEquivalent(r, r.amount), 0))
  const transfertIds = new Set(cats.filter((c) => c.kind === 'transfert').map((c) => c.id))
  // vrais crédits (liés à un prêt) et remboursements de dettes ; pas « Loyer / crédit », qui est surtout un loyer
  const debtCats = new Set(cats.filter((c) => /dette|remboursement/i.test(c.name) && c.kind === 'depense').map((c) => c.id))
  const subs = rec.filter((r) => r.kind === 'abonnement')
  const feesCat = cats.find((c) => c.name === 'Frais bancaires')?.id
  const isCurrent = key === currentPeriod(db, today)
  const endBalance = isCurrent ? resteAVivreFor(db, today).forecastEnd
    : key > currentPeriod(db, today) ? forecast(db, today, 13).periods.find((p) => p.key === key)?.balance ?? 1 : 1

  const advice = coach({
    profile, previous, catName, income, monthlyExpense, savingsBalance,
    savingsPerPeriod: monthly(rec.filter((r) => r.toAccountId || (r.categoryId && transfertIds.has(r.categoryId)))),
    debtPerPeriod: monthly(rec.filter((r) => r.debtId || (r.categoryId && debtCats.has(r.categoryId)))),
    subscriptionsPerPeriod: monthly(subs), subscriptionsCount: subs.length,
    needs: m.buckets.besoin.actual, wants: m.buckets.envie.actual,
    overspent: m.rows.filter((r) => r.kind === 'depense' && r.actual > 0 && r.remaining < 0).map((r) => ({ name: catName(r.categoryId), over: -r.remaining })),
    fees: -cur.txs.filter((t) => t.amount < 0 && t.categoryId === feesCat).reduce((s, t) => s + t.amount, 0),
    endBalance,
  })
  // taux d'épargne seulement sur des revenus réellement reçus (sinon « 95 % gardés » avant même la paie)
  return { key, start: cur.start, end: cur.end, current: isCurrent, profile, previous, income: m.actualIncome, savingRate: m.actualIncome > 0 ? (m.actualIncome - profile.spent) / m.actualIncome : null, advice, catName }
}

/** Défis de la période, série de périodes dans le budget, et catégories tenues ou dépassées. */
export function periodChallenges(db: Db, r: PeriodReport, today: string) {
  const m = getBudget(db, r.key, r.key)[0]!, p = r.profile
  const finished = r.end < today
  const lastDone = finished ? r.key : addMonths(r.key, -1)
  // seulement depuis le début des données : une période vide avant l'app n'est pas une période « tenue »
  const started = appStart(db) ?? db.select({ d: sql<string | null>`min(${transaction.date})` }).from(transaction).get()?.d ?? null, first = started ? currentPeriod(db, started) : lastDone, from = addMonths(lastDone, -23)
  const streak = first > lastDone ? { current: 0, best: 0 }
    : budgetStreak(getBudget(db, first > from ? first : from, lastDone).map((x) => ({ planned: x.plannedExpense, actual: x.actualExpense })))
  const rows = m.rows.filter((x) => x.kind === 'depense' && x.planned + x.carry > 0)
  return {
    streak,
    list: challenges({
      noSpend: noSpendDays(p.daily, today), elapsed: p.elapsed, days: p.days, finished,
      planned: m.plannedExpense, actual: m.actualExpense, savingRate: r.savingRate,
      variable: p.variable, previousVariable: r.previous?.variable ?? null,
    }),
    wins: rows.filter((x) => x.remaining >= 0 && x.actual > 0).sort((a, b) => b.remaining - a.remaining).slice(0, 3).map((x) => ({ name: r.catName(x.categoryId), left: x.remaining })),
    misses: rows.filter((x) => x.remaining < 0).sort((a, b) => a.remaining - b.remaining).slice(0, 3).map((x) => ({ name: r.catName(x.categoryId), over: -x.remaining })),
  }
}
