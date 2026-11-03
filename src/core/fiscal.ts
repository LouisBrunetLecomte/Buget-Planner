// Estimations indicatives (barème 2026 tel que connu : à vérifier sur impots.gouv.fr).
export type FiscalKind = 'don' | 'garde' | 'domicile'
export const FISCAL_LABEL: Record<FiscalKind, string> = { don: 'Dons aux associations', garde: 'Frais de garde d’enfants (< 6 ans)', domicile: 'Emploi d’un salarié à domicile' }

export function fiscalEstimate(totals: Record<FiscalKind, number>, children = 1) {
  const don = { spent: totals.don, benefit: Math.round(totals.don * 0.66), note: 'Réduction de 66 % (75 % pour l’aide aux personnes en difficulté), dans la limite de 20 % du revenu imposable.' }
  const gardeBase = Math.min(totals.garde, 350_000 * Math.max(1, children))
  const garde = { spent: totals.garde, benefit: Math.round(gardeBase * 0.5), note: 'Crédit d’impôt de 50 %, dépenses retenues jusqu’à 3 500 € par enfant, aides (CMG) déduites.' }
  const plafond = Math.min(1_500_000, 1_200_000 + 150_000 * children)
  const domicile = { spent: totals.domicile, benefit: Math.round(Math.min(totals.domicile, plafond) * 0.5), note: 'Crédit d’impôt de 50 %, plafond de 12 000 € + 1 500 € par enfant (15 000 € max).' }
  return { don, garde, domicile, total: don.benefit + garde.benefit + domicile.benefit }
}
