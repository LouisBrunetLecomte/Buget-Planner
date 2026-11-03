// Pont vers l'app Mac (Touch ID via la Secure Enclave). Absent dans un navigateur : tout reste au mot de passe.
interface Handler { postMessage(m: unknown): Promise<unknown> }
const handler = (globalThis as { webkit?: { messageHandlers?: { bugetAuth?: Handler } } }).webkit?.messageHandlers?.bugetAuth

export const hasTouchIdBridge = !!handler
const call = <T>(m: Record<string, unknown>) => handler!.postMessage(m) as Promise<T>

export async function touchIdStatus(): Promise<{ available: boolean; enrolled: boolean }> {
  return handler ? call({ action: 'status' }) : { available: false, enrolled: false }
}
/** Associe le mot de passe (déjà vérifié) à l'empreinte. */
export const touchIdEnroll = (password: string) => call<boolean>({ action: 'enroll', password })
/** Demande l'empreinte ; null si annulé ou « Utiliser le mot de passe ». */
export const touchIdUnlock = () => call<string | null>({ action: 'unlock' })
export const touchIdDisable = () => (handler ? call<boolean>({ action: 'disable' }) : Promise.resolve(true))

/** Après un déverrouillage réussi au mot de passe : (ré)active Touch ID si le Mac le permet. Silencieux en cas d'échec. */
export async function enrollIfPossible(password: string): Promise<boolean> {
  try { const s = await touchIdStatus(); if (!s.available) return false; await touchIdEnroll(password); return !s.enrolled }
  catch { return false }
}
