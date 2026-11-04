import { addDays, daysBetween } from './dates'
import type { MonthBudget } from './budget'

// Prévision unique du solde : la même partout (Aperçu, Budget, Simulations, Jour par jour, alertes).
export type Confidence = 'none' | 'low' | 'ok'
export interface PeriodForecast {
  key: string; name: string; start: string; end: string
  balance: number   // solde prévu à `end` (veille de paie)
  income: number; fixed: number; oneOff: number; envelopes: number; everyday: number; savings: number // montants positifs
}
export interface ForecastDay { date: string; balance: number; events: { label: string; amount: number }[] }
export interface Forecast {
  scope: 'liquid' | 'total'; start: number; confidence: Confidence; dailyEveryday: number; observedDays: number
  periods: PeriodForecast[]; days: ForecastDay[]
}

/**
 * Dépense courante R (centimes par jour) : dépenses du quotidien observées, déjà filtrées par l'appelant
 * (hors virements, coches, échéances rapprochées, catégories budgétées), sur 90 jours au plus depuis `firstDate`.
 */
export function everydayRate(expenses: { date: string; amount: number }[], today: string, firstDate: string | null) {
  const from = firstDate && firstDate > addDays(today, -90) ? firstDate : addDays(today, -90)
  const seen = expenses.filter((e) => e.date >= from && e.date <= today && e.amount < 0)
  const observedDays = firstDate && firstDate <= today ? daysBetween(from, today) + 1 : 0
  const confidence: Confidence = !seen.length || observedDays < 3 ? 'none' : observedDays < 14 ? 'low' : 'ok'
  // trop peu de jours : on ne devine pas, l'écran prévient que le quotidien n'est pas compté
  const dailyEveryday = confidence === 'none' ? 0 : Math.round(-seen.reduce((s, e) => s + e.amount, 0) / observedDays)
  return { dailyEveryday, observedDays, confidence }
}

type Kind = 'income' | 'fixed' | 'oneOff' | 'envelopes' | 'savings'
interface Ev { date: string; amount: number; label: string; kind: Kind; until?: string } // until : montant réparti jour par jour jusqu'à cette date
export interface ForecastInput {
  scope: 'liquid' | 'total'; today: string; start: number
  rate: ReturnType<typeof everydayRate>
  periods: { key: string; name: string; start: string; end: string; budget: MonthBudget }[]
  /** Échéances non réglées hors budget (sans catégorie, épargne), date déjà ramenée à aujourd'hui si en retard. */
  extra: { date: string; amount: number; label: string; savings: boolean }[]
  label: (categoryId: string) => string
}

/** Événements d'une période : ce qui reste à payer / recevoir pour la période en cours, le prévu pour les suivantes. */
function periodEvents(p: ForecastInput['periods'][number], today: string, label: ForecastInput['label']): Ev[] {
  const cur = p.start <= today, from = cur ? today : p.start, out: Ev[] = []
  for (const r of p.budget.rows) {
    const sign = r.kind === 'revenu' ? 1 : -1, name = label(r.categoryId)
    // période en cours : ce qui reste (prorata de démarrage compris) ; suivantes : le prévu, sans report (déjà compté dans la période en cours)
    const target = cur ? r.toCome : Math.max(0, r.planned - r.actual)
    if (r.items.length) {
      const unpaid = r.items.filter((i) => !i.paid)
      for (const i of unpaid) out.push({ date: i.date < today ? today : i.date, amount: i.amount, label: i.name, kind: i.amount > 0 ? 'income' : 'fixed' })
      // montant changé pour ce mois sur une ligne à échéances : l'écart s'applique en début de période
      const gap = r.exception ? target - Math.abs(unpaid.reduce((s, i) => s + i.amount, 0)) : 0
      if (gap) out.push({ date: from, amount: sign * gap, label: name, kind: 'oneOff' })
    } else if (target) {
      if (r.kind === 'revenu') out.push({ date: p.end, amount: target, label: name, kind: 'income' }) // revenu sans date : au plus tard
      else if (r.base === null) out.push({ date: from, amount: -target, label: name, kind: 'oneOff' }) // ponctuel « une seule fois »
      else out.push({ date: from, until: p.end, amount: -target, label: name, kind: 'envelopes' })
    }
  }
  return out
}

/** Solde jour par jour jusqu'à la fin de la dernière période, et résumé par période (solde à la veille de chaque paie). */
export function buildForecast(i: ForecastInput): Forecast {
  const R = i.rate.dailyEveryday, byDay = new Map<string, number>(), named = new Map<string, ForecastDay['events']>()
  const add = (d: string, v: number) => byDay.set(d, (byDay.get(d) ?? 0) + v)
  const periods: PeriodForecast[] = i.periods.map((p) => {
    const evs = [...periodEvents(p, i.today, i.label),
      ...i.extra.filter((e) => e.date >= p.start && e.date <= p.end).map((e): Ev => ({ ...e, kind: e.savings ? 'savings' : e.amount > 0 ? 'income' : 'fixed' }))]
    const sum = (k: Kind) => evs.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0)
    for (const e of evs) {
      // un virement vers l'épargne ne change pas le total des comptes
      const v = e.kind === 'savings' && i.scope === 'total' ? 0 : e.amount
      if (e.until) {
        const n = daysBetween(e.date, e.until) + 1
        for (let k = 0; k < n; k++) add(addDays(e.date, k), Math.trunc(((k + 1) * v) / n) - Math.trunc((k * v) / n))
      } else if (v) { add(e.date, v); named.set(e.date, [...(named.get(e.date) ?? []), { label: e.label, amount: v }]) }
    }
    const everydayDays = Math.max(0, daysBetween(p.start > i.today ? addDays(p.start, -1) : i.today, p.end))
    return { key: p.key, name: p.name, start: p.start, end: p.end, balance: 0, income: sum('income'), fixed: -sum('fixed'), oneOff: -sum('oneOff'),
      envelopes: -sum('envelopes'), everyday: R * everydayDays, savings: -sum('savings') }
  })
  const days: ForecastDay[] = []
  let b = i.start
  const last = periods.at(-1)?.end ?? i.today
  for (let d = i.today; d <= last; d = addDays(d, 1)) {
    b += (byDay.get(d) ?? 0) - (d > i.today ? R : 0)
    days.push({ date: d, balance: b, events: named.get(d) ?? [] })
  }
  const at = new Map(days.map((d) => [d.date, d.balance]))
  for (const p of periods) p.balance = at.get(p.end) ?? i.start
  return { scope: i.scope, start: i.start, ...i.rate, periods, days }
}
