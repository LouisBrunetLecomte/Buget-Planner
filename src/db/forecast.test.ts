import { beforeEach, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { openDb, type Db } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'
import * as b from './budgetRepo'
import { forecast, liquidProjection } from './analyticsRepo'
import { financialCalendar, scenarioBase } from './planningRepo'
import { addDays, daysBetween } from '@/core/dates'
import { periodKeyFor } from '@/core/period'

let SQL: SqlJsStatic, db: Db, cats: Map<string, string>
beforeEach(async () => { SQL ??= await initSqlJs(); db = openDb(SQL).db; cats = seedDefaults(db) })
const cat = (n: string) => cats.get(n)!
const monthly = (name: string, amount: number, startDate: string, category: string | null) =>
  b.createRecurring(db, { name, kind: amount > 0 ? 'revenu' : 'charge', amount, freq: 'month', interval: 1, startDate, categoryId: category && cat(category) })

it('Sami : sans budget variable, la prévision retire sa dépense réelle du quotidien', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 31280, balanceDate: '2026-10-31' })
  monthly('Salaire', 98000, '2026-10-12', 'Salaire')
  monthly('CAF', 18000, '2026-11-05', 'CAF / aides')
  monthly('Loyer', -41000, '2026-11-07', 'Loyer / crédit')
  monthly('Spotify', -1099, '2026-11-15', 'Abonnements')
  monthly('Free mobile', -1999, '2026-11-20', 'Internet / mobile')
  monthly('Netflix', -899, '2026-11-25', 'Abonnements')
  for (const [d, a] of [['2026-10-31', -2500], ['2026-11-01', -1800], ['2026-11-02', -3100], ['2026-11-03', -1200], ['2026-11-04', -1500]] as const)
    repo.addTransaction(db, { accountId: acc.id, date: d, amount: a, label: 'Boulangerie' })
  const f = forecast(db, '2026-11-04', 12)
  expect(f).toMatchObject({ dailyEveryday: 2020, observedDays: 5, confidence: 'low' })
  // chaque période pleine : 980 + 180 − 410 − 20,20 €/jour, au lieu de +750 €/mois
  const p = f.periods[3]!
  expect(p.balance - f.periods[2]!.balance).toBe(98000 + 18000 - 41000 - 3997 - 2020 * daysBetween(addDays(p.start, -1), p.end))
  expect(f.periods.at(-1)!.balance).toBeLessThan(100000) // avant : 8 411 €
  expect(b.resteAVivreFor(db, '2026-11-04')).toMatchObject({ confidence: 'low', dailyEveryday: 2020, end: '2026-11-11' })
})

it('une seule source : Aperçu, prévisions, simulations, jour par jour et à vivre donnent les mêmes soldes', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 120000, balanceDate: '2026-10-10' })
  monthly('Salaire', 145000, '2026-10-28', 'Salaire')
  monthly('Loyer', -52000, '2026-11-05', 'Loyer / crédit')
  monthly('Netflix', -1349, '2026-11-15', 'Abonnements')
  monthly('Remboursement Alexandre', -5000, '2026-11-01', null) // sans catégorie : hors budget, compté quand même
  b.setBudget(db, cat('Courses'), '2026-10', 20000, 'from')
  for (let k = 0; k < 20; k++) repo.addTransaction(db, { accountId: acc.id, date: addDays('2026-10-14', k), amount: -800 - k * 10, label: 'Kebab' })
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-01', amount: -4500, label: 'Carrefour', categoryId: cat('Courses') }) // budgété : hors quotidien
  const today = '2026-11-03', f = forecast(db, today, 6)
  expect(f.periods).toHaveLength(6)
  expect(f.confidence).toBe('ok')
  expect(f.dailyEveryday).toBe(Math.round((20 * 800 + 190 * 10) / 25))
  const at = new Map(f.days.map((d) => [d.date, d.balance]))
  for (const p of f.periods) expect(at.get(p.end)).toBe(p.balance)
  expect(liquidProjection(db, today, 6).map((p) => p.balance)).toEqual(f.periods.map((p) => p.balance))
  const s = scenarioBase(db, today, 6)
  expect(s.start).toBe(f.start)
  let run = s.start
  expect(s.base.map((x) => (run += x.net))).toEqual(f.periods.map((p) => p.balance))
  for (const d of financialCalendar(db, today, 60).days) expect(d.balance).toBe(at.get(d.date))
  const rav = b.resteAVivreFor(db, today)
  expect(rav.forecastEnd).toBe(f.periods[0]!.balance)
  expect(rav.amount - f.dailyEveryday * daysBetween(today, rav.end)).toBe(rav.forecastEnd)
  // période future : revenus prévus − dépenses prévues − quotidien − hors budget = variation du solde
  for (let i = 1; i < 6; i++) {
    const p = f.periods[i]!, m = b.getBudget(db, p.key, p.key)[0]!
    expect(p.balance - f.periods[i - 1]!.balance).toBe(m.plannedIncome - m.plannedExpense - p.everyday - 5000)
  }
})

