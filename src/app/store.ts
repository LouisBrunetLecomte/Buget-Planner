import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { useSyncExternalStore } from 'react'
import { exportDb, openDb, type Db } from '@/db/client'
import { seedDefaults } from '@/db/defaults'
import { seedDemo } from '@/db/seed'
import { deriveKey, newSalt, open, seal, type Sealed } from '@/core/crypto'
import { loadVault, saveVault, wipeVault } from './vault'
import * as sync from './sync'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string } // stockage du navigateur illisible
  | { status: 'new' }            // aucun coffre : création
  | { status: 'locked' }
  | { status: 'open'; db: Db; version: number; saving: boolean; saveError: string | null }

let state: State = { status: 'loading' }
let sqlite: Database | null = null
let key: CryptoKey | null = null
let salt: Uint8Array<ArrayBuffer> | null = null
let SQL: SqlJsStatic | null = null
const listeners = new Set<() => void>()

function set(s: State) { state = s; listeners.forEach((l) => l()) }
const getSQL = async () => (SQL ??= await initSqlJs({ locateFile: () => wasmUrl }))

export async function boot() {
  try {
    if (sync.syncEnabled()) await pullBeforeOpen().catch(() => {}) // hors ligne : on garde la copie de l'appareil
    set((await loadVault()) ? { status: 'locked' } : { status: 'new' })
  }
  catch (e) { set({ status: 'error', message: e instanceof Error ? e.message : String(e) }) }
}

// ---------- synchronisation avec le compte Quansi (voir sync.ts) ----------
let pendingPush = false
// cet appareil a une base jamais synchronisée ET le compte en a déjà une : on demande laquelle garder, sans rien écraser
let conflict: { version: number; sealed: Sealed } | null = null
export const syncConflict = () => conflict
let pushChain = Promise.resolve()
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/** Avant le déverrouillage : récupère la copie du compte si elle est plus récente que celle de l'appareil. */
async function pullBeforeOpen() {
  await sync.ready()
  const owner = sync.vaultOwner()
  // coffre d'un autre compte Quansi sur ce navigateur : il est déjà sur son compte, on ne le montre pas
  if (owner && owner !== sync.currentUid()) { await wipeVault(); sync.setKnownVersion(0) }
  const r = await sync.fetchNewer()
  if (!r) return
  if (r.sealed && sync.knownVersion() === 0 && await loadVault()) { conflict = { version: r.version, sealed: r.sealed }; return }
  if (r.sealed) { await saveVault(r.sealed); sync.setVaultOwner() }
  else if (sync.knownVersion() > 0) await wipeVault() // effacé depuis un autre appareil (« Tout effacer »)
  sync.setKnownVersion(r.version)
}

/** Choix de l'utilisateur en cas de conflit : garder la base du compte, ou celle de cet appareil (qui part alors sur le compte). */
export async function resolveConflict(keep: 'compte' | 'appareil') {
  const c = conflict
  if (!c) return
  if (keep === 'compte') { await saveVault(c.sealed); sync.setKnownVersion(c.version); sync.setVaultOwner() }
  else { sync.setKnownVersion(c.version); const v = await loadVault(); if (v) await push(v) }
  conflict = null
  set({ status: 'locked' })
}
/** Base de cet appareil, telle quelle (chiffrée), au format sauvegarde : pour la garder avant de choisir. */
export async function localBackupText() { const v = await loadVault(); return v ? sync.sealedToJson(v) : null }

/** Envoie le coffre chiffré sur le compte (en série ; en cas d'échec, on réessaie au prochain passage). */
function push(v: Sealed) {
  pushChain = pushChain.then(() => sync.upload(v)).then(() => { pendingPush = false }, () => { pendingPush = true })
  return pushChain
}

