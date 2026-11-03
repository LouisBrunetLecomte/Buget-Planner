import { daysBetween } from './dates'

export interface TxLite { id: string; accountId: string; date: string; amountEur: number; transferGroupId: string | null }

/**
 * Virements internes probables : montants EUR opposés (±1 % si change), comptes différents, ≤ 3 jours d'écart.
 * Chaque opération ne sert qu'une fois ; on prend la plus proche en date.
 */
export function findTransferPairs(txs: TxLite[], maxDays = 3): [TxLite, TxLite][] {
  const free = txs.filter((t) => !t.transferGroupId && t.amountEur !== 0)
  const outs = free.filter((t) => t.amountEur < 0).sort((a, b) => a.date.localeCompare(b.date))
  const ins = free.filter((t) => t.amountEur > 0)
  const used = new Set<string>()
  const pairs: [TxLite, TxLite][] = []
  for (const o of outs) {
    let best: TxLite | undefined, bestGap = Infinity
    for (const i of ins) {
      if (used.has(i.id) || i.accountId === o.accountId) continue
      const tol = Math.max(1, Math.round(Math.abs(o.amountEur) * 0.01))
      if (Math.abs(i.amountEur + o.amountEur) > tol) continue
      const gap = Math.abs(daysBetween(o.date, i.date))
      if (gap <= maxDays && gap < bestGap) { best = i; bestGap = gap }
    }
    if (best) { used.add(best.id); pairs.push([o, best]) }
  }
  return pairs
}
