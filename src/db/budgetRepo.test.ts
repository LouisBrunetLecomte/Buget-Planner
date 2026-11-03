import { beforeEach, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { openDb, type Db } from './client'
import { seedDefaults } from './defaults'
import { seedDemo } from './seed'
import * as repo from './repo'
import * as b from './budgetRepo'

let SQL: SqlJsStatic, db: Db, cats: Map<string, string>
beforeEach(async () => { SQL ??= await initSqlJs(); db = openDb(SQL).db; cats = seedDefaults(db) })

it('réel par mois : ventilations converties, virements exclus', () => {
  const a = repo.createAccount(db, { name: 'A', type: 'courant' }), l = repo.createAccount(db, { name: 'L', type: 'epargne' })
  const t = repo.addTransaction(db, { accountId: a.id, date: '2026-10-03', amount: -10000, label: 'AMAZON' })
  repo.setSplits(db, t.id, [{ categoryId: cats.get('Maison')!, amount: -7000 }, { categoryId: cats.get('Courses')!, amount: -3000 }])
  repo.addTransaction(db, { accountId: a.id, date: '2026-10-04', amount: -500, label: 'X', categoryId: null })
  const o = repo.addTransaction(db, { accountId: a.id, date: '2026-10-05', amount: -9999, label: 'VIR' })
  const i = repo.addTransaction(db, { accountId: l.id, date: '2026-10-05', amount: 9999, label: 'VIR' })
  repo.linkTransfer(db, [o.id, i.id])
  const m = b.actualsBetween(db, '2026-10', '2026-10').get('2026-10')!
  expect(Object.fromEntries(m)).toEqual({ [cats.get('Maison')!]: -7000, [cats.get('Courses')!]: -3000, '': -500 })
})

it('portées : ce mois seulement, à partir de, tous les mois ; annulation d’exception', () => {
  const alim = cats.get('Alimentation')!
  b.setBudget(db, alim, '2026-01', 40000, 'all')
  b.setBudget(db, alim, '2026-07', 80000, 'month', 'Invités')
  b.setBudget(db, alim, '2026-09', 45000, 'from')
  const plan = (m: string) => b.getBudget(db, m, m)[0]!.rows.find((r) => r.categoryId === alim)!
  expect(plan('2026-06').planned).toBe(40000)
  expect(plan('2026-07')).toMatchObject({ planned: 80000, base: 40000 })
  expect(plan('2026-07').exception?.reason).toBe('Invités')
  expect(plan('2026-08').planned).toBe(40000)
  expect(plan('2026-12').planned).toBe(45000)
  b.removeException(db, plan('2026-07').exception!.id)
  expect(plan('2026-07').planned).toBe(40000)
  b.setBudget(db, alim, '2026-03', 30000, 'all')
  expect([plan('2026-01').planned, plan('2027-05').planned]).toEqual([30000, 30000])
  expect(() => b.setBudget(db, alim, '2026-03', -1, 'all')).toThrow()
})

it('démo : récurrences rapprochées, hausse Netflix, suggestions, budget et projection', () => {
  const fresh = openDb(SQL).db
  seedDemo(fresh, new Date('2026-11-03'))
  const st = b.recurringStatus(fresh, '2026-11-03')
  const netflix = st.find((s) => s.r.name === 'Netflix')!
  expect(netflix.increase).toMatchObject({ from: -1349, to: -1499 })
  expect(netflix.next).toBe('2026-11-15')
  expect(st.find((s) => s.r.name === 'Loyer')!.missed).toEqual([])
  expect(st.find((s) => s.r.name === 'Assurance habitation')!.monthly).toBe(-1500)
  // déjà suivis → pas resuggérés
  const sug = b.recurringSuggestions(fresh, '2026-11-03').map((s) => s.pattern)
  expect(sug).not.toContain('NETFLIX COM')
  expect(sug).toContain('NAVIGO ANNUEL')
  expect(sug).not.toContain('REVOLUT TOP UP') // virement interne en attente
  const nov = b.getBudget(fresh, '2026-11', '2027-10')
  expect(nov).toHaveLength(12)
  expect(nov[0]!.plannedIncome).toBeGreaterThan(200000)
  expect(nov[1]!.rows.find((r) => r.exception)?.exception?.reason).toBe('Vacances')
  const oct = b.occurrencesBetween(fresh, '2026-10-01', '2026-10-31')
  expect(oct.map((o) => o.recurring.name)).toContain('Impôt sur le revenu') // trimestriel
  expect(oct.filter((o) => !o.paid)).toEqual([]) // tout octobre est rapproché
  expect(b.occurrencesBetween(fresh, '2026-11-04', '2026-11-30').every((o) => !o.paid)).toBe(true)
  expect(b.liquidBalance(fresh)).toBeGreaterThan(0)
  // prélevé le jour même : l'échéance suivante est le mois prochain
  b.createRecurring(fresh, { name: 'Navigo', kind: 'charge', amount: -8640, freq: 'month', interval: 1, startDate: '2026-06-03', pattern: 'NAVIGO' })
  expect(b.recurringStatus(fresh, '2026-11-03').find((s) => s.r.name === 'Navigo')!.next).toBe('2026-12-03')
})
