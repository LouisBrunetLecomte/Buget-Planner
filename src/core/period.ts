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
