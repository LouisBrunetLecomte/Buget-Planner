import { addDays, daysBetween } from './dates'
import { recurringKey } from './recurring'
import type { MonthBudget } from './budget'
import { formatMoney } from './money'

// ---------- anomalies ----------
export interface AnoTx { id: string; accountId: string; date: string; amountEur: number; label: string; labelNorm: string; importKey: string | null; categoryId: string | null; transferGroupId: string | null }
export type Anomaly =
  | { kind: 'doublon'; id: string; txs: [AnoTx, AnoTx] }
  | { kind: 'inhabituel'; id: string; tx: AnoTx; usual: number }
  | { kind: 'frais'; id: string; txs: AnoTx[]; total: number }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }
const FEES = /\b(FRAIS|COMMISSION|AGIOS|INTERETS DEBITEURS|COTISATION|INCIDENT|REJET)\b/

/**
 * - doublon : une saisie manuelle et une opération importée, même compte, même montant, ≤ 3 jours d'écart ;
 * - montant inhabituel : dépense > 2× la médiane habituelle chez ce marchand (≥ 3 précédents) et +20 € d'écart ;
 * - frais bancaires : opérations de frais des 90 derniers jours (catégorie ou libellé).
 */
export function findAnomalies(txs: AnoTx[], today: string, feesCategoryId: string | null): Anomaly[] {
  const out: Anomaly[] = []
  const recent = txs.filter((t) => t.date >= addDays(today, -90) && !t.transferGroupId)
  const manual = recent.filter((t) => !t.importKey)
  const used = new Set<string>()
  for (const m of manual) {
    const twin = recent.find((t) => t.importKey && !used.has(t.id) && t.accountId === m.accountId && t.amountEur === m.amountEur && Math.abs(daysBetween(m.date, t.date)) <= 3)
    if (twin) { used.add(twin.id); out.push({ kind: 'doublon', id: `doublon:${m.id}:${twin.id}`, txs: [m, twin] }) }
  }
  const byKey = new Map<string, AnoTx[]>()
  for (const t of txs) if (t.amountEur < 0 && !t.transferGroupId) { const k = recurringKey(t.labelNorm); if (k) byKey.set(k, [...(byKey.get(k) ?? []), t]) }
  for (const g of byKey.values()) {
    const s = [...g].sort((a, b) => a.date.localeCompare(b.date))
    s.forEach((t, i) => {
      if (i < 3 || t.date < addDays(today, -30)) return
      const usual = median(s.slice(0, i).map((x) => -x.amountEur))
      if (-t.amountEur > 2 * usual && -t.amountEur - usual > 2000) out.push({ kind: 'inhabituel', id: `inhabituel:${t.id}`, tx: t, usual: -usual })
    })
  }
  const fees = recent.filter((t) => t.amountEur < 0 && ((feesCategoryId && t.categoryId === feesCategoryId) || FEES.test(t.labelNorm)))
  if (fees.length) out.push({ kind: 'frais', id: `frais:${fees.map((f) => f.date + f.id).sort().at(-1)}`, txs: fees, total: fees.reduce((s, f) => s + f.amountEur, 0) })
  return out
}

// ---------- score de santé ----------
export interface HealthInput {
  savingsRate: number          // 3 derniers mois complets, 0..1 (peut être négatif)
  monthsOfReserve: number      // épargne disponible / dépenses mensuelles moyennes
  budgetRespect: number | null // part des lignes de dépense non dépassées le mois dernier (null = pas de budget)
  negativeDays: number         // jours à solde courant négatif sur 90 jours
  fees90: number               // frais bancaires sur 90 jours (centimes, positif)
}
export interface HealthPart { label: string; points: number; max: number; hint: string }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
/** Score sur 100 : épargne 30, réserve 25, budget 20, découvert 15, frais 10. Chaque critère explique comment gagner des points. */
export function healthScore(h: HealthInput): { score: number; parts: HealthPart[] } {
  const parts: HealthPart[] = [
    { label: 'Taux d’épargne', max: 30, points: Math.round(30 * clamp01(h.savingsRate / 0.2)), hint: `${Math.round(h.savingsRate * 100)} % (objectif 20 %)` },
    { label: 'Épargne de précaution', max: 25, points: Math.round(25 * clamp01(h.monthsOfReserve / 3)), hint: `${h.monthsOfReserve.toFixed(1)} mois de dépenses (objectif 3)` },
    { label: 'Respect du budget', max: 20, points: h.budgetRespect === null ? 10 : Math.round(20 * h.budgetRespect), hint: h.budgetRespect === null ? 'pas encore de budget' : `${Math.round(h.budgetRespect * 100)} % des enveloppes tenues le mois dernier` },
    { label: 'Pas de découvert', max: 15, points: Math.round(15 * clamp01(1 - h.negativeDays / 10)), hint: h.negativeDays ? `${h.negativeDays} jour(s) à découvert sur 90` : 'aucun jour à découvert sur 90' },
    { label: 'Frais bancaires', max: 10, points: h.fees90 <= 0 ? 10 : h.fees90 <= 3000 ? 5 : 0, hint: h.fees90 ? `${(h.fees90 / 100).toFixed(2).replace('.', ',')} € sur 90 jours` : 'aucun sur 90 jours' },
  ]
  return { score: parts.reduce((s, p) => s + p.points, 0), parts }
}

