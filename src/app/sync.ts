import type { Sealed } from '@/core/crypto'

// Synchronisation du coffre avec le compte Quansi, seulement quand Budget tourne dans Quansi (site Odoo).
// Le serveur ne reçoit que le coffre déjà chiffré (même format qu'une sauvegarde) : il ne peut pas le lire.
// Règle simple : la dernière version enregistrée gagne (pas de fusion).

const b64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s) }
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Coffre → texte de sauvegarde (le fichier téléchargé et la copie synchronisée ont le même format). */
export const sealedToJson = (v: Sealed) =>
  JSON.stringify({ app: 'budget', v: v.v, salt: b64(v.salt), iv: b64(v.iv), data: b64(new Uint8Array(v.data)) })

export function jsonToSealed(text: string): Sealed {
  const j = JSON.parse(text) as Record<string, string>
  if (j.app !== 'budget' || !j.salt || !j.iv || !j.data) throw new Error('Fichier de sauvegarde invalide.')
  return { v: 1, salt: unb64(j.salt), iv: unb64(j.iv), data: unb64(j.data).buffer }
}

type OdooWindow = Window & { odoo?: { csrf_token?: string } }

/** Page Quansi qui contient Budget (même site), ou null : app Mac, navigateur seul, développement. */
function host(): { url: string; csrf: string } | null {
  try {
    const p = window.parent as OdooWindow
    const csrf = p.odoo?.csrf_token
    if (p === window || !csrf) return null
    return { url: `${p.location.origin}/website/action/quansi-sync`, csrf }
  } catch { return null } // autre site : pas d'accès, pas de synchro
}
export const syncEnabled = () => host() !== null

// version de la copie du compte que cet appareil a déjà (par compte, pour plusieurs comptes sur un même navigateur)
let uid = 0 // compte Quansi connecté, donné par le serveur (Odoo ne le laisse pas dans la page)
const knownKey = () => `quansi-sync-version:${uid}`
export const knownVersion = () => Number(localStorage.getItem(knownKey()) ?? 0)
export const setKnownVersion = (v: number) => localStorage.setItem(knownKey(), String(v))
// compte à qui appartient le coffre de cet appareil (pour ne pas montrer le coffre d'un autre compte)
const OWNER = 'quansi-sync-owner'
export const vaultOwner = () => Number(localStorage.getItem(OWNER) ?? 0)
export const setVaultOwner = () => { if (uid) localStorage.setItem(OWNER, String(uid)) }
export const currentUid = () => uid

async function call(op: 'get' | 'put' | 'delete', extra: Record<string, string> = {}): Promise<{ version: number; vault?: string; uid?: number }> {
  const h = host()
  if (!h) throw new Error('Synchro indisponible')
  const fd = new FormData()
  fd.append('csrf_token', h.csrf); fd.append('op', op); fd.append('app', 'budget')
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  const r = await fetch(h.url, { method: 'POST', body: fd, credentials: 'same-origin' })
  if (!r.ok) throw new Error(`Synchro : erreur ${r.status}`)
  const j = await r.json() as { version: number; vault?: string; uid?: number }
  if (j.uid) uid = j.uid
  return j
}

/** À appeler avant tout : apprend le compte connecté (sans télécharger le coffre). */
export async function ready() { if (!uid) await call('get', { meta: '1' }) }

/** Copie du compte plus récente que celle de cet appareil, ou null. */
export async function fetchNewer(): Promise<{ version: number; sealed: Sealed | null } | null> {
  await ready()
  const r = await call('get', { known: String(knownVersion()) })
  if (r.version === knownVersion()) return null
  return { version: r.version, sealed: r.vault ? jsonToSealed(r.vault) : null }
}
export async function upload(v: Sealed): Promise<number> {
  await ready()
  const r = await call('put', { vault: sealedToJson(v) })
  setKnownVersion(r.version); setVaultOwner()
  return r.version
}
export async function deleteRemote() { await ready(); await call('delete'); setKnownVersion(0) }
