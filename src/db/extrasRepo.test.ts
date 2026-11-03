import { beforeEach, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { openDb, exportDb, type Db } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'
import * as x from './extrasRepo'
import { listCategories } from './repo'

let SQL: SqlJsStatic, db: Db, sqlite: ReturnType<typeof openDb>['sqlite']
beforeEach(async () => { SQL ??= await initSqlJs(); const o = openDb(SQL); db = o.db; sqlite = o.sqlite; seedDefaults(db) })

it('pièces jointes : stockage binaire, contrôle du format, suppression en cascade', () => {
  const a = repo.createAccount(db, { name: 'A', type: 'courant' })
  const t = repo.addTransaction(db, { accountId: a.id, date: '2026-10-01', amount: -500, label: 'X' })
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])
  const { id } = x.addAttachment(db, t.id, 'ticket.jpg', 'image/jpeg', bytes)
  expect(() => x.addAttachment(db, t.id, 'x.exe', 'application/octet-stream', bytes)).toThrow(/Formats/)
  const reopened = openDb(SQL, exportDb(sqlite)).db
  expect([...x.getAttachment(reopened, id)!.data]).toEqual([...bytes])
  // conditions du navigateur : pas de Buffer → Drizzle décoderait le BLOB en texte ; la lecture directe doit rester intacte
  const B = globalThis.Buffer
  try { (globalThis as { Buffer?: unknown }).Buffer = undefined; expect([...x.getAttachment(reopened, id)!.data]).toEqual([...bytes]) }
  finally { globalThis.Buffer = B }
  expect(JSON.parse(x.exportAllJson(db)).tables.attachment[0].data).toBe(btoa(String.fromCharCode(...bytes)))
  repo.deleteTransactions(db, [t.id])
  expect(x.getAttachment(db, id)).toBeUndefined()
})

it('freelance : TVA collectée / déductible, export comptable', () => {
  const a = repo.createAccount(db, { name: 'Pro', type: 'courant' })
  const f = repo.addTransaction(db, { accountId: a.id, date: '2026-10-05', amount: 120000, label: 'Facture client' })
  const d = repo.addTransaction(db, { accountId: a.id, date: '2026-10-06', amount: -2400, label: 'Logiciel' })
  repo.updateTransaction(db, f.id, { pro: true, vatRate: 20 })
  repo.updateTransaction(db, d.id, { pro: true, vatRate: 20, expenseReport: true })
  const s = x.freelanceSummary(db, '2026-10-01', '2026-10-31')
  expect(s).toMatchObject({ recettesHt: 100000, tvaCollectee: 20000, depensesHt: 2000, tvaDeductible: 400, tvaDue: 19600 })
  expect(s.notes).toHaveLength(1)
  expect(x.accountingCsv(db, '2026-10-01', '2026-10-31').split('\r\n')[1]).toBe('2026-10-05;Facture client;Pro;;Recette;1000,00;20;200,00;1200,00;')
  expect(repo.listTransactions(db, { pro: true })).toHaveLength(2)
})

it('fiscal : catégories marquées, sous-catégories comprises', () => {
  const a = repo.createAccount(db, { name: 'A', type: 'courant' })
  const garde = listCategories(db).find((c) => c.fiscal === 'garde')!, dons = listCategories(db).find((c) => c.fiscal === 'don')!
  repo.addTransaction(db, { accountId: a.id, date: '2026-03-01', amount: -45000, label: 'Crèche', categoryId: garde.id })
  repo.addTransaction(db, { accountId: a.id, date: '2026-12-20', amount: -10000, label: 'Restos du cœur', categoryId: dons.id })
  repo.addTransaction(db, { accountId: a.id, date: '2025-12-20', amount: -10000, label: 'Don 2025', categoryId: dons.id })
  expect(x.fiscalTotals(db, 2026)).toEqual({ don: 10000, garde: 45000, domicile: 0 })
})

it('exports CSV et JSON complets', () => {
  const a = repo.createAccount(db, { name: 'A', type: 'courant' })
  repo.addTransaction(db, { accountId: a.id, date: '2026-10-01', amount: -500, label: 'Pain' })
  expect(x.transactionsCsv(db).split('\r\n')).toHaveLength(2)
  const j = JSON.parse(x.exportAllJson(db))
  expect(j.tables.transaction).toHaveLength(1)
  expect(Object.keys(j.tables)).toEqual(expect.arrayContaining(['account', 'category', 'budgetLine', 'goal', 'attachment']))
})
