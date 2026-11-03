import { addMonths } from './dates'

export interface Loan { principal: number; rate: number; payment: number; startMonth: string; extraMonthly?: number; lumpSums?: { month: string; amount: number }[] }
export interface AmortRow { month: string; payment: number; interest: number; principal: number; balance: number }

/** Mensualité d'un prêt à taux fixe (annuité constante). rate = taux annuel en %. */
export function paymentFor(principal: number, rate: number, months: number): number {
  const r = rate / 100 / 12
  return Math.ceil(r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months))
}

/** Tableau d'amortissement mois par mois, remboursements anticipés compris. Lève une erreur si la mensualité ne couvre pas les intérêts. */
export function amortize(l: Loan): AmortRow[] {
  const r = l.rate / 100 / 12
  const rows: AmortRow[] = []
  let bal = l.principal
  for (let k = 0; bal > 0 && k < 1200; k++) {
    const month = addMonths(l.startMonth, k)
    const interest = Math.round(bal * r)
    const lump = (l.lumpSums ?? []).filter((x) => x.month === month).reduce((s, x) => s + x.amount, 0)
    const pay = Math.min(bal + interest, l.payment + (l.extraMonthly ?? 0) + lump)
    if (pay <= interest && lump === 0) throw new Error('La mensualité ne couvre pas les intérêts : le prêt ne serait jamais remboursé.')
    bal = bal + interest - pay
    rows.push({ month, payment: pay, interest, principal: pay - interest, balance: bal })
  }
  return rows
}

/** Capital restant dû à la fin d'un mois (0 avant le début du prêt : il n'existait pas). */
export function balanceAt(l: Loan, month: string): number {
  if (month < l.startMonth) return 0
  const rows = amortize(l)
  return rows.find((r) => r.month === month)?.balance ?? (month > rows.at(-1)!.month ? 0 : l.principal)
}

export interface DebtLite { id: string; name: string; balance: number; rate: number; payment: number }
export interface Strategy { months: number; totalInterest: number; payoff: { id: string; name: string; month: number }[] }

/**
 * Boule de neige (plus petit solde d'abord) ou avalanche (taux le plus élevé d'abord).
 * Chaque mois : mensualités minimales partout, puis l'extra + les mensualités libérées vont sur la dette cible.
 */
export function payoffPlan(debts: DebtLite[], extra: number, method: 'boule' | 'avalanche'): Strategy {
  const ds = debts.map((d) => ({ ...d, bal: d.balance }))
  const payoff: Strategy['payoff'] = []
  let totalInterest = 0, m = 0
  const order = () => ds.filter((d) => d.bal > 0).sort((a, b) => method === 'boule' ? a.bal - b.bal : b.rate - a.rate)
  while (ds.some((d) => d.bal > 0) && m < 1200) {
    m++
    let pool = extra + ds.filter((d) => d.bal <= 0).reduce((s, d) => s + d.payment, 0)
    for (const d of ds) {
      if (d.bal <= 0) continue
      const i = Math.round(d.bal * d.rate / 1200)
      totalInterest += i
      d.bal += i
      const pay = Math.min(d.bal, d.payment)
      d.bal -= pay
      pool += d.payment - pay // mensualité non utilisée (dernière échéance)
    }
    for (const d of order()) { const pay = Math.min(d.bal, pool); d.bal -= pay; pool -= pay; if (!pool) break }
    for (const d of ds) if (d.bal <= 0 && !payoff.some((p) => p.id === d.id)) payoff.push({ id: d.id, name: d.name, month: m })
    if (m === 1 && ds.every((d) => d.bal > 0) && ds.every((d) => Math.round(d.balance * d.rate / 1200) >= d.payment) && !extra) throw new Error('Les mensualités ne couvrent pas les intérêts.')
  }
  return { months: m, totalInterest, payoff }
}
