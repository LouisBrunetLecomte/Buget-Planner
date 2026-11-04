import { expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { openDb } from './client'
import { seedDemo } from './seed'
import { periodReport } from './coachRepo'

it('bilan d’une période de démo : profil, comparaison, conseils sourcés', async () => {
  const { db } = openDb(await initSqlJs())
  seedDemo(db, new Date('2026-11-03'))
  const r = periodReport(db, '2026-10', '2026-11-03')
  expect(r.profile.spent).toBeGreaterThan(100000)
  expect(r.profile.fixed).toBeGreaterThan(0) // loyer, abonnements… reconnus comme échéances
  expect(r.profile.byCategory[0]!.total).toBeGreaterThanOrEqual(r.profile.byCategory.at(-1)!.total)
  expect(r.previous).not.toBeNull()
  expect(r.advice.length).toBeGreaterThan(0)
  expect(r.advice.every((a) => a.title && a.body)).toBe(true)
  expect(r.savingRate).not.toBeNull()
})
