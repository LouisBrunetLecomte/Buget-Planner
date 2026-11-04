// Séries et défis : de petits objectifs par période, calculés à partir des chiffres existants (rien n'est stocké).

/** Séries de périodes terminées dans le budget (dépenses ≤ prévu), de la plus ancienne à la plus récente. */
export function budgetStreak(periods: { planned: number; actual: number }[]): { current: number; best: number } {
  let current = 0, best = 0
  for (const p of periods) {
    if (p.planned <= 0) continue // période sans budget : ni gagnée ni perdue
    current = p.actual <= p.planned ? current + 1 : 0
    best = Math.max(best, current)
  }
  return { current, best }
}

/** Jours écoulés sans aucune dépense du quotidien. */
export const noSpendDays = (daily: { date: string; total: number }[], today: string) =>
  daily.filter((d) => d.date <= today && d.total === 0).length

export interface Challenge { id: string; title: string; detail: string; progress: number; done: boolean }

export interface ChallengeInput {
  noSpend: number; elapsed: number; days: number; finished: boolean
  planned: number; actual: number                 // dépenses de la période (centimes, positifs)
  savingRate: number | null
  variable: number; previousVariable: number | null // dépenses du quotidien, à date égale pour la période précédente
}

const NO_SPEND_GOAL = 8
const clamp = (x: number) => Math.min(1, Math.max(0, x))

export function challenges(i: ChallengeInput): Challenge[] {
  const out: Challenge[] = [{
    id: 'sans-depense', title: `${NO_SPEND_GOAL} jours sans dépense`, progress: clamp(i.noSpend / NO_SPEND_GOAL), done: i.noSpend >= NO_SPEND_GOAL,
    detail: `${i.noSpend} jour${i.noSpend > 1 ? 's' : ''} sans aucune dépense du quotidien`,
  }]
  if (i.planned > 0) {
    // en cours de période : on compare au prévu au prorata des jours écoulés
    const pace = i.finished ? i.planned : (i.planned * i.elapsed) / Math.max(1, i.days)
    const ok = i.actual <= pace
    out.push({ id: 'budget', title: 'Finir la période dans le budget', progress: clamp(1 - i.actual / i.planned), done: i.finished && ok,
      detail: i.finished ? (ok ? 'Réussi : budget tenu' : 'Budget dépassé') : ok ? 'En avance sur le rythme prévu' : 'Au-dessus du rythme prévu' })
  }
  if (i.savingRate !== null) out.push({ id: 'epargne', title: 'Garder 20 % de tes revenus', progress: clamp(i.savingRate / 0.2), done: i.savingRate >= 0.2,
    detail: `${Math.round(Math.max(0, i.savingRate) * 100)} % gardés pour l’instant` })
  if (i.previousVariable !== null && i.previousVariable > 0) out.push({
    id: 'moins', title: 'Dépenser moins au quotidien que la période précédente', done: i.variable < i.previousVariable,
    progress: i.variable ? clamp(i.previousVariable / i.variable) : 1,
    detail: i.variable < i.previousVariable ? `${Math.round((1 - i.variable / i.previousVariable) * 100)} % de moins à date égale` : `${Math.round((i.variable / i.previousVariable - 1) * 100)} % de plus à date égale`,
  })
  return out
}
