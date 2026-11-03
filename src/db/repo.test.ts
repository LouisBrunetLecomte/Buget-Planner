import { beforeEach, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { exportDb, openDb, type Db } from './client'
import { seedDefaults } from './defaults'
import { seedDemo } from './seed'
import * as repo from './repo'

let SQL: SqlJsStatic
let db: Db
let cats: Map<string, string>
beforeEach(async () => {
  SQL ??= await initSqlJs()
  db = openDb(SQL).db
  cats = seedDefaults(db)
})

const csvRows = [
  { date: '2026-10-01', amount: -450, label: 'CB CARREFOUR MARKET 01/10' },
  { date: '2026-10-01', amount: -450, label: 'CB CARREFOUR MARKET 01/10' },
  { date: '2026-10-02', amount: -1349, label: 'NETFLIX.COM' },
  { date: '2026-10-03', amount: -1000, label: 'BOULANGERIE MARIE' },
]

describe('import', () => {
  it('dédoublonne un réimport chevauchant et catégorise par règles', () => {
    const acc = repo.createAccount(db, { name: 'Courant', type: 'courant' })
    expect(repo.importRows(db, acc.id, 'a.csv', csvRows.slice(0, 3))).toMatchObject({ imported: 3, skipped: 0 })
    const second = repo.importRows(db, acc.id, 'b.csv', csvRows)
    expect(second).toMatchObject({ imported: 1, skipped: 3 })
    const txs = repo.listTransactions(db)
    expect(txs).toHaveLength(4)
    expect(txs.find((t) => t.label.startsWith('NETFLIX'))!.categoryId).toBe(cats.get('Abonnements'))
    expect(repo.balances(db).get(acc.id)).toBe(-450 - 450 - 1349 - 1000)
    repo.undoImport(db, second.batchId)
    expect(repo.listTransactions(db)).toHaveLength(3)
  })

  it('refuse une devise différente du compte, convertit les comptes en devise', () => {
    const usd = repo.createAccount(db, { name: 'USD', type: 'courant', currency: 'USD' })
    expect(() => repo.importRows(db, usd.id, 'x', [{ ...csvRows[0]!, currency: 'GBP' }])).toThrow(/GBP/)
    expect(() => repo.addTransaction(db, { accountId: usd.id, date: '2026-10-04', amount: -1000, label: 'x' })).toThrow(/taux/)
    repo.saveRates(db, 'USD', { '2026-10-02': 0.9 })
    const t = repo.addTransaction(db, { accountId: usd.id, date: '2026-10-04', amount: -1000, label: 'Diner' }) // week-end → taux du 2
    expect(t).toMatchObject({ amountEur: -900, fxRate: 0.9, currency: 'USD' })
  })
})

it('apprend une règle d’une correction', () => {
  const acc = repo.createAccount(db, { name: 'Courant', type: 'courant' })
  const t = repo.addTransaction(db, { accountId: acc.id, date: '2026-10-01', amount: -1000, label: 'CB BOULANGERIE MARIE 01/10' })
  expect(t.categoryId).toBeNull()
  expect(repo.updateTransaction(db, t.id, { categoryId: cats.get('Courses')! }).learned).toBe('BOULANGERIE MARIE')
  const t2 = repo.addTransaction(db, { accountId: acc.id, date: '2026-10-08', amount: -800, label: 'CB BOULANGERIE MARIE 08/10' })
  expect(t2.categoryId).toBe(cats.get('Courses'))
  // corriger une enseigne connue (CARREFOUR → Shopping) l'emporte sur la règle par défaut
  const c = repo.addTransaction(db, { accountId: acc.id, date: '2026-10-08', amount: -800, label: 'CARREFOUR' })
  repo.updateTransaction(db, c.id, { categoryId: cats.get('Shopping')! })
  expect(repo.addTransaction(db, { accountId: acc.id, date: '2026-10-09', amount: -1, label: 'CARREFOUR' }).categoryId).toBe(cats.get('Shopping'))
})

it('virements internes : suggestion, lien, exclusion des non catégorisées', () => {
  const a = repo.createAccount(db, { name: 'A', type: 'courant' }), b = repo.createAccount(db, { name: 'B', type: 'epargne' })
  const o = repo.addTransaction(db, { accountId: a.id, date: '2026-10-01', amount: -5000, label: 'VIR LIVRET' })
  repo.addTransaction(db, { accountId: b.id, date: '2026-10-02', amount: 5000, label: 'VIR RECU' })
  const s = repo.transferSuggestions(db)
  expect(s).toHaveLength(1)
  const g = repo.linkTransfer(db, [s[0]![0].id, s[0]![1].id])
  expect(repo.transferSuggestions(db)).toHaveLength(0)
  expect(repo.listTransactions(db, { categoryId: 'none' })).toHaveLength(0)
  repo.unlinkTransfer(db, g)
  expect(repo.listTransactions(db, { categoryId: 'none' }).map((t) => t.id)).toContain(o.id)
})

it('ventilation et tags', () => {
  const acc = repo.createAccount(db, { name: 'A', type: 'courant' })
  const t = repo.addTransaction(db, { accountId: acc.id, date: '2026-10-01', amount: -10000, label: 'AMAZON' })
  expect(() => repo.setSplits(db, t.id, [{ categoryId: cats.get('Maison')!, amount: -5000 }, { categoryId: cats.get('Courses')!, amount: -4000 }])).toThrow()
  repo.setSplits(db, t.id, [{ categoryId: cats.get('Maison')!, amount: -6000 }, { categoryId: cats.get('Courses')!, amount: -4000 }])
  expect(repo.listTransactions(db, { categoryId: cats.get('Alimentation')! }).map((x) => x.id)).toEqual([t.id]) // via sous-catégorie
  repo.setTags(db, t.id, ['Vacances', 'vacances ', 'pro'])
  expect(repo.getTags(db, t.id).sort()).toEqual(['pro', 'vacances'])
})

it('recherche, filtre et actions en masse', () => {
  const acc = repo.createAccount(db, { name: 'A', type: 'courant' })
  repo.importRows(db, acc.id, 'a', csvRows)
  expect(repo.listTransactions(db, { q: 'netflix' })).toHaveLength(1)
  expect(repo.listTransactions(db, { q: '13.49' })).toHaveLength(1)
  const ids = repo.listTransactions(db, { q: 'carrefour' }).map((t) => t.id)
  repo.setCategoryBulk(db, ids, cats.get('Divers')!)
  expect(repo.listTransactions(db, { categoryId: cats.get('Divers')! })).toHaveLength(2)
  repo.deleteTransactions(db, ids)
  expect(repo.listTransactions(db)).toHaveLength(2)
})

it('la démo se charge et survit à un export/réouverture', () => {
  const fresh = openDb(SQL)
  seedDemo(fresh.db, new Date('2026-11-03'))
  const n = repo.listTransactions(fresh.db, { limit: 10_000 }).length
  expect(n).toBeGreaterThan(150)
  expect(repo.transferSuggestions(fresh.db).length).toBeGreaterThan(0)
  const reopened = openDb(SQL, exportDb(fresh.sqlite))
  expect(repo.listTransactions(reopened.db, { limit: 10_000 })).toHaveLength(n)
  // les clés étrangères restent actives après export
  expect(() => repo.addTransaction(reopened.db, { accountId: 'nope', date: '2026-01-01', amount: 1, label: 'x' })).toThrow()
})
