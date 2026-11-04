import { beforeEach, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { openDb, type Db } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'

let SQL: SqlJsStatic, db: Db, cats: Map<string, string>
beforeEach(async () => { SQL ??= await initSqlJs(); db = openDb(SQL).db; cats = seedDefaults(db) })

it('classe à la saisie et à l’import, tes corrections passent avant, et le sens est respecté', () => {
  const acc = repo.createAccount(db, { name: 'LCL', type: 'courant', openingBalance: 0 })
  const add = (label: string, amount: number) => repo.addTransaction(db, { accountId: acc.id, date: '2026-11-03', amount, label })
  expect(add('CB PHARMACIE DU CENTRE', -1290).categoryId).toBe(cats.get('Pharmacie'))
  // la règle par défaut « CAF » (revenu) ne doit pas classer un café en aide
  expect(add('CB CAFE DU COIN', -350).categoryId).toBe(cats.get('Restaurants'))
  expect(add('VIR CAF DU RHONE', 25000).categoryId).toBe(cats.get('CAF / aides'))
  // une correction apprend : la suivante suit ta règle, pas la liste intégrée
  const t = add('CB GARAGE MARTIN', -8000)
  repo.updateTransaction(db, t.id, { categoryId: cats.get('Divers')! })
  expect(add('CB GARAGE MARTIN', -5000).categoryId).toBe(cats.get('Divers'))
  // import
  const p = repo.previewImport(db, acc.id, [{ date: '2026-11-02', amount: -4200, label: 'CB LECLERC DRIVE' }])
  expect(p.rows[0]!.categoryId).toBe(cats.get('Courses'))
})

it('« classer automatiquement » remplit les opérations non catégorisées', () => {
  const acc = repo.createAccount(db, { name: 'LCL', type: 'courant', openingBalance: 0 })
  const a = repo.addTransaction(db, { accountId: acc.id, date: '2026-11-03', amount: -2000, label: 'CB DECATHLON', categoryId: null })
  const b = repo.addTransaction(db, { accountId: acc.id, date: '2026-11-03', amount: -2000, label: 'VIR M DUPONT', categoryId: null })
  expect(repo.applyRulesToUncategorized(db)).toBe(1)
  const byId = new Map(repo.listTransactions(db).map((t) => [t.id, t.categoryId]))
  expect(byId.get(a.id)).toBe(cats.get('Sport'))
  expect(byId.get(b.id)).toBeNull()
})
