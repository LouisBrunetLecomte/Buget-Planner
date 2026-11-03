import { addMonths, monthsBetween } from './dates'

export interface Line { categoryId: string; amount: number; validFrom: string; validTo: string | null }
export interface Exception { id: string; categoryId: string; month: string; amount: number; reason: string | null }
export interface Cat { id: string; parentId: string | null; kind: 'depense' | 'revenu' | 'transfert'; rollover: boolean; bucket: 'besoin' | 'envie' | null }
/** Somme signée des montants EUR par mois puis par catégorie ('' = non catégorisé). */
export type Actuals = Map<string, Map<string, number>>

/** Échéances datées (charges fixes, revenus) par mois puis par catégorie : la source unique de ces montants. */
export interface PlannedItem { id: string; name: string; date: string; amount: number }
export type RecurringPlan = Map<string, Map<string, PlannedItem[]>>

export interface Row {
  categoryId: string; kind: 'depense' | 'revenu'
  source: 'ligne' | 'echeances' // montant saisi dans le budget, ou calculé depuis les échéances datées
  items: PlannedItem[]          // échéances datées de la période pour cette catégorie
  overridden: number | null     // ancien montant saisi, ignoré parce que des échéances datées existent
  base: number | null          // montant du modèle pour ce mois
  exception: Exception | null  // surcharge ponctuelle
  planned: number              // exception ?? base
  carry: number                // report des mois précédents (si activé)
  actual: number               // positif = dépensé (dépense) ou reçu (revenu)
  remaining: number            // planned + carry - actual
}
export interface MonthBudget {
  month: string; rows: Row[]
  unbudgetedExpense: number; unbudgetedIncome: number
  plannedIncome: number; plannedExpense: number; actualIncome: number; actualExpense: number
  toAssign: number             // base zéro : revenus prévus - dépenses prévues
  buckets: Record<'besoin' | 'envie', { planned: number; actual: number }>
}

/** Ligne de modèle en vigueur pour un mois ; la plus récemment commencée gagne. */
export function lineFor(lines: Line[], categoryId: string, month: string): Line | null {
  let best: Line | null = null
  for (const l of lines)
    if (l.categoryId === categoryId && l.validFrom <= month && (!l.validTo || l.validTo >= month) && (!best || l.validFrom > best.validFrom)) best = l
  return best
}

/**
 * Calcule le budget mois par mois de `from` à `to`. Le report (rollover) s'accumule depuis `from` :
 * passer le premier mois du budget pour un report exact.
 */
