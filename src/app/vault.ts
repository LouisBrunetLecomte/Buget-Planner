import type { Sealed } from '@/core/crypto'

// Le fichier de base chiffré vit dans IndexedDB ; rien n'est jamais stocké en clair.
const DB = 'budget-vault', STORE = 'vault', KEY = 'main'

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); res(req.result) }
    tx.onerror = tx.onabort = () => { db.close(); rej(tx.error) }
  })
}

export const loadVault = () => run<Sealed | undefined>('readonly', (s) => s.get(KEY))
export const saveVault = (v: Sealed) => run('readwrite', (s) => s.put(v, KEY))
export const wipeVault = () => run('readwrite', (s) => s.delete(KEY))
