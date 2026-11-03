import { addDays, addMonths, daysBetween, daysInMonth, monthOf } from './dates'

export type Freq = 'week' | 'month' | 'year'
export interface Schedule { freq: Freq; interval: number; startDate: string; endDate: string | null }

/** Échéances entre from et to inclus. Le jour du mois est conservé, ramené au dernier jour si le mois est court (31 → 30/28). */
export function occurrences(s: Schedule, from: string, to: string): string[] {
  const out: string[] = []
  const last = s.endDate && s.endDate < to ? s.endDate : to
  const step = Math.max(1, s.interval)
  if (s.freq === 'week') {
    let d = s.startDate
    if (d < from) d = addDays(d, Math.floor(daysBetween(d, from) / (7 * step)) * 7 * step) // saute directement près de from
    for (; d <= last; d = addDays(d, 7 * step)) if (d >= from) out.push(d)
    return out
  }
  const months = s.freq === 'year' ? 12 * step : step
  const day = Number(s.startDate.slice(8, 10))
  for (let k = 0; ; k++) {
    const m = addMonths(monthOf(s.startDate), k * months)
    const d = `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`
    if (d > last) break
    if (d >= from) out.push(d)
  }
  return out
}

/** Coût mensuel équivalent (sert au provisionnement : une charge annuelle de 120 € = 10 €/mois). */
export function monthlyEquivalent(s: Pick<Schedule, 'freq' | 'interval'>, amount: number): number {
  const perYear = s.freq === 'week' ? 52 / s.interval : s.freq === 'month' ? 12 / s.interval : 1 / s.interval
  return Math.round((amount * perYear) / 12)
}

export interface MatchTx { id: string; date: string; amountEur: number }

/**
 * Associe chaque échéance à l'opération correspondante (même motif déjà filtré par l'appelant),
 * dans une fenêtre de ±tolérance jours ; chaque opération ne sert qu'une fois.
 */
export function matchOccurrences(dates: string[], txs: MatchTx[], s: Pick<Schedule, 'freq'>): Map<string, MatchTx> {
  const tol = s.freq === 'week' ? 2 : 6
  const used = new Set<string>(), out = new Map<string, MatchTx>()
  for (const d of dates) {
    let best: MatchTx | undefined, gap = Infinity
    for (const t of txs) {
      const g = Math.abs(daysBetween(d, t.date))
      if (!used.has(t.id) && g <= tol && g < gap) { best = t; gap = g }
    }
    if (best) { used.add(best.id); out.set(d, best) }
  }
  return out
}

/** Hausse de prix : dernier prélèvement plus élevé (en valeur absolue, +1 % mini) que le précédent. */
export function priceIncrease(txs: MatchTx[]): { from: number; to: number; date: string } | null {
  const s = [...txs].sort((a, b) => a.date.localeCompare(b.date))
  const last = s.at(-1), prev = s.at(-2)
  if (!last || !prev) return null
  const a = Math.abs(prev.amountEur), b = Math.abs(last.amountEur)
  return b > a * 1.01 ? { from: prev.amountEur, to: last.amountEur, date: last.date } : null
}

// ---------- détection automatique ----------
export interface DetectTx { date: string; amountEur: number; labelNorm: string; accountId: string; categoryId: string | null }
export interface Suggestion {
  pattern: string; accountId: string; categoryId: string | null; amount: number
  freq: Freq; interval: number; startDate: string; count: number
}

const PERIODS: { days: number; freq: Freq; interval: number }[] = [
  { days: 7, freq: 'week', interval: 1 }, { days: 14, freq: 'week', interval: 2 },
  { days: 30.4, freq: 'month', interval: 1 }, { days: 61, freq: 'month', interval: 2 },
  { days: 91, freq: 'month', interval: 3 }, { days: 182, freq: 'month', interval: 6 },
  { days: 365, freq: 'year', interval: 1 },
]
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }

/** Clé de regroupement : libellé normalisé sans les mots contenant des chiffres, 3 premiers mots. */
export const recurringKey = (labelNorm: string) => labelNorm.split(' ').filter((w) => w.length > 1 && !/\d/.test(w)).slice(0, 3).join(' ')

/**
 * Repère les opérations qui reviennent à intervalle régulier avec un montant stable.
 * Critères : 3 occurrences (2 pour l'annuel), 75 % des intervalles à ±20 % de la période,
 * 75 % des montants à ±25 % de la médiane, dernière occurrence récente.
 */
export function detectRecurring(txs: DetectTx[], today: string): Suggestion[] {
  const groups = new Map<string, DetectTx[]>()
  for (const t of txs) {
    const k = recurringKey(t.labelNorm)
    if (!k) continue
    const key = `${t.accountId}|${Math.sign(t.amountEur)}|${k}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: Suggestion[] = []
  for (const [key, g] of groups) {
    const s = [...g].sort((a, b) => a.date.localeCompare(b.date))
    const gaps = s.slice(1).map((t, i) => daysBetween(s[i]!.date, t.date))
    if (!gaps.length) continue
    const med = median(gaps)
    const p = PERIODS.find((x) => Math.abs(med - x.days) <= x.days * 0.2)
    if (!p || s.length < (p.days >= 365 ? 2 : 3)) continue
    if (gaps.filter((x) => Math.abs(x - p.days) <= Math.max(3, p.days * 0.2)).length < gaps.length * 0.75) continue
    const amts = s.map((t) => Math.abs(t.amountEur)), mAmt = median(amts)
    if (amts.filter((a) => Math.abs(a - mAmt) <= mAmt * 0.25).length < amts.length * 0.75) continue
    const last = s.at(-1)!
    if (daysBetween(last.date, today) > p.days * 1.5 + 5) continue // arrêtée
    const cats = s.map((t) => t.categoryId).filter(Boolean) as string[]
    const categoryId = cats.length ? [...cats].sort((a, b) => cats.filter((c) => c === b).length - cats.filter((c) => c === a).length)[0]! : null
    out.push({ pattern: key.split('|')[2]!, accountId: last.accountId, categoryId, amount: last.amountEur, freq: p.freq, interval: p.interval, startDate: last.date, count: s.length })
  }
  return out.sort((a, b) => a.amount - b.amount)
}
