// Taux BCE via Frankfurter (gratuit, sans clé, CORS ouvert). Le cache est en base (table fx_rate).

/** Taux "1 devise = x EUR" pour chaque jour ouvré de la période. */
export async function fetchRatesToEur(currency: string, from: string, to: string): Promise<Record<string, number>> {
  const res = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?base=${currency}&symbols=EUR`)
  if (!res.ok) throw new Error(`Taux ${currency} indisponibles (${res.status})`)
  const json = (await res.json()) as { rates?: Record<string, { EUR?: number }> }
  const out: Record<string, number> = {}
  for (const [d, r] of Object.entries(json.rates ?? {})) if (typeof r.EUR === 'number' && r.EUR > 0) out[d] = r.EUR
  return out
}

/** Taux applicable à une date : le dernier publié à cette date ou avant (week-ends, fériés), sinon le premier après. */
export function rateOn(rates: { date: string; rate: number }[], date: string): number | null {
  if (!rates.length) return null
  const sorted = [...rates].sort((a, b) => a.date.localeCompare(b.date))
  let pick = sorted[0]!
  for (const r of sorted) { if (r.date <= date) pick = r; else break }
  return pick.rate
}
