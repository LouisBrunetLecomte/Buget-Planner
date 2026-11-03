/** Formats de date acceptés à l'import. */
export type DateFormat = 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'YYYYMMDD'
export const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'YYYYMMDD']

const pad = (n: number) => String(n).padStart(2, '0')

function valid(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Renvoie une date ISO "YYYY-MM-DD" ou null. Ignore une éventuelle heure. */
export function parseDate(input: string, format: DateFormat): string | null {
  const s = input.trim()
  let m: RegExpMatchArray | null
  switch (format) {
    case 'DD/MM/YYYY': m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); return m ? valid(+m[3]!, +m[2]!, +m[1]!) : null
    case 'MM/DD/YYYY': m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); return m ? valid(+m[3]!, +m[1]!, +m[2]!) : null
    case 'YYYY-MM-DD': m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/); return m ? valid(+m[1]!, +m[2]!, +m[3]!) : null
    case 'YYYYMMDD': m = s.match(/^(\d{4})(\d{2})(\d{2})/); return m ? valid(+m[1]!, +m[2]!, +m[3]!) : null
  }
}

/** Devine le format à partir d'échantillons : le premier qui les lit tous. */
export function guessDateFormat(samples: string[]): DateFormat | null {
  const xs = samples.filter((s) => s.trim())
  return DATE_FORMATS.find((f) => xs.length > 0 && xs.every((s) => parseDate(s, f))) ?? null
}

export const today = () => new Date().toISOString().slice(0, 10)

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

// ---------- mois "YYYY-MM" ----------
export const monthOf = (date: string) => date.slice(0, 7)
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}
export const daysInMonth = (month: string) => { const [y, m] = month.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, m, 0)).getUTCDate() }
export const endOfMonth = (month: string) => `${month}-${pad(daysInMonth(month))}`
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}
