// Chiffrement de la base : PBKDF2-SHA256 (600 000 itérations, recommandation OWASP) → AES-256-GCM.
const ITER = 600_000
const enc = new TextEncoder()

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export interface Sealed { v: 1; salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }

export async function seal(key: CryptoKey, salt: Uint8Array<ArrayBuffer>, plain: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) // IV neuf à chaque sauvegarde : obligatoire avec GCM
  return { v: 1, salt, iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain) }
}

/** Lève une erreur si le mot de passe est faux (tag GCM invalide). */
export async function open(key: CryptoKey, s: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv }, key, s.data))
}

export const newSalt = () => crypto.getRandomValues(new Uint8Array(16))
