/** Une ventilation est valide si chaque part est non nulle, catégorisée, et que la somme égale le montant. */
export function validateSplits(amount: number, parts: { categoryId: string | null; amount: number }[]): string | null {
  if (parts.length < 2) return 'Il faut au moins deux parts.'
  if (parts.some((p) => !p.categoryId)) return 'Chaque part doit avoir une catégorie.'
  if (parts.some((p) => p.amount === 0 || Math.sign(p.amount) !== Math.sign(amount))) return 'Chaque part doit être non nulle et du même signe que l’opération.'
  const sum = parts.reduce((s, p) => s + p.amount, 0)
  return sum === amount ? null : `La somme des parts (${sum / 100}) diffère du montant (${amount / 100}).`
}
