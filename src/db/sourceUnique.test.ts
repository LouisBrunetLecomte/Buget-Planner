import { beforeEach, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { openDb, type Db } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'
import * as b from './budgetRepo'
import * as p from './planningRepo'
import { liquidProjection } from './analyticsRepo'
import { occurrences } from '@/core/recurring'
import { paymentFor } from '@/core/debt'

let SQL: SqlJsStatic, db: Db, cats: Map<string, string>
beforeEach(async () => { SQL ??= await initSqlJs(); db = openDb(SQL).db; cats = seedDefaults(db) })
const row = (m: string, cat: string) => b.getBudget(db, m, m)[0]!.rows.find((r) => r.categoryId === cats.get(cat))

it('le loyer saisi une fois alimente budget, calendrier, prévisions ; le modifier change tout', () => {
  repo.putSetting(db, 'periodStartDay', 1) // ce test raisonne en mois calendaires
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant', openingBalance: 300000, balanceDate: '2026-11-01' })
  const loyer = b.createRecurring(db, { name: 'Loyer', kind: 'charge', amount: -92000, freq: 'month', interval: 1, startDate: '2026-01-05', categoryId: cats.get('Loyer / crédit')!, accountId: acc.id })
  b.createRecurring(db, { name: 'Salaire', kind: 'revenu', amount: 250000, freq: 'month', interval: 1, startDate: '2026-01-28', categoryId: cats.get('Salaire')! })
  expect(row('2026-11', 'Loyer / crédit')).toMatchObject({ source: 'echeances', planned: 92000 })
  expect(row('2026-11', 'Loyer / crédit')!.items[0]!.date).toBe('2026-11-05')
  expect(row('2026-12', 'Salaire')).toMatchObject({ planned: 250000 })
  const before = liquidProjection(db, '2026-11-02', 3).at(-1)!.balance

  // nouveau loyer à partir de janvier : le passé garde 920 €, la suite passe à 950 €, le prélèvement le 3
  b.updateRecurringFrom(db, loyer.id, '2027-01', { amount: -95000, day: 3 })
  expect(row('2026-12', 'Loyer / crédit')!.planned).toBe(92000)
  expect(row('2027-01', 'Loyer / crédit')).toMatchObject({ planned: 95000 })
  expect(row('2027-01', 'Loyer / crédit')!.items[0]!.date).toBe('2027-01-03')
  expect(b.occurrencesBetween(db, '2027-01-01', '2027-01-31').map((o) => [o.recurring.name, o.date, o.recurring.amount])).toContainEqual(['Loyer', '2027-01-03', -95000])
  expect(liquidProjection(db, '2026-11-02', 3).at(-1)!.balance).toBe(before - 3000) // seul janvier change dans l'horizon

  // modification « depuis le début » : sur place
  const first = b.listRecurring(db).find((r) => r.name === 'Loyer' && r.endDate)!
  b.updateRecurringFrom(db, first.id, '2026-01', { amount: -90000 })
  expect(row('2026-06', 'Loyer / crédit')!.planned).toBe(90000)
})

it('dernier jour du mois et jour 31 ramenés correctement', () => {
  const r = b.createRecurring(db, { name: 'Salaire', kind: 'revenu', amount: 1, freq: 'month', interval: 1, startDate: '2026-11-30', dayOfMonth: 31, categoryId: cats.get('Salaire')! })
  expect(occurrences(r, '2026-11-01', '2027-02-28')).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'])
})

it('une ligne saisie l’emporte ; « Proposer un budget » ne recompte pas le loyer', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant' })
  b.createRecurring(db, { name: 'Loyer', kind: 'charge', amount: -92000, freq: 'month', interval: 1, startDate: '2026-01-05', categoryId: cats.get('Loyer / crédit')! })
  for (const m of ['08', '09', '10']) {
    repo.addTransaction(db, { accountId: acc.id, date: `2026-${m}-05`, amount: -92000, label: 'LOYER', categoryId: cats.get('Loyer / crédit')! })
    repo.addTransaction(db, { accountId: acc.id, date: `2026-${m}-08`, amount: -6000, label: 'EDF', categoryId: cats.get('Énergie')! })
  }
  const s = b.suggestBudget(db, '2026-11')
  expect(s).toEqual([{ categoryId: cats.get('Logement')!, amount: 6000 }]) // 980 € moyens − 920 € de loyer déjà prévus
})

