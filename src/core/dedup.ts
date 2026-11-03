import { normalizeLabel } from './labels'
import type { RawTx } from './parsers'

/**
 * Clé de dédoublonnage : date|montant|libellé normalisé|n° d'occurrence.
 * Le n° d'occurrence distingue deux opérations identiques le même jour (deux cafés),
 * et reste stable quand on réimporte un fichier qui chevauche le précédent.
 * ponytail: si un export coupe une journée au milieu de deux opérations identiques, la 2e peut être ratée ; acceptable.
 */
export function withImportKeys<T extends RawTx>(rows: T[]): (T & { importKey: string; labelNorm: string })[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const labelNorm = normalizeLabel(r.label)
    const base = `${r.date}|${r.amount}|${labelNorm}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { ...r, labelNorm, importKey: `${base}|${n}` }
  })
}
