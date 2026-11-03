import { beforeAll, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { openDb, type Db } from './client'
import { seedDemo } from './seed'
import * as repo from './repo'
import * as b from './budgetRepo'
import * as an from './analyticsRepo'

const today = '2026-11-03'
let db: Db
beforeAll(async () => { db = openDb(await initSqlJs()).db; seedDemo(db, new Date(today)) })

it('historique de solde cohérent avec les soldes des comptes', () => {
  const h = an.balanceHistory(db, '2026-01-01', today)
  // comptes en devise : arrondi au centime par jour, d'où ±2 centimes
  expect(Math.abs(h.at(-1)!.balance - b.totalBalance(db))).toBeLessThanOrEqual(2)
  expect(Math.abs(an.balanceHistory(db, '2026-10-01', today, true).at(-1)!.balance - b.liquidBalance(db))).toBeLessThanOrEqual(2)
  const f = an.balanceAndForecast(db, today, 6)
  expect(f.hist).toHaveLength(12)
  expect(f.proj).toHaveLength(6)
})

it('Sankey équilibré', () => {
  const s = an.sankeyData(db, '2026-10')
  const into = s.links.filter((l) => l.target === s.links[0]!.target).reduce((t, l) => t + l.value, 0)
  const out = s.links.filter((l) => l.source === s.links[0]!.target).reduce((t, l) => t + l.value, 0)
  expect(into).toBe(out)
  expect(s.nodes.map((n) => n.name)).toContain('Salaire')
  expect(s.nodes.length).toBeLessThanOrEqual(1 + 3 + 9)
})

it('répartition et totaux', () => {
  const sp = an.spendingByRoot(db, '2026-10')
  expect(sp.rows[0]!.amount).toBeGreaterThanOrEqual(sp.rows.at(-1)!.amount)
  expect(sp.rows.reduce((s, r) => s + r.amount, 0)).toBe(sp.total)
  expect(an.monthlyTotals(db, today)).toHaveLength(12)
  expect(an.yearOverYear(db, 2026)).toHaveLength(12)
})

it('alertes de démo : échéance du loyer, frais bancaires ; masquage', () => {
  const a = an.alerts(db, today)
  expect(a.map((x) => x.id)).toContain('echeance:Loyer:2026-11-05')
  expect(a.some((x) => x.type === 'anomalie' && x.title === 'Frais bancaires')).toBe(true)
  an.dismissAlert(db, 'echeance:Loyer:2026-11-05')
  expect(an.alerts(db, today).map((x) => x.id)).not.toContain('echeance:Loyer:2026-11-05')
})

it('doublon saisie manuelle puis import', () => {
  const acc = repo.listAccounts(db).find((x) => x.name === 'Compte courant')!
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-02', amount: -1990, label: 'Pharmacie' })
  repo.importRows(db, acc.id, 'x.csv', [{ date: '2026-11-03', amount: -1990, label: 'CB PHARMACIE DU PARC' }])
  expect(an.alerts(db, today).find((x) => x.title === 'Doublon probable')?.body).toMatch(/Pharmacie/)
})

it('score de santé', () => {
  const h = an.health(db, today)
  expect(h.score).toBeGreaterThan(30)
  expect(h.score).toBeLessThanOrEqual(100)
  expect(h.parts).toHaveLength(5)
})
