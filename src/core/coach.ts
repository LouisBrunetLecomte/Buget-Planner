import { addDays, daysBetween } from './dates'
import { recurringKey } from './recurring'

// ---------- profil de dépenses d'une période ----------
export interface SpendTx { id: string; date: string; amount: number /* EUR, signé */; categoryId: string | null; label: string; labelNorm: string; fixed: boolean /* échéance (loyer…) */ }

export interface Profile {
  spent: number; variable: number; fixed: number; count: number; variableCount: number; days: number; elapsed: number
  byCategory: { id: string | null; total: number; count: number; avg: number }[]
  merchants: { key: string; label: string; total: number; count: number; avg: number }[]
  small: { count: number; total: number }          // achats de moins de SMALL_LIMIT
  weekdays: number[]                                // dépenses variables par jour de la semaine (lundi = 0)
  daily: { date: string; total: number }[]          // dépenses variables jour par jour
  firstWeekShare: number                            // part des dépenses variables des 7 premiers jours (0..1)
  weekendShare: number
}
export const SMALL_LIMIT = 1500

/** Profil des dépenses (montants négatifs) entre start et min(end, today). */
export function spendingProfile(txs: SpendTx[], start: string, end: string, today: string): Profile {
  const last = today < end ? today : end
  const exp = txs.filter((t) => t.amount < 0 && t.date >= start && t.date <= last)
  const abs = (t: SpendTx) => -t.amount
  const variable = exp.filter((t) => !t.fixed)
  const group = <K,>(xs: SpendTx[], key: (t: SpendTx) => K) => {
    const m = new Map<K, SpendTx[]>()
    for (const t of xs) m.set(key(t), [...(m.get(key(t)) ?? []), t])
    return m
  }
  const sum = (xs: SpendTx[]) => xs.reduce((s, t) => s + abs(t), 0)
  const byCategory = [...group(exp, (t) => t.categoryId)].map(([id, xs]) => ({ id, total: sum(xs), count: xs.length, avg: Math.round(sum(xs) / xs.length) })).sort((a, b) => b.total - a.total)
  const merchants = [...group(variable, (t) => recurringKey(t.labelNorm) || t.labelNorm)].filter(([k]) => k)
    .map(([key, xs]) => ({ key, label: xs[xs.length - 1]!.label, total: sum(xs), count: xs.length, avg: Math.round(sum(xs) / xs.length) }))
    .sort((a, b) => b.count - a.count || b.total - a.total)
  const weekdays = [0, 0, 0, 0, 0, 0, 0]
  for (const t of variable) weekdays[(new Date(t.date + 'T00:00:00Z').getUTCDay() + 6) % 7]! += abs(t)
  const daily: Profile['daily'] = []
  for (let d = start; d <= last; d = addDays(d, 1)) daily.push({ date: d, total: sum(variable.filter((t) => t.date === d)) })
  const v = sum(variable)
  const small = variable.filter((t) => abs(t) < SMALL_LIMIT)
  return {
    spent: sum(exp), variable: v, fixed: sum(exp) - v, count: exp.length, variableCount: variable.length,
    days: daysBetween(start, end) + 1, elapsed: Math.max(1, daysBetween(start, last) + 1),
    byCategory, merchants, small: { count: small.length, total: sum(small) }, weekdays, daily,
    firstWeekShare: v ? sum(variable.filter((t) => t.date <= addDays(start, 6))) / v : 0,
    weekendShare: v ? (weekdays[5]! + weekdays[6]!) / v : 0,
  }
}

// ---------- conseils ----------
/** Repères publiés par des sources reconnues (affichés avec chaque conseil). */
export const SOURCES = {
  precaution: { label: 'Épargne de précaution : 3 à 6 mois de dépenses courantes (Caisse d’Épargne, Crédit Agricole)', url: 'https://www.credit-agricole.fr/particulier/conseils/magazine/tout-un-mag/epargne-de-precaution-quel-montant-ou-placer.html' },
  regle503020: { label: 'Règle 50/30/20 (E. Warren) : 50 % besoins, 30 % envies, 20 % épargne (La finance pour tous)', url: 'https://www.lafinancepourtous.com/outils/questions-reponses/budget-qu-est-ce-que-la-regle-des-50-30-20/' },
  payerPremier: { label: 'Automatiser l’épargne dès la réception du salaire (Crédit Agricole, méthode 50/30/20)', url: 'https://www.credit-agricole.fr/particulier/conseils/magazine/tout-un-mag/methode-50-30-20-comment-calculer-gerer-son-budget.html' },
  hcsf: { label: 'Taux d’effort maximal de 35 % des revenus pour les crédits (HCSF)', url: 'https://www.economie.gouv.fr/hcsf/mesures/mesure-relative-loctroi-de-credits-immobiliers' },
  bdf: { label: 'Éviter le découvert : alertes de solde, report des prélèvements, Points conseil budget gratuits (Banque de France)', url: 'https://www.inc-conso.fr/sites/default/files/pdf/lettre-mes-questions-argent-bnf.pdf' },
} as const
export type SourceKey = keyof typeof SOURCES

