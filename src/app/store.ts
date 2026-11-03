import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { useSyncExternalStore } from 'react'
import { exportDb, openDb, type Db } from '@/db/client'
import { seedDefaults } from '@/db/defaults'
import { seedDemo } from '@/db/seed'
import { deriveKey, newSalt, open, seal, type Sealed } from '@/core/crypto'
import { loadVault, saveVault, wipeVault } from './vault'

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
  try { set((await loadVault()) ? { status: 'locked' } : { status: 'new' }) }
  catch (e) { set({ status: 'error', message: e instanceof Error ? e.message : String(e) }) }
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
  const v = await loadVault()
  if (!v) return set({ status: 'new' })
  const k = await deriveKey(password, v.salt)
  let bytes: Uint8Array
  try { bytes = await open(k, v) } catch { throw new Error('Mot de passe incorrect.') }
  const o = openDb(await getSQL(), bytes)
  sqlite = o.sqlite; key = k; salt = v.salt
  set({ status: 'open', db: o.db, version: 0, saving: false, saveError: null })
}

export function lock() {
  void flush().finally(() => { sqlite?.close(); sqlite = null; key = null; history = []; set({ status: 'locked' }) })
}

/** Supprime définitivement toutes les données (RGPD). */
export async function wipeAll() {
  clearTimeout(timer); sqlite?.close(); sqlite = null; key = null; history = []
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
      await saveVault(await seal(key, salt, bytes))
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
  return new Blob([JSON.stringify({ app: 'budget', v: v.v, salt: b64(v.salt), iv: b64(v.iv), data: b64(new Uint8Array(v.data)) })], { type: 'application/json' })
}

export async function restoreBackup(file: File, password: string) {
  const j = JSON.parse(await file.text()) as Record<string, string>
  if (j.app !== 'budget' || !j.salt || !j.iv || !j.data) throw new Error('Fichier de sauvegarde invalide.')
  const sealed: Sealed = { v: 1, salt: unb64(j.salt), iv: unb64(j.iv), data: unb64(j.data).buffer }
  const k = await deriveKey(password, sealed.salt)
  try { await open(k, sealed) } catch { throw new Error('Mot de passe incorrect pour cette sauvegarde.') }
  clearTimeout(timer); sqlite?.close(); sqlite = null
  await saveVault(sealed)
  await unlock(password)
}

const b64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

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
