import { parseAmount } from './money'
import { parseDate } from './dates'
import type { RawTx } from './parsers'

export interface PdfItem { str: string; x: number; y: number; page: number }

const AMOUNT = /^[-+]?\d{1,3}(?:[ .  ]?\d{3})*,\d{2}$/
const DATE = /^(\d{2})[/.](\d{2})(?:[/.](\d{2,4}))?$/

/**
 * Relevé PDF (au mieux) : on reconstitue les lignes par position verticale, une ligne d'opération
 * commence par une date et contient un montant. Le sens vient de la colonne (Débit/Crédit) la plus proche.
 * ponytail: les mises en page varient beaucoup selon les banques ; l'aperçu d'import permet de vérifier avant d'importer.
 */
export function parseStatementItems(items: PdfItem[]): RawTx[] {
  const lines = new Map<string, PdfItem[]>()
  for (const it of items) {
    if (!it.str.trim()) continue
    const k = `${it.page}:${Math.round(it.y / 3)}`
    lines.set(k, [...(lines.get(k) ?? []), it])
  }
  const sorted = [...lines.values()].map((l) => l.sort((a, b) => a.x - b.x))
  const all = items.map((i) => i.str).join(' ')
  const year = Number([...all.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]).sort((a, b) => all.split(b!).length - all.split(a!).length)[0] ?? new Date().getFullYear())
  let debitX: number | null = null, creditX: number | null = null
  const out: RawTx[] = []
  for (const l of sorted) {
    const d = l.find((i) => /^d[ée]bit/i.test(i.str.trim())), c = l.find((i) => /^cr[ée]dit/i.test(i.str.trim()))
    if (d && c) { debitX = d.x; creditX = c.x; continue }
    const m = l[0]!.str.trim().match(DATE)
    if (!m) continue
    const amounts = l.filter((i) => AMOUNT.test(i.str.trim()))
    const amt = amounts.at(-1)
    if (!amt) continue
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year
    const date = parseDate(`${m[1]}/${m[2]}/${y}`, 'DD/MM/YYYY')
    let cents = parseAmount(amt.str)
    if (!date || cents === null) continue
    const explicit = /^[-+]/.test(amt.str.trim())
    if (!explicit) cents = debitX !== null && creditX !== null && Math.abs(amt.x - creditX) < Math.abs(amt.x - debitX) ? Math.abs(cents) : -Math.abs(cents)
    // libellé : ce qui est entre la (ou les) date(s) et les montants
    const label = l.filter((i) => i !== l[0] && !AMOUNT.test(i.str.trim()) && !DATE.test(i.str.trim())).map((i) => i.str.trim()).join(' ')
    out.push({ date, amount: cents, label: label || '(sans libellé)' })
  }
  return out
}