/** App ouverte : reprend les modifications faites sur un autre appareil. */
async function pullWhileOpen() {
  if (!sync.syncEnabled() || dirty || conflict || (state.status !== 'open' && state.status !== 'locked' && state.status !== 'new')) return
  if (pendingPush) { const v = await loadVault(); if (v) await push(v); return }
  const r = await sync.fetchNewer().catch(() => null)
  if (!r || dirty || pendingPush) return
  if (!r.sealed) {
    if (sync.knownVersion() > 0) { // effacé depuis un autre appareil
      clearTimeout(timer); sqlite?.close(); sqlite = null; key = null; history = []
      await wipeVault(); sync.setKnownVersion(0); set({ status: 'new' })
    }
    return
  }
  await saveVault(r.sealed); sync.setKnownVersion(r.version); sync.setVaultOwner()
  if (state.status === 'open' && key && salt && sameBytes(salt, r.sealed.salt)) {
    const o = openDb(await getSQL(), await open(key, r.sealed))
    sqlite?.close(); sqlite = o.sqlite; history = []
    set({ ...state, db: o.db, version: state.version + 1 })
  } else if (state.status === 'open') { // mot de passe changé sur l'autre appareil : il faut le nouveau
    sqlite?.close(); sqlite = null; key = null; history = []; set({ status: 'locked' })
  } else if (state.status === 'new') set({ status: 'locked' })
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void pullWhileOpen() })
  setInterval(() => { if (document.visibilityState === 'visible') void pullWhileOpen() }, 30_000)
}

export const MIN_PASSWORD = 8

export async function createVault(password: string, demo: boolean) {
  if (password.length < MIN_PASSWORD) throw new Error(`${MIN_PASSWORD} caractères minimum.`)
  salt = newSalt()
  key = await deriveKey(password, salt)
  const o = openDb(await getSQL())
  if (demo) seedDemo(o.db); else seedDefaults(o.db)
  sqlite = o.sqlite
  set({ status: 'open', db: o.db, version: 0, saving: false, saveError: null })
  await flush(true)
}

export async function unlock(password: string) {
  if (conflict) throw new Error('Choisis d’abord quelle base garder.')
  const v = await loadVault()
  if (!v) return set({ status: 'new' })
  const k = await deriveKey(password, v.salt)
  let bytes: Uint8Array
  try { bytes = await open(k, v) } catch { throw new Error('Mot de passe incorrect.') }
  const o = openDb(await getSQL(), bytes)
  sqlite = o.sqlite; key = k; salt = v.salt
  set({ status: 'open', db: o.db, version: 0, saving: false, saveError: null })
  if (sync.syncEnabled() && sync.knownVersion() === 0) void flush(true) // jamais envoyé sur le compte : première copie
}

export function lock() {
  void flush().finally(() => { sqlite?.close(); sqlite = null; key = null; history = []; set({ status: 'locked' }) })
}

/** Supprime définitivement toutes les données (RGPD). */
export async function wipeAll() {
  clearTimeout(timer); sqlite?.close(); sqlite = null; key = null; history = []
  if (sync.syncEnabled()) await sync.deleteRemote().catch(() => {}) // efface aussi la copie du compte
  await wipeVault()
  set({ status: 'new' })
}

// ---------- écriture + sauvegarde chiffrée ----------
let timer: ReturnType<typeof setTimeout> | undefined
let dirty = false
let chain = Promise.resolve()

// ---------- historique (annulation) ----------
// Instantanés de la base avant chaque modification, en mémoire, pour la session en cours.
export interface HistoryEntry { label: string; at: number; bytes: Uint8Array<ArrayBuffer> }
let history: HistoryEntry[] = []
const HISTORY_MAX_BYTES = 60 * 1024 * 1024 // ponytail: plafond mémoire ; au-delà, les plus anciens sont oubliés
export const getHistory = () => history

/**
 * Exécute une écriture, rafraîchit l'UI et planifie la sauvegarde. Les erreurs remontent à l'appelant
 * (et l'instantané est alors abandonné). `label` apparaît dans l'historique ; `undoable: false` pour les écritures techniques.
 */
export function mutate<T>(fn: (db: Db) => T, opts: { label?: string; undoable?: boolean } = {}): T {
  if (state.status !== 'open' || !sqlite) throw new Error('Base verrouillée')
  const snap = opts.undoable === false ? null : exportDb(sqlite)
  const out = state.db.transaction((tx) => fn(tx as unknown as Db)) // tout ou rien : une erreur annule l'écriture entière
  if (snap) {
    history = [...history, { label: opts.label ?? 'Modification', at: Date.now(), bytes: snap }]
    let total = history.reduce((n, h) => n + h.bytes.byteLength, 0)
    while ((history.length > 50 || total > HISTORY_MAX_BYTES) && history.length > 1) total -= history.shift()!.bytes.byteLength
  }
  touch()
  return out
}

