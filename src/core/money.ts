// Montants stockés en centimes entiers, jamais en flottants.

/** "1 234,56" | "-12.50" | "1.234,56 €" | "(12,00)" → centimes. null si illisible. */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/[\s  €$£]/g, '').replace(/[A-Z]{3}$/i, '')
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1) }
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  const decSep = lastComma > lastDot ? ',' : '.'
  const thouSep = decSep === ',' ? '.' : ','
  // "1,234" seul (anglais, 3 décimales) vs "12,34" (français) : 3 chiffres après la virgule unique = milliers
  if (decSep === ',' && lastDot === -1 && /^[1-9]\d{0,2}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '')
  else s = s.split(thouSep).join('').replace(decSep, '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const [int, frac = ''] = s.split('.')
  const cents = Number(int) * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0)
  return neg ? -cents : cents
}

/** Calculatrice de saisie : « 75/2 », « 12,50+3 », « 3x4,20 ». Sans opération, même lecture que parseAmount. */
export function evalAmount(input: string): number | null {
  const s = input.replace(/[\s  €]/g, '').replace(/[x×]/gi, '*').replace(/÷/g, '/')
  if (!/\d[+\-*/][+\-]?\d/.test(s)) return parseAmount(input) // « 12- » ou « (12) » restent des formats de relevé
  const t = s.match(/\d[\d.,]*|[+\-*/]/g)
  if (!t || t.join('') !== s) return null
  let i = 0
  const num = (): number | null => {
    let sign = 1
    while (t[i] === '+' || t[i] === '-') if (t[i++] === '-') sign = -sign
    const c = t[i] && /\d/.test(t[i]!) ? parseAmount(t[i++]!) : null
    return c === null ? null : (sign * c) / 100
  }
  const term = (): number | null => {
    let v = num()
    while (v !== null && (t[i] === '*' || t[i] === '/')) {
      const op = t[i++], r = num()
      if (r === null || (op === '/' && r === 0)) return null
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  let v = term()
  while (v !== null && i < t.length) { const op = t[i++], r = term(); v = r === null ? null : op === '+' ? v + r : v - r }
  return v === null || !Number.isFinite(v) ? null : Math.round(v * 100)
}

/** Mode confidentialité : les montants affichés sont masqués (les exports, eux, utilisent formatRaw). */
export const privacy = { hidden: false }

const fmtCache = new Map<string, Intl.NumberFormat>()
export function formatMoney(cents: number, currency = 'EUR'): string {
  if (privacy.hidden) return currency === 'EUR' ? '•••• €' : `•••• ${currency}`
  return formatRaw(cents, currency)
}
export function formatRaw(cents: number, currency = 'EUR'): string {
  let f = fmtCache.get(currency)
  if (!f) { f = new Intl.NumberFormat('fr-FR', { style: 'currency', currency }); fmtCache.set(currency, f) }
  return f.format(cents / 100)
}

/** Conversion avec arrondi bancaire simple au centime. */
export const convert = (cents: number, rate: number) => Math.round(cents * rate)