it('Annecy : un ponctuel de 220 € en décembre baisse décembre et la suite de 220 € exactement', () => {
  repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 64000, balanceDate: '2026-11-03' })
  monthly('Salaire', 145000, '2026-10-28', 'Salaire')
  b.setBudget(db, cat('Courses'), '2026-10', 20000, 'from')
  const before = forecast(db, '2026-11-03', 6).periods
  const dec = periodKeyFor('2026-12', b.periodDay(db))
  expect(dec).toBe('2026-11') // paie le 28 : « décembre » = 28 nov. → 27 déc.
  b.addOneOff(db, { categoryId: cat('Voyages'), period: dec, amount: 22000, reason: 'Annecy' })
  const after = forecast(db, '2026-11-03', 6).periods
  expect(after.map((p, i) => before[i]!.balance - p.balance)).toEqual([0, 22000, 22000, 22000, 22000, 22000])
  expect(after[1]).toMatchObject({ name: '2026-12', oneOff: 22000 })
})

it('Navigo : une échéance du jour cochée est comprise dans le solde confirmé, dans les deux ordres', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 0, balanceDate: '2026-11-01' })
  const navigo = monthly('Navigo', -8640, '2026-11-03', 'Transports en commun')
  const edf = monthly('EDF', -6000, '2026-11-07', 'Énergie')
  repo.confirmBalance(db, acc.id, 64000, '2026-11-03')
  expect(b.tickOccurrence(db, navigo.id, '2026-11-03', '2026-11-03')).toBe('cree')
  expect(repo.balances(db).get(acc.id)).toBe(64000)
  b.tickOccurrence(db, edf.id, '2026-11-07', '2026-11-03') // payée en avance : elle compte
  expect(repo.balances(db).get(acc.id)).toBe(64000 - 6000)

  b.untick(db, b.occurrenceRef(edf.id, '2026-11-07'))
  b.untick(db, b.occurrenceRef(navigo.id, '2026-11-03'))
  b.tickOccurrence(db, navigo.id, '2026-11-03', '2026-11-03') // cochée d'abord, solde confirmé ensuite
  repo.confirmBalance(db, acc.id, 64000, '2026-11-03')
  expect(repo.balances(db).get(acc.id)).toBe(64000)
})

it('CAF saisie au Journal : l’échéance sans motif est retrouvée, la cocher ne crée rien', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 31280, balanceDate: '2026-11-01' })
  const caf = monthly('CAF', 18000, '2026-11-05', 'CAF / aides')
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-05', amount: 18000, label: 'CAF' })
  expect(b.occurrencesBetween(db, '2026-11-05', '2026-11-05')[0]!.paid).not.toBeNull()
  expect(b.tickOccurrence(db, caf.id, '2026-11-05', '2026-11-05')).toBe('deja')
  expect(repo.listTransactions(db)).toHaveLength(1)
  expect(b.resteAVivreFor(db, '2026-11-05').incoming).toBe(0)
  // même catégorie, autre libellé, montant proche : retrouvée aussi ; montant trop différent : non
  const apl = monthly('APL', 25000, '2026-11-08', 'CAF / aides')
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-09', amount: 9000, label: 'Virement aide', categoryId: cat('CAF / aides') })
  expect(b.occurrencesBetween(db, '2026-11-08', '2026-11-08').find((o) => o.recurring.id === apl.id)!.paid).toBeNull()
})

it('changer la catégorie sans ventilation la conserve', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant' })
  const t = repo.addTransaction(db, { accountId: acc.id, date: '2026-11-02', amount: -6000, label: 'TOTALENERGIES' })
  repo.updateTransaction(db, t.id, { categoryId: cat('Carburant') })
  repo.setSplits(db, t.id, [])
  expect(repo.listTransactions(db)[0]!.categoryId).toBe(cat('Carburant'))
})