export type Tone = 'attention' | 'conseil' | 'bravo'
export interface Advice { id: string; tone: Tone; title: string; body: string; action?: string; source?: SourceKey }

export interface CoachInput {
  profile: Profile
  previous: Profile | null
  catName: (id: string | null) => string
  income: number                    // revenus de la période (reçus, à défaut prévus)
  monthlyExpense: number            // dépenses moyennes par période (réelles, à défaut prévues)
  savingsBalance: number            // comptes épargne
  savingsPerPeriod: number          // virements programmés vers l'épargne
  debtPerPeriod: number             // mensualités de crédit
  subscriptionsPerPeriod: number; subscriptionsCount: number
  needs: number; wants: number      // dépenses classées besoin / envie (50/30/20)
  overspent: { name: string; over: number }[]
  fees: number                      // frais bancaires de la période
  endBalance: number                // solde prévu avant la paie
}

const eur = (c: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(c / 100)
const pct = (x: number) => `${Math.round(x * 100)} %`

/** Conseils de la période, du plus urgent au plus encourageant. Chaque règle s'appuie sur un chiffre de l'utilisateur. */
export function coach(i: CoachInput): Advice[] {
  const out: Advice[] = []
  const p = i.profile

  if (i.endBalance < 0) out.push({ id: 'decouvert', tone: 'attention', title: `Découvert probable avant ta paie (${eur(i.endBalance)})`,
    body: 'À ce rythme, ton compte passera dans le rouge avant la prochaine paie, avec des frais à la clé.',
    action: 'Décale une dépense non urgente, réduis une enveloppe, ou demande à ta banque de reporter un prélèvement. Les Points conseil budget de la Banque de France sont gratuits.', source: 'bdf' })

  for (const o of i.overspent.slice(0, 2)) out.push({ id: `depasse:${o.name}`, tone: 'attention', title: `${o.name} : budget dépassé de ${eur(o.over)}`,
    body: 'Ce poste a coûté plus que prévu sur cette période.', action: 'Fixe-toi un plafond par semaine pour ce poste, ou ajuste le budget s’il était trop bas.' })

  // épargne de précaution : 3 à 6 mois de dépenses courantes
  if (i.monthlyExpense > 0) {
    const months = i.savingsBalance / i.monthlyExpense, goal = i.monthlyExpense * 3
    if (months < 1) out.push({ id: 'precaution', tone: 'attention', title: 'Pas encore de matelas de sécurité',
      body: `Tu as ${eur(i.savingsBalance)} de côté, soit ${months.toFixed(1).replace('.', ',')} mois de dépenses. Les experts recommandent 3 à 6 mois (${eur(goal)} pour toi).`,
      action: `Commence petit : ${eur(Math.max(2000, Math.round(i.monthlyExpense * 0.05 / 1000) * 1000))} par paie sur un livret, sans y toucher.`, source: 'precaution' })
    else if (months < 3) out.push({ id: 'precaution', tone: 'conseil', title: `Matelas de sécurité : ${months.toFixed(1).replace('.', ',')} mois sur 3`,
      body: `Il te manque ${eur(goal - i.savingsBalance)} pour atteindre 3 mois de dépenses.`, source: 'precaution' })
    else out.push({ id: 'precaution', tone: 'bravo', title: `Matelas de sécurité : ${months.toFixed(1).replace('.', ',')} mois`, body: 'Tu dépasses les 3 mois recommandés. Au-delà de 6 mois, ton argent peut travailler ailleurs.', source: 'precaution' })
  }

  // taux d'épargne et « se payer en premier »
  if (i.income > 0) {
    const rate = (i.income - p.spent) / i.income
    if (i.savingsPerPeriod === 0) out.push({ id: 'payer-premier', tone: 'conseil', title: 'Paie-toi en premier',
      body: 'Aucun virement automatique vers ton épargne n’est programmé : ce qui reste en fin de mois a tendance à fondre.',
      action: `Programme un virement de ${eur(Math.round(i.income * 0.1 / 1000) * 1000)} (10 % de ta paie) vers ton livret le jour où elle arrive. Ajoute-le dans Budget → Ajouter une ligne → Virement vers mon épargne.`, source: 'payerPremier' })
    if (p.elapsed >= p.days * 0.8) {
      if (rate >= 0.2) out.push({ id: 'taux', tone: 'bravo', title: `Tu as gardé ${pct(rate)} de tes revenus`, body: 'C’est au niveau des 20 % recommandés par la règle 50/30/20.', source: 'regle503020' })
      else if (rate < 0.1) out.push({ id: 'taux', tone: 'conseil', title: `Tu as gardé ${pct(Math.max(0, rate))} de tes revenus`, body: 'La règle 50/30/20 vise 20 % d’épargne. Même 10 % change tout sur un an.', source: 'regle503020' })
    }
    if (i.needs > i.income * 0.5) out.push({ id: 'besoins', tone: 'conseil', title: `Tes dépenses essentielles pèsent ${pct(i.needs / i.income)} de tes revenus`,
      body: 'Au-delà de 50 %, la marge pour les envies et l’épargne se réduit. Loyer, énergie, assurances, forfaits : ce sont les postes où une renégociation rapporte chaque mois.', source: 'regle503020' })
    if (i.wants > i.income * 0.3) out.push({ id: 'envies', tone: 'conseil', title: `Les envies représentent ${pct(i.wants / i.income)} de tes revenus`, body: 'La règle 50/30/20 conseille de rester sous 30 %.', source: 'regle503020' })
    const debt = i.debtPerPeriod / i.income
    if (debt > 0.35) out.push({ id: 'dette', tone: 'attention', title: `Tes crédits prennent ${pct(debt)} de tes revenus`, body: 'C’est au-dessus du plafond de 35 % appliqué par les banques : un nouveau crédit serait risqué.', source: 'hcsf' })
    else if (debt > 0.25) out.push({ id: 'dette', tone: 'conseil', title: `Tes crédits prennent ${pct(debt)} de tes revenus`, body: 'Tu approches du plafond de 35 % : évite d’en ajouter.', source: 'hcsf' })
    if (i.subscriptionsPerPeriod > i.income * 0.05 || i.subscriptionsCount >= 5) out.push({ id: 'abos', tone: 'conseil', title: `${i.subscriptionsCount} abonnements : ${eur(i.subscriptionsPerPeriod)} par mois`,
      body: `Soit ${eur(i.subscriptionsPerPeriod * 12)} par an.`, action: 'Passe-les en revue : lequel n’as-tu pas utilisé ce mois-ci ?' })
  }

  // comportements observés
  if (p.small.count >= 10 && p.small.total >= p.variable * 0.15) out.push({ id: 'petites', tone: 'conseil', title: `${p.small.count} petits achats de moins de 15 € : ${eur(p.small.total)}`,
    body: `Ils font ${pct(p.small.total / Math.max(1, p.variable))} de tes dépenses du quotidien. Pris un par un ils paraissent anodins, ensemble ils pèsent.`, action: 'Fixe-toi un plafond « petits plaisirs » par semaine.' })
  const top = p.merchants[0]
  if (top && top.count >= 6) out.push({ id: `frequent:${top.key}`, tone: 'conseil', title: `${top.count} passages chez ${top.label}`, body: `Pour ${eur(top.total)} au total (${eur(top.avg)} en moyenne).`, action: 'Grouper ces achats en une ou deux fois par semaine réduit souvent la note.' })
  // un comportement se juge sur plusieurs achats (au moins 5)
  if (p.variableCount >= 5 && p.elapsed >= 10 && p.firstWeekShare > 0.45) out.push({ id: 'jour-paie', tone: 'conseil', title: `${pct(p.firstWeekShare)} de tes dépenses dans la première semaine`,
    body: 'L’effet « jour de paie » : on dépense plus quand le compte est plein, puis la fin de période est serrée.', action: 'Divise ton budget variable par semaine et tiens-toi à cette part.' })
  if (p.variableCount >= 5 && p.elapsed >= 14 && p.weekendShare > 0.5) out.push({ id: 'weekend', tone: 'conseil', title: `${pct(p.weekendShare)} de tes dépenses le week-end`, body: 'Prévoir un budget sorties pour le week-end évite les mauvaises surprises du lundi.' })
  if (i.fees > 0) out.push({ id: 'frais', tone: 'conseil', title: `${eur(i.fees)} de frais bancaires`, body: 'Des frais évitables : agios, commissions d’intervention, cotisations.', action: 'Active une alerte de solde bas et compare les offres : beaucoup de banques en ligne n’en facturent pas.', source: 'bdf' })

  // évolution par rapport à la période précédente
  if (i.previous) {
    for (const c of p.byCategory.slice(0, 5)) {
      const before = i.previous.byCategory.find((x) => x.id === c.id)?.total ?? 0
      if (before > 0 && c.total - before >= 3000 && c.total >= before * 1.3) {
        out.push({ id: `hausse:${c.id}`, tone: 'conseil', title: `${i.catName(c.id)} : +${pct(c.total / before - 1)} par rapport à la période précédente`, body: `${eur(c.total)} contre ${eur(before)}.` })
        break
      }
    }
    if (i.previous.variable > 0 && p.elapsed >= p.days * 0.8 && p.variable <= i.previous.variable * 0.9)
      out.push({ id: 'baisse', tone: 'bravo', title: `Dépenses du quotidien en baisse de ${pct(1 - p.variable / i.previous.variable)}`, body: 'Bien joué par rapport à la période précédente.' })
  }

  const order: Record<Tone, number> = { attention: 0, conseil: 1, bravo: 2 }
  return out.sort((a, b) => order[a.tone] - order[b.tone])
}
