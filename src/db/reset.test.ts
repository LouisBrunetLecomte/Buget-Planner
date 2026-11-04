import { expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { openDb } from './client'
import { seedDefaults } from './defaults'
import * as repo from './repo'

// même recette que resetData (app/store.ts) : base neuve + catégories par défaut, l'ancienne reste restaurable
it('remise à zéro : base vide avec les catégories par défaut, ancienne base restaurable', async () => {
  const SQL = await initSqlJs()
  const old = openDb(SQL).db
  seedDefaults(old)
  repo.createAccount(old, { name: 'LCL', type: 'courant', openingBalance: 1000 })
  repo.putSetting(old, 'tutorialDone', true)
  const fresh = openDb(SQL).db
  seedDefaults(fresh)
  expect(repo.listAccounts(fresh)).toHaveLength(0)
  expect(repo.getSetting(fresh, 'tutorialDone')).toBeFalsy()
  expect(repo.listCategories(fresh).length).toBe(repo.listCategories(old).length)
})
