import { beforeAll, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { openDb, type Db } from './client'
import { seedDemo } from './seed'
import * as p from './planningRepo'
import { totalBalance } from './budgetRepo'

const today = '2026-11-03'
let db: Db
beforeAll(async () => { db = openDb(await initSqlJs()).db; seedDemo(db, new Date(today)) })

it('objectifs : contributions, compte lié, versement suggéré', () => {
  const st = p.goalsStatus(db, today)
  const japon = st.find((x) => x.g.name === 'Voyage au Japon')!
  expect(japon.current).toBe(125_000)
  expect(japon.monthly).toBe(Math.ceil(275_000 / 11))
  expect(st.find((x) => x.g.name === 'Épargne de précaution')!.current).toBeGreaterThan(640_000)
  expect(p.savingsRuleAmounts(db, '2026-10')[0]!.amount).toBeGreaterThan(0)
})

it('patrimoine net = comptes + biens − dettes, historique 12 mois', () => {
  const nw = p.netWorth(db, today)
  expect(nw.net).toBe(totalBalance(db) + nw.assetsTotal - nw.debtsTotal)
  expect(nw.debtsTotal).toBeGreaterThan(0)
  expect(nw.debtsTotal).toBeLessThan(1_200_000)
  const h = p.netWorthHistory(db, today)
  expect(h).toHaveLength(12)
  expect(h[0]!.debts).toBeGreaterThan(h.at(-1)!.debts) // le capital restant dû baisse
})

it('dette invalide refusée', () => expect(() => p.createDebt(db, { name: 'x', principal: 1_000_000, rate: 20, payment: 1_000, startMonth: '2026-01' })).toThrow())

it('scénario : la perte d’emploi creuse le solde', () => {
  const sc = p.listScenarios(db)[0]!
  const base = p.runScenario(db, today, 12, []), what = p.runScenario(db, today, 12, sc.changes)
  expect(what.at(-1)!.balance).toBe(base.at(-1)!.balance - 3 * 95_000)
})

it('calendrier jour par jour', () => {
  const c = p.financialCalendar(db, today, 30)
  expect(c.days).toHaveLength(30)
  expect(c.days.find((d) => d.events.some((e) => e.label === 'Loyer'))!.date).toBe('2026-11-05')
  expect(c.dailyVariable).toBeGreaterThan(0)
})
