/** CSV lisible par Excel en français : séparateur « ; », décimales à la virgule, BOM UTF-8. */
export function toCsv(head: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // neutralise les formules (=, +, -, @) injectées par un libellé bancaire : protection classique « CSV injection »
  const safe = (v: string | number | null) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v)
  return '﻿' + [head, ...rows].map((r) => r.map((v) => cell(safe(v))).join(';')).join('\r\n')
}
export const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/** TVA contenue dans un montant TTC. */
export function vatOf(ttc: number, rate: number | null): { ht: number; tva: number } {
  if (!rate) return { ht: ttc, tva: 0 }
  const tva = Math.round((ttc * rate) / (100 + rate))
  return { ht: ttc - tva, tva }
}