it('solde saisi « aujourd’hui » : les opérations importées d’avant ne s’ajoutent pas une deuxième fois', () => {
  const acc = repo.createAccount(db, { name: 'LCL', type: 'courant', openingBalance: 125000, balanceDate: '2026-11-03' })
  repo.importRows(db, acc.id, 'r.csv', [{ date: '2026-10-15', amount: -5000, label: 'A' }, { date: '2026-11-03', amount: -1000, label: 'B' }])
  expect(repo.balances(db).get(acc.id)).toBe(125000)
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-04', amount: -2000, label: 'C' })
  expect(repo.balances(db).get(acc.id)).toBe(123000)
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-03', amount: -500, label: 'Saisi le jour même, après le solde' })
  expect(repo.balances(db).get(acc.id)).toBe(122500)
})

it('crédit : sa mensualité devient une charge fixe datée, supprimée avec lui', () => {
  const pay = paymentFor(1_200_000, 3.9, 48)
  const d = p.createDebt(db, { name: 'Auto', principal: 1_200_000, rate: 3.9, payment: pay, startMonth: '2026-01' }, 10)
  const r = b.listRecurring(db).find((x) => x.debtId === d.id)!
  expect(r).toMatchObject({ amount: -pay, startDate: '2026-01-10', endDate: '2029-12-31' })
  expect(row('2026-11', 'Loyer / crédit')!.planned).toBe(pay)
  p.deleteDebt(db, d.id)
  expect(b.listRecurring(db)).toHaveLength(0)
})

it('budget de paie à paie : salaire le 12 → période du 12 au 11, salaire en avance rattaché à la bonne période', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant' })
  b.createRecurring(db, { name: 'Salaire', kind: 'revenu', amount: 250000, freq: 'month', interval: 1, startDate: '2026-01-12', dayOfMonth: 12, pattern: 'SALAIRE ACME', categoryId: cats.get('Salaire')! })
  b.createRecurring(db, { name: 'Loyer', kind: 'charge', amount: -92000, freq: 'month', interval: 1, startDate: '2026-01-05', categoryId: cats.get('Loyer / crédit')! })
  expect(b.periodDay(db)).toBe(12) // déduit du salaire
  expect(b.periodBounds(db, '2026-11')).toMatchObject({ start: '2026-11-12', end: '2026-12-11', label: '12 nov. → 11 déc. 2026' })
  expect(b.currentPeriod(db, '2026-11-11')).toBe('2026-10')
  // période « novembre » : le loyer qui tombe dedans est celui du 5 décembre
  expect(row('2026-11', 'Loyer / crédit')!.items.map((i) => i.date)).toEqual(['2026-12-05'])
  // salaire de novembre versé le mardi 10 (en avance) : il compte pour la période qui commence le 12, pas pour la précédente
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-10', amount: 250000, label: 'VIR SALAIRE ACME NOV' })
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-11', amount: -4000, label: 'CB COURSES', categoryId: cats.get('Courses')! })
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-12', amount: -3000, label: 'CB COURSES', categoryId: cats.get('Courses')! })
  const a = b.actualsBetween(db, '2026-10', '2026-11')
  expect(a.get('2026-11')!.get('')).toBe(250000)
  expect(a.get('2026-10')!.get(cats.get('Courses')!)).toBe(-4000)
  expect(a.get('2026-11')!.get(cats.get('Courses')!)).toBe(-3000)
  // réglage manuel : retour aux mois calendaires
  repo.putSetting(db, 'periodStartDay', 1)
  expect(b.actualsBetween(db, '2026-11', '2026-11').get('2026-11')!.get(cats.get('Courses')!)).toBe(-7000)
})