export const savingsRate = (months: Pick<MonthBudget, 'actualIncome' | 'actualExpense'>[]) => {
  const inc = months.reduce((s, m) => s + m.actualIncome, 0), exp = months.reduce((s, m) => s + m.actualExpense, 0)
  return inc > 0 ? (inc - exp) / inc : 0
}

// ---------- soldes ----------
/** Soldes de fin de journée à partir du solde de départ et des sommes par jour. */
export function dailyBalances(start: number, daily: Map<string, number>, from: string, to: string): { date: string; balance: number }[] {
  const out: { date: string; balance: number }[] = []
  let b = start
  for (let d = from; d <= to; d = addDays(d, 1)) { b += daily.get(d) ?? 0; out.push({ date: d, balance: b }) }
  return out
}
export function monthEnds(series: { date: string; balance: number }[]): { month: string; balance: number }[] {
  const m = new Map<string, number>()
  for (const p of series) m.set(p.date.slice(0, 7), p.balance)
  return [...m].map(([month, balance]) => ({ month, balance }))
}

// ---------- alertes ----------
export type Severity = 'critique' | 'attention' | 'info'
export interface Alert { id: string; type: AlertType; severity: Severity; title: string; body: string; href?: string }
export type AlertType = 'budget' | 'solde' | 'decouvert' | 'echeance' | 'revenu' | 'anomalie'
export interface AlertSettings {
  enabled: Record<AlertType, boolean>
  budgetWarnPct: number   // ex. 80
  lowBalance: number      // centimes
  daysBefore: number      // prélèvement à venir
  notifications: boolean
}
export const DEFAULT_ALERTS: AlertSettings = {
  enabled: { budget: true, solde: true, decouvert: true, echeance: true, revenu: true, anomalie: true },
  budgetWarnPct: 80, lowBalance: 20_000, daysBefore: 3, notifications: false,
}

export interface AlertInput {
  today: string
  month: MonthBudget | null
  catLabel: (id: string) => string
  liquid: number
  resteAVivre: number
  liquidProjection: { month: string; balance: number }[]
  upcoming: { name: string; date: string; amount: number }[]   // échéances non réglées à venir
  missedIncome: { name: string; date: string; amount: number }[]
  anomalies: Anomaly[]
}

