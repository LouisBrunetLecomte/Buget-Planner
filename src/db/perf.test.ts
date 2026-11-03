import { expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { openDb, exportDb } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'
import { getBudget } from './budgetRepo'
import { alerts } from './analyticsRepo'

// 10 ans d'opérations (~ 20 000) : les écrans principaux doivent rester fluides
it('performance sur 20 000 opérations', async () => {
  const SQL = await initSqlJs(), { db, sqlite } = openDb(SQL)
  seedDefaults(db)
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant' })
  const rows = Array.from({ length: 20_000 }, (_, i) => ({ date: new Date(Date.UTC(2017, 0, 1) + i * 4.3 * 3600_000).toISOString().slice(0, 10), amount: -((i * 37) % 9000) - 100, label: ['CB CARREFOUR', 'CB LIDL', 'UBER EATS', 'SNCF', 'AMAZON'][i % 5]! + ' ' + (i % 97) }))
  let t = performance.now()
  repo.importRows(db, acc.id, 'gros.csv', rows)
  const importMs = performance.now() - t
  t = performance.now(); repo.listTransactions(db, { q: 'lidl', limit: 1000 }); const searchMs = performance.now() - t
  t = performance.now(); getBudget(db, '2026-01', '2026-12'); const budgetMs = performance.now() - t
  t = performance.now(); alerts(db, '2026-11-03'); const alertsMs = performance.now() - t
  t = performance.now(); const bytes = exportDb(sqlite); const exportMs = performance.now() - t
  console.log({ importMs, searchMs, budgetMs, alertsMs, exportMs, mo: (bytes.byteLength / 1e6).toFixed(1) })
  expect(searchMs).toBeLessThan(200)
  expect(budgetMs).toBeLessThan(500)
  expect(alertsMs).toBeLessThan(1500)
  expect(exportMs).toBeLessThan(200)
}, 60_000)
