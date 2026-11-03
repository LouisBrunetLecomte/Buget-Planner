import { parseAmount } from './money'
import { parseDate } from './dates'

/** Lecture d'un ticket après OCR : total, date, enseigne. Heuristiques ; l'utilisateur valide. */
export function parseReceipt(text: string): { total: number | null; date: string | null; merchant: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const amountsIn = (l: string) => [...l.matchAll(/(\d{1,4}(?:[ .]\d{3})*[,.]\d{2})\s*(?:€|EUR)?/gi)].map((m) => parseAmount(m[1]!)).filter((x): x is number => x !== null && x > 0)
  let total: number | null = null
  for (const l of lines) {
    if (/\b(TOTAL|NET A PAYER|À PAYER|A PAYER|MONTANT)\b/i.test(l) && !/SOUS[- ]?TOTAL|TVA|HT\b/i.test(l)) {
      const a = amountsIn(l)
      if (a.length) { total = a.at(-1)!; break }
    }
  }
  if (total === null) { const all = lines.flatMap(amountsIn); total = all.length ? Math.max(...all) : null }
  let date: string | null = null
  for (const l of lines) {
    const m = l.match(/\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/)
    if (m) { date = parseDate(m[1]!, 'DD/MM/YYYY'); if (date) break }
  }
  const merchant = lines.find((l) => /[A-Za-zÀ-ÿ]{3,}/.test(l) && !/ticket|caisse|bienvenue|siret|tel|tél/i.test(l)) ?? null
  return { total, date, merchant }
}