function touch() {
  if (state.status !== 'open') return
  dirty = true
  set({ ...state, version: state.version + 1 })
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), 800)
}

/** Revient à l'état d'avant l'entrée `index` (et annule donc toutes celles qui suivent). */
export async function undoTo(index: number) {
  const h = history[index]
  if (!h || state.status !== 'open') return
  const o = openDb(await getSQL(), h.bytes)
  sqlite?.close()
  sqlite = o.sqlite
  history = history.slice(0, index)
  set({ ...state, db: o.db })
  touch()
}
export const undo = () => undoTo(history.length - 1)

/** Remise à zéro en gardant le mot de passe : base neuve (catégories par défaut), tutoriel relancé. Annulable (⌘Z) tant que l'app reste ouverte. */
export async function resetData() {
  if (state.status !== 'open' || !sqlite) return
  const snap = exportDb(sqlite), o = openDb(await getSQL())
  seedDefaults(o.db)
  sqlite.close(); sqlite = o.sqlite
  history = [...history, { label: 'Remise à zéro', at: Date.now(), bytes: snap }]
  set({ ...state, db: o.db })
  touch()
}

/** Vérifie un mot de passe contre le coffre, sans rien ouvrir. */
export async function verifyPassword(password: string): Promise<boolean> {
  const v = await loadVault()
  if (!v) return false
  try { await open(await deriveKey(password, v.salt), v); return true } catch { return false }
}

/** Nouveau mot de passe : nouveau sel, nouvelle clé, sauvegarde immédiate. */
export async function changePassword(current: string, next: string) {
  if (next.length < MIN_PASSWORD) throw new Error(`${MIN_PASSWORD} caractères minimum.`)
  const v = await loadVault()
  if (!v) throw new Error('Aucune base')
  try { await open(await deriveKey(current, v.salt), v) } catch { throw new Error('Mot de passe actuel incorrect.') }
  await flush()
  salt = newSalt()
  key = await deriveKey(next, salt)
  await flush(true)
}

export function flush(force = false): Promise<void> {
  clearTimeout(timer)
  // sauvegardes en série : jamais deux écritures IndexedDB concurrentes
  chain = chain.then(async () => {
    if (!sqlite || !key || !salt || (!dirty && !force)) return
    dirty = false
    const bytes = exportDb(sqlite)
    try {
      const sealed = await seal(key, salt, bytes)
      await saveVault(sealed)
      if (sync.syncEnabled()) void push(sealed)
      if (state.status === 'open' && state.saveError) set({ ...state, saveError: null })
    } catch (e) {
      dirty = true
      if (state.status === 'open') set({ ...state, saveError: e instanceof Error ? e.message : String(e) })
    }
  })
  return chain
}

/** Fichier de sauvegarde : le coffre chiffré tel quel (restaurable avec le même mot de passe). */
export async function exportBackup(): Promise<Blob> {
  await flush()
  const v = await loadVault()
  if (!v) throw new Error('Rien à sauvegarder')
  return new Blob([sync.sealedToJson(v)], { type: 'application/json' })
}

export async function restoreBackup(file: File, password: string) {
  const sealed = sync.jsonToSealed(await file.text())
  const k = await deriveKey(password, sealed.salt)
  try { await open(k, sealed) } catch { throw new Error('Mot de passe incorrect pour cette sauvegarde.') }
  clearTimeout(timer); sqlite?.close(); sqlite = null
  await saveVault(sealed)
  await unlock(password)
  if (sync.syncEnabled()) await flush(true) // la sauvegarde restaurée devient la copie du compte
}


// sauvegarde immédiate quand l'onglet passe en arrière-plan (fermeture, changement d'appli sur mobile)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush() })
  addEventListener('beforeunload', (e) => { if (dirty) { void flush(); e.preventDefault() } })
}

// ---------- hooks React ----------
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }
export const useStore = () => useSyncExternalStore(subscribe, () => state)

/** Base ouverte + numéro de version (à mettre dans les deps de useMemo pour relire après écriture). */
export function useDb(): { db: Db; version: number } {
  const s = useStore()
  if (s.status !== 'open') throw new Error('Base verrouillée')
  return { db: s.db, version: s.version }
}