it('« une seule fois » : pleine en période de démarrage, absente le mois suivant ; catégories retrouvées', () => {
  monthly('Salaire', 145000, '2026-10-28', 'Salaire')
  repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 64000, balanceDate: '2026-11-03' })
  b.addOneOff(db, { categoryId: cat('Divers'), period: '2026-10', amount: 7500, reason: 'Cadeau' })
  const row = (k: string) => b.getBudget(db, k, k)[0]!.rows.find((r) => r.categoryId === cat('Divers'))
  expect(row('2026-10')!.toCome).toBe(7500)
  expect(row('2026-11')).toBeUndefined()
  b.addOneOff(db, { categoryId: cat('Voyages'), period: '2026-10', amount: 4000, day: 5 }) // datée : le 5 de la période 28 oct. → 27 nov.
  expect(b.listRecurring(db).find((r) => r.categoryId === cat('Voyages'))).toMatchObject({ startDate: '2026-11-05', endDate: '2026-11-05', amount: -4000 })
  expect(row('2026-10')).toBeDefined()
  expect(b.findCategory(db, 'primes', 'revenu')?.name).toBe('Primes')
  expect(b.findCategory(db, 'prime', 'revenu')?.name).toBe('Primes')
  repo.createCategory(db, { name: 'Électricité', kind: 'depense' })
  expect(b.findCategory(db, 'electricite', 'depense')?.name).toBe('Électricité')
  expect(b.findCategory(db, 'caf / aides', 'revenu')?.name).toBe('CAF / aides')
  expect(b.findCategory(db, 'electricite', 'revenu')).toBeNull()
})

it('virement vers l’épargne : le livret grossit, le total ne bouge pas', () => {
  const cur = repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 300000, balanceDate: '2026-11-01' })
  const livret = repo.createAccount(db, { name: 'Livret A', type: 'epargne', openingBalance: 100000, balanceDate: '2026-11-01' })
  monthly('Salaire', 238000, '2026-10-31', 'Salaire')
  const total0 = forecast(db, '2026-11-03', 4, 'total').periods.map((p) => p.balance)
  const liquid0 = forecast(db, '2026-11-03', 4).periods.map((p) => p.balance)
  const v = b.createSavingsTransfer(db, { name: 'Livret A', fromAccountId: cur.id, toAccountId: livret.id, amount: 20000, day: 10, startMonth: '2026-10' })
  expect(forecast(db, '2026-11-03', 4, 'total').periods.map((p) => p.balance)).toEqual(total0)
  const liquid1 = forecast(db, '2026-11-03', 4)
  expect(liquid1.periods.map((p, i) => liquid0[i]! - p.balance)).toEqual([20000, 40000, 60000, 80000])
  expect(liquid1.periods[0]!.savings).toBe(20000)
  const tot = b.totalBalance(db)
  expect(b.tickOccurrence(db, v.id, '2026-11-10', '2026-11-10')).toBe('cree')
  expect(b.liquidBalance(db)).toBe(300000 - 20000)
  expect(repo.balances(db).get(livret.id)).toBe(120000)
  expect(b.totalBalance(db)).toBe(tot)
  expect(b.getBudget(db, '2026-10', '2026-10')[0]!.actualExpense).toBe(0) // pas une dépense
  b.untick(db, b.occurrenceRef(v.id, '2026-11-10'))
  expect(repo.listTransactions(db)).toHaveLength(0)
})

it('corriger le sens d’une ligne et d’une échéance', () => {
  const netflix = repo.createCategory(db, { name: 'Netflix', kind: 'revenu' })
  const r = monthly('Netflix', 1349, '2026-11-15', null)
  b.updateRecurring(db, r.id, { categoryId: netflix.id })
  expect(b.changeLineKind(db, netflix.id, 'depense')).toBe(netflix.id)
  expect(b.listRecurring(db)[0]).toMatchObject({ kind: 'charge', amount: -1349 })
  b.updateRecurringFrom(db, r.id, '2026-11', { endDate: '2027-02-15', kind: 'abonnement' })
  expect(b.listRecurring(db)[0]).toMatchObject({ kind: 'abonnement', amount: -1349, endDate: '2027-02-15' })
})

it('moins de 3 jours de données : quotidien non compté, confiance « none »', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 50000, balanceDate: '2026-11-02' })
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-02', amount: -3000, label: 'Kebab' })
  expect(forecast(db, '2026-11-03', 2)).toMatchObject({ confidence: 'none', dailyEveryday: 0, observedDays: 2 })
})