const eur = (c: number) => formatMoney(c)
const dayFr = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** Toutes les alertes actives, calculées à partir de l'état courant (rien n'est stocké hormis les alertes masquées). */
export function computeAlerts(i: AlertInput, s: AlertSettings): Alert[] {
  const out: Alert[] = []
  if (s.enabled.budget && i.month) for (const r of i.month.rows) {
    if (r.kind !== 'depense') continue
    const avail = r.planned + r.carry
    if (avail <= 0 && r.actual <= 0) continue
    const pct = avail > 0 ? r.actual / avail : Infinity
    if (pct > 1) out.push({ id: `budget100:${r.categoryId}:${i.month.month}`, type: 'budget', severity: 'critique', title: `Budget dépassé : ${i.catLabel(r.categoryId)}`, body: `${eur(r.actual)} dépensés pour ${eur(avail)} prévus.`, href: '#/budget' })
    else if (pct * 100 >= s.budgetWarnPct) out.push({ id: `budget${s.budgetWarnPct}:${r.categoryId}:${i.month.month}`, type: 'budget', severity: 'attention', title: `${Math.round(pct * 100)} % du budget ${i.catLabel(r.categoryId)}`, body: `Reste ${eur(avail - r.actual)} sur ${eur(avail)}.`, href: '#/budget' })
  }
  if (s.enabled.solde && i.liquid < s.lowBalance) out.push({ id: `solde:${i.today}`, type: 'solde', severity: i.liquid < 0 ? 'critique' : 'attention', title: 'Solde bas', body: `Tes comptes courants totalisent ${eur(i.liquid)} (seuil ${eur(s.lowBalance)}).`, href: '#/comptes' })
  if (s.enabled.decouvert) {
    if (i.resteAVivre < 0) out.push({ id: `decouvert-mois:${i.today.slice(0, 7)}`, type: 'decouvert', severity: 'critique', title: 'Découvert probable avant la fin du mois', body: `Après les échéances à venir, il manquerait ${eur(-i.resteAVivre)}.`, href: '#/recurrences' })
    const neg = i.liquidProjection.find((p) => p.balance < 0 && p.month > i.today.slice(0, 7))
    if (neg) out.push({ id: `decouvert:${neg.month}`, type: 'decouvert', severity: 'attention', title: `Découvert probable fin ${new Date(neg.month + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`, body: `Comptes courants projetés à ${eur(neg.balance)} si le budget est suivi.`, href: '#/analyses' })
  }
  if (s.enabled.echeance) for (const u of i.upcoming) {
    if (u.amount >= 0 || daysBetween(i.today, u.date) > s.daysBefore) continue
    out.push({ id: `echeance:${u.name}:${u.date}`, type: 'echeance', severity: 'info', title: `${u.name} : ${eur(u.amount)}`, body: `Prélèvement prévu ${u.date === i.today ? 'aujourd’hui' : `le ${dayFr(u.date)}`}.`, href: '#/recurrences' })
  }
  if (s.enabled.revenu) for (const m of i.missedIncome)
    out.push({ id: `revenu:${m.name}:${m.date}`, type: 'revenu', severity: 'attention', title: `${m.name} non reçu`, body: `Attendu le ${dayFr(m.date)} (${eur(m.amount)}), pas retrouvé dans tes opérations.`, href: '#/recurrences' })
  if (s.enabled.anomalie) for (const a of i.anomalies) {
    if (a.kind === 'doublon') out.push({ id: a.id, type: 'anomalie', severity: 'attention', title: 'Doublon probable', body: `« ${a.txs[0].label} » saisi à la main et « ${a.txs[1].label} » importé : ${eur(a.txs[0].amountEur)}.`, href: '#/operations' })
    else if (a.kind === 'inhabituel') out.push({ id: a.id, type: 'anomalie', severity: 'info', title: 'Montant inhabituel', body: `${a.tx.label} : ${eur(a.tx.amountEur)} au lieu de ${eur(a.usual)} d’habitude.`, href: '#/operations' })
    else out.push({ id: a.id, type: 'anomalie', severity: 'info', title: 'Frais bancaires', body: `${eur(-a.total)} sur les 90 derniers jours (${a.txs.length} opération(s)).`, href: '#/operations' })
  }
  const order: Record<Severity, number> = { critique: 0, attention: 1, info: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

// ---------- faits marquants ----------
/** Phrases courtes tirées du dernier mois complet comparé à la moyenne des 3 précédents. */
export function insights(history: MonthBudget[], catLabel: (id: string) => string): string[] {
  const out: string[] = []
  const [last, ...prev] = [...history].reverse()
  if (!last || prev.length < 1) return out
  const ref = prev.slice(0, 3)
  const avg = (f: (m: MonthBudget) => number) => ref.reduce((s, m) => s + f(m), 0) / ref.length
  const name = new Date(last.month + '-15').toLocaleDateString('fr-FR', { month: 'long' })
  const exp = last.actualExpense, expAvg = avg((m) => m.actualExpense)
  if (expAvg > 0) {
    const d = (exp - expAvg) / expAvg
    if (Math.abs(d) >= 0.05) out.push(`En ${name}, tes dépenses ont ${d > 0 ? 'augmenté' : 'baissé'} de ${Math.round(Math.abs(d) * 100)} % par rapport à ta moyenne (${eur(exp)} contre ${eur(expAvg)}).`)
  }
  let best: { id: string; diff: number } | null = null
  for (const r of last.rows) {
    if (r.kind !== 'depense') continue
    const a = avg((m) => m.rows.find((x) => x.categoryId === r.categoryId)?.actual ?? 0)
    const diff = r.actual - a
    if (diff > 3000 && (!best || diff > best.diff)) best = { id: r.categoryId, diff }
  }
  if (best) out.push(`Plus forte hausse : ${catLabel(best.id)}, +${eur(best.diff)} par rapport à d’habitude.`)
  const rate = savingsRate([last]), rateAvg = savingsRate(ref)
  if (last.actualIncome > 0) out.push(`Taux d’épargne de ${name} : ${Math.round(rate * 100)} %${ref.length ? ` (moyenne précédente ${Math.round(rateAvg * 100)} %)` : ''}.`)
  return out
}

