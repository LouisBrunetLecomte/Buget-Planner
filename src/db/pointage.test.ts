import { beforeEach, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { openDb, type Db } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'
import * as b from './budgetRepo'

let SQL: SqlJsStatic, db: Db, cats: Map<string, string>
beforeEach(async () => { SQL ??= await initSqlJs(); db = openDb(SQL).db; cats = seedDefaults(db) })
const row = (m: string, cat: string) => b.getBudget(db, m, m)[0]!.rows.find((r) => r.categoryId === cats.get(cat))!

it('cocher « reçu » / « payé » fait avancer le budget, le solde et tout le reste ; décocher annule', () => {
  expect(() => b.tickLine(db, cats.get('Courses')!, '2026-11', 40000, '2026-11-20')).toThrow(/compte/)
  const acc = repo.createAccount(db, { name: 'LCL', type: 'courant', openingBalance: 50000, balanceDate: '2026-11-01' })
  const sal = b.createRecurring(db, { name: 'Salaire', kind: 'revenu', amount: 210000, freq: 'month', interval: 1, startDate: '2026-11-12', dayOfMonth: 12, categoryId: cats.get('Salaire')! })
  const loyer = b.createRecurring(db, { name: 'Loyer', kind: 'charge', amount: -85000, freq: 'month', interval: 1, startDate: '2026-11-15', dayOfMonth: 15, categoryId: cats.get('Loyer / crédit')! })
  b.setBudget(db, cats.get('Courses')!, '2026-11', 40000, 'from')
  expect(b.periodDay(db)).toBe(12)
  expect(row('2026-11', 'Salaire')).toMatchObject({ planned: 210000, actual: 0 })

  // salaire reçu le 10, avant la date prévue : coché le 10, il compte pour la période du 12
  b.tickOccurrence(db, sal.id, '2026-11-12', '2026-11-10')
  expect(row('2026-11', 'Salaire')).toMatchObject({ actual: 210000, remaining: 0 })
  expect(repo.balances(db).get(acc.id)).toBe(260000)
  expect(b.occurrencesBetween(db, '2026-11-12', '2026-11-12')[0]).toMatchObject({ ticked: true })
  expect(b.recurringStatus(db, '2026-11-10').find((x) => x.r.id === sal.id)!.next).toBe('2026-12-12')

  b.tickOccurrence(db, loyer.id, '2026-11-15', '2026-11-16')
  b.tickOccurrence(db, loyer.id, '2026-11-15', '2026-11-16') // deux clics : une seule opération
  expect(row('2026-11', 'Loyer / crédit')).toMatchObject({ actual: 85000, remaining: 0 })
  b.tickLine(db, cats.get('Courses')!, '2026-11', 40000, '2026-11-20')
  expect(row('2026-11', 'Courses')).toMatchObject({ actual: 40000 })
  expect(repo.balances(db).get(acc.id)).toBe(50000 + 210000 - 85000 - 40000)
  expect(repo.listTransactions(db)).toHaveLength(3)

  b.untick(db, b.occurrenceRef(loyer.id, '2026-11-15'))
  expect(row('2026-11', 'Loyer / crédit').actual).toBe(0)
  expect(repo.balances(db).get(acc.id)).toBe(50000 + 210000 - 40000)
})