export function computeBudget(cats: Cat[], lines: Line[], exceptions: Exception[], actuals: Actuals, from: string, to: string, plan: RecurringPlan = new Map()): MonthBudget[] {
  const byId = new Map(cats.map((c) => [c.id, c]))
  const carry = new Map<string, number>()
  const out: MonthBudget[] = []
  for (const month of monthsBetween(from, to)) {
    const rows = new Map<string, Row>()
    for (const c of cats) {
      if (c.kind === 'transfert') continue
      const line = lineFor(lines, c.id, month)
      const items = plan.get(month)?.get(c.id) ?? []
      // les échéances datées (loyer, salaire…) sont la source : elles l'emportent sur un montant saisi à la main
      const fromItems = items.length ? Math.max(0, items.reduce((s, i) => s + (c.kind === 'depense' ? -i.amount : i.amount), 0)) : null
      const base = fromItems ?? line?.amount ?? null
      const exception = exceptions.find((e) => e.categoryId === c.id && e.month === month) ?? null
      if (base === null && !exception) continue
      const cy = c.rollover && c.kind === 'depense' ? (carry.get(c.id) ?? 0) : 0
      const planned = exception?.amount ?? base!
      rows.set(c.id, { categoryId: c.id, kind: c.kind, source: items.length ? 'echeances' : 'ligne', items, overridden: items.length && line ? line.amount : null, base, exception, planned, carry: cy, actual: 0, remaining: 0 })
    }
    let unbudgetedExpense = 0, unbudgetedIncome = 0
    for (const [catId, sum] of actuals.get(month) ?? []) {
      const c = byId.get(catId)
      if (c?.kind === 'transfert') continue
      // une opération compte pour sa catégorie si elle est budgétée, sinon pour sa catégorie parente
      const row = rows.get(catId) ?? (c?.parentId ? rows.get(c.parentId) : undefined)
      if (row) row.actual += row.kind === 'depense' ? -sum : sum
      else if (c ? c.kind === 'depense' : sum < 0) unbudgetedExpense -= sum
      else unbudgetedIncome += sum
    }
    const list = [...rows.values()]
    const buckets = { besoin: { planned: 0, actual: 0 }, envie: { planned: 0, actual: 0 } }
    for (const r of list) {
      r.remaining = r.planned + r.carry - r.actual
      const c = byId.get(r.categoryId)!
      if (c.rollover && c.kind === 'depense') carry.set(c.id, r.remaining)
      const b = c.bucket ?? (c.parentId ? byId.get(c.parentId)?.bucket : null)
      if (r.kind === 'depense' && b) { buckets[b].planned += r.planned; buckets[b].actual += r.actual }
    }
    const sum = (k: 'depense' | 'revenu', f: (r: Row) => number) => list.filter((r) => r.kind === k).reduce((s, r) => s + f(r), 0)
    const plannedIncome = sum('revenu', (r) => r.planned), plannedExpense = sum('depense', (r) => r.planned)
    out.push({
      month, rows: list, unbudgetedExpense, unbudgetedIncome, plannedIncome, plannedExpense,
      actualIncome: sum('revenu', (r) => r.actual) + unbudgetedIncome, actualExpense: sum('depense', (r) => r.actual) + unbudgetedExpense,
      toAssign: plannedIncome - plannedExpense, buckets,
    })
  }
  return out
}

/**
 * Solde projeté en fin de mois. Mois en cours : on ajoute seulement ce qui reste à recevoir / à dépenser.
 * Mois futurs : revenus prévus - dépenses prévues.
 */
export function projectBalances(balanceNow: number, months: MonthBudget[], currentMonth: string): { month: string; balance: number }[] {
  let bal = balanceNow
  const out: { month: string; balance: number }[] = []
  for (const m of months) {
    if (m.month < currentMonth) continue
    if (m.month === currentMonth) {
      for (const r of m.rows) bal += r.kind === 'revenu' ? Math.max(r.planned - r.actual, 0) : -Math.max(r.planned + r.carry - r.actual, 0)
    } else bal += m.plannedIncome - m.plannedExpense
    out.push({ month: m.month, balance: bal })
  }
  return out
}

/** Reste à vivre : solde disponible + revenus attendus - charges à venir d'ici la fin du mois, réparti par jour. */
export function resteAVivre(liquid: number, upcoming: number[], today: string, monthEnd: string) {
  const amount = liquid + upcoming.reduce((s, a) => s + a, 0)
  const daysLeft = Math.max(1, Math.round((Date.parse(monthEnd) - Date.parse(today)) / 86_400_000) + 1)
  return { amount, daysLeft, perDay: Math.floor(amount / daysLeft) }
}

/** Modifications du modèle selon la portée choisie. Renvoie les nouvelles lignes de la catégorie. */
export type Scope = 'month' | 'from' | 'all'
export const ALL_TIME = '2000-01'
export function applyScope(lines: Line[], categoryId: string, month: string, amount: number, scope: Exclude<Scope, 'month'>): Line[] {
  const own = lines.filter((l) => l.categoryId === categoryId)
  if (scope === 'all') return [{ categoryId, amount, validFrom: ALL_TIME, validTo: null }]
  // "à partir de ce mois" : les lignes antérieures s'arrêtent le mois précédent, les postérieures sont remplacées
  const prev = addMonths(month, -1)
  const kept = own.filter((l) => l.validFrom < month).map((l) => (!l.validTo || l.validTo >= month ? { ...l, validTo: prev } : l))
  return [...kept, { categoryId, amount, validFrom: month, validTo: null }]
}
