import { addDays, addMonths, daysInMonth, monthOf } from './dates'

// « Mois budgétaire » : d'une paie à la veille de la suivante. La période est désignée par le mois où elle commence
// (« 2026-11 » = du 12 novembre au 11 décembre si la paie tombe le 12). Jour 1 = mois calendaires classiques.
const eff = (m: string, day: number) => Math.min(Math.max(1, day), daysInMonth(m)) // 31 → dernier jour du mois
const pad = (n: number) => String(n).padStart(2, '0')

export const periodStart = (key: string, day: number) => `${key}-${pad(eff(key, day))}`
export const periodEnd = (key: string, day: number) => addDays(periodStart(addMonths(key, 1), day), -1)
export function periodOf(date: string, day: number): string {
  const m = monthOf(date)
  return Number(date.slice(8, 10)) >= eff(m, day) ? m : addMonths(m, -1)
}

const short = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
/** « novembre 2026 » ou « 12 nov. → 11 déc. 2026 ». */
export function periodLabel(key: string, day: number): string {
  if (day <= 1) return new Date(`${key}-15`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const end = periodEnd(key, day)
  return `${short(periodStart(key, day))} → ${short(end)} ${end.slice(0, 4)}`
}

// Nom affiché d'une période : le mois qui en contient la majorité des jours. On tranche sur le seul jour de paie
// (≤ 15 → mois de début, sinon mois suivant) : la majorité stricte rendrait homonymes deux périodes autour d'un mois
// de février (paie le 15 ou le 16), ce qui casserait l'aller-retour nom → clé.
const startsLate = (day: number) => Math.min(Math.max(1, day), 31) > 15
/** Mois affiché ('YYYY-MM') de la période `key` : paie le 28 → « 28 oct. → 27 nov. » s'appelle novembre. */
export const periodName = (key: string, day: number) => (startsLate(day) ? addMonths(key, 1) : key)
/** Inverse de periodName : clé interne de la période affichée sous le nom `month`. */
export const periodKeyFor = (month: string, day: number) => (startsLate(day) ? addMonths(month, -1) : month)
/** « novembre 2026 » (long) ou « nov. 26 » (short), d'après le nom affiché de la période. */
export function periodTitle(key: string, day: number, style: 'long' | 'short' = 'long'): string {
  const name = periodName(key, day), d = new Date(`${name}-15T00:00:00Z`)
  if (style === 'long') return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return `${d.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })} ${name.slice(2, 4)}`
}
