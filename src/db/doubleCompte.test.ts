import { beforeEach, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { openDb, type Db } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'
import * as b from './budgetRepo'

let SQL: SqlJsStatic, db: Db
beforeEach(async () => { SQL ??= await initSqlJs(); db = openDb(SQL).db; seedDefaults(db) })

it('cocher « payé » après avoir noté la dépense dans le Journal ne la compte pas deux fois', () => {
  const acc = repo.createAccount(db, { name: 'LCL', type: 'courant', openingBalance: 50000, balanceDate: '2026-11-01' })
  const P = b.currentPeriod(db, '2026-11-04')
  const ann = repo.createCategory(db, { name: 'Annecy', kind: 'depense' }).id, pret = repo.createCategory(db, { name: 'Prêt', kind: 'depense' }).id
  b.addOneOff(db, { categoryId: ann, period: P, amount: 22000 })
  b.setBudget(db, pret, P, 5000, 'from')
  const row = (c: string) => b.getBudget(db, P, P)[0]!.rows.find((r) => r.categoryId === c)!
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-03', amount: -22000, label: 'Annecy', categoryId: ann })
  repo.addTransaction(db, { accountId: acc.id, date: '2026-11-03', amount: -2000, label: 'Prêt', categoryId: pret })
  b.tickLine(db, ann, P, 22000, '2026-11-04')
  b.tickLine(db, pret, P, 5000, '2026-11-04')
  expect(row(ann).actual).toBe(22000) // rien d'ajouté
  expect(row(pret).actual).toBe(5000) // seulement les 30 € manquants
  expect(repo.balances(db).get(acc.id)).toBe(50000 - 22000 - 5000)
})
