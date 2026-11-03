import { addDays, addMonths } from './dates'
import { paymentFor } from './debt'

// ---------- objectifs ----------
/** Versement mensuel pour atteindre la cible à l'échéance (mois restants, mois en cours compris). */
export function suggestedMonthly(target: number, current: number, deadline: string | null, today: string): number | null {
  if (!deadline) return null
  const left = target - current
  if (left <= 0) return 0
  const months = Math.max(1, (Number(deadline.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(deadline.slice(5, 7)) - Number(today.slice(5, 7)) + 1)
  return Math.ceil(left / months)
}

/** Arrondi supérieur : différence entre chaque dépense et l'euro (ou le pas) supérieur. */
export const roundUp = (expenses: number[], step = 100) => expenses.reduce((s, e) => { const a = Math.abs(e) % step; return s + (a ? step - a : 0) }, 0)

// ---------- scénarios ----------
export type Change =
  | { type: 'mensuel'; label: string; amount: number; from: string; to?: string | null }   // revenu (+) ou dépense (−) récurrent
  | { type: 'ponctuel'; label: string; amount: number; month: string }
  | { type: 'credit'; label: string; principal: number; rate: number; months: number; from: string }

export const creditPayment = (c: Extract<Change, { type: 'credit' }>) => paymentFor(c.principal, c.rate, c.months)

/** Impact d'un changement sur un mois donné (centimes, signé). */
export function changeImpact(c: Change, month: string): number {
  switch (c.type) {
    case 'mensuel': return month >= c.from && (!c.to || month <= c.to) ? c.amount : 0
    case 'ponctuel': return month === c.month ? c.amount : 0
    case 'credit': return month >= c.from && month < addMonths(c.from, c.months) ? -creditPayment(c) : 0
  }
}

/** Solde de fin de mois : base (flux prévus) + changements du scénario. */
export function simulate(start: number, base: { month: string; net: number }[], changes: Change[]): { month: string; balance: number }[] {
  let b = start
  return base.map(({ month, net }) => { b += net + changes.reduce((s, c) => s + changeImpact(c, month), 0); return { month, balance: b } })
}

// ---------- calendrier financier ----------
export interface DayEvent { date: string; label: string; amount: number }
/** Solde jour par jour : échéances connues + dépense courante moyenne par jour. */
export function dailyForecast(start: number, today: string, days: number, events: DayEvent[], dailyVariable: number) {
  const out: { date: string; balance: number; events: DayEvent[] }[] = []
  let b = start
  for (let k = 0; k < days; k++) {
    const date = addDays(today, k)
    const ev = events.filter((e) => e.date === date)
    b += ev.reduce((s, e) => s + e.amount, 0) - (k === 0 ? 0 : dailyVariable)
    out.push({ date, balance: b, events: ev })
  }
  return out
}

