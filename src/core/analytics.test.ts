import { describe, expect, it } from 'vitest'
import { computeAlerts, dailyBalances, DEFAULT_ALERTS, findAnomalies, healthScore, insights, monthEnds, type AnoTx } from './analytics'
import type { MonthBudget } from './budget'

const tx = (id: string, date: string, amountEur: number, label: string, o: Partial<AnoTx> = {}): AnoTx =>
  ({ id, accountId: 'c', date, amountEur, label, labelNorm: label.toUpperCase(), importKey: 'k' + id, categoryId: null, transferGroupId: null, ...o })

describe('anomalies', () => {
  const today = '2026-11-03'
  const txs = [
    tx('m', '2026-10-30', -4210, 'Courses', { importKey: null }), tx('i', '2026-11-01', -4210, 'CB AUCHAN'),
    ...['2026-07-01', '2026-08-01', '2026-09-01'].map((d, k) => tx('e' + k, d, -6000, 'EDF CLIENTS')), tx('e9', '2026-10-25', -18000, 'EDF CLIENTS'),
    tx('f', '2026-10-10', -800, 'COTISATION CARTE'), tx('g', '2026-10-12', -1600, 'COMMISSION INTERVENTION'),
    tx('v', '2026-10-10', -50000, 'VIR', { transferGroupId: 'g', importKey: null }),
  ]
  const a = findAnomalies(txs, today, null)
  it('doublon saisie manuelle / import', () => expect(a.find((x) => x.kind === 'doublon')).toMatchObject({ txs: [{ id: 'm' }, { id: 'i' }] }))
  it('montant inhabituel', () => expect(a.find((x) => x.kind === 'inhabituel')).toMatchObject({ tx: { id: 'e9' }, usual: -6000 }))
  it('frais bancaires', () => expect(a.find((x) => x.kind === 'frais')).toMatchObject({ total: -2400 }))
  it('pas de faux doublon entre deux imports', () => expect(findAnomalies([tx('a', '2026-11-01', -250, 'CAFE'), tx('b', '2026-11-01', -250, 'CAFE')], today, null)).toEqual([]))
})

it('score de santé', () => {
  const perfect = healthScore({ savingsRate: 0.25, monthsOfReserve: 4, budgetRespect: 1, negativeDays: 0, fees90: 0 })
  expect(perfect.score).toBe(100)
  const poor = healthScore({ savingsRate: -0.1, monthsOfReserve: 0.5, budgetRespect: 0.5, negativeDays: 12, fees90: 5000 })
  expect(poor.score).toBe(0 + 4 + 10 + 0 + 0)
})

it('soldes journaliers et fins de mois', () => {
  const s = dailyBalances(1000, new Map([['2026-01-31', -200], ['2026-02-01', 50]]), '2026-01-30', '2026-02-02')
  expect(s.map((p) => p.balance)).toEqual([1000, 800, 850, 850])
  expect(monthEnds(s)).toEqual([{ month: '2026-01', balance: 800 }, { month: '2026-02', balance: 850 }])
})

const mb = (month: string, income: number, expense: number, rows: { categoryId: string; actual: number; planned?: number }[] = []): MonthBudget => ({
  month, rows: rows.map((r) => ({ categoryId: r.categoryId, kind: 'depense', base: r.planned ?? 0, exception: null, planned: r.planned ?? 0, carry: 0, actual: r.actual, remaining: (r.planned ?? 0) - r.actual })),
  unbudgetedExpense: 0, unbudgetedIncome: 0, plannedIncome: 0, plannedExpense: 0, actualIncome: income, actualExpense: expense, toAssign: 0,
  buckets: { besoin: { planned: 0, actual: 0 }, envie: { planned: 0, actual: 0 } },
})

describe('alertes', () => {
  const base = { today: '2026-11-03', catLabel: (id: string) => id, liquid: 50_000, resteAVivre: 10_000, liquidProjection: [], upcoming: [], missedIncome: [], anomalies: [] }
  it('budget 80 % / 100 %, échéance, revenu manquant, découvert', () => {
    const month = mb('2026-11', 0, 0, [{ categoryId: 'resto', actual: 8500, planned: 10000 }, { categoryId: 'loisirs', actual: 12000, planned: 10000 }, { categoryId: 'ok', actual: 100, planned: 10000 }])
    const a = computeAlerts({ ...base, month, resteAVivre: -500,
      upcoming: [{ name: 'Loyer', date: '2026-11-05', amount: -92000 }, { name: 'EDF', date: '2026-11-20', amount: -6000 }],
      missedIncome: [{ name: 'Salaire', date: '2026-10-28', amount: 265000 }],
      liquidProjection: [{ month: '2026-11', balance: 100 }, { month: '2027-01', balance: -3000 }] }, DEFAULT_ALERTS)
    expect(a.map((x) => x.id)).toEqual(['budget100:loisirs:2026-11', 'decouvert-mois:2026-11', 'budget80:resto:2026-11', 'decouvert:2027-01', 'revenu:Salaire:2026-10-28', 'echeance:Loyer:2026-11-05'])
  })
  it('désactivation par type et seuils', () => {
    const s = { ...DEFAULT_ALERTS, enabled: { ...DEFAULT_ALERTS.enabled, solde: false }, lowBalance: 100_000 }
    expect(computeAlerts({ ...base, month: null }, s)).toEqual([])
    expect(computeAlerts({ ...base, month: null }, { ...DEFAULT_ALERTS, lowBalance: 100_000 })[0]!.type).toBe('solde')
  })
})

it('faits marquants', () => {
  const h = [mb('2026-07', 300000, 200000, [{ categoryId: 'resto', actual: 10000 }]), mb('2026-08', 300000, 200000, [{ categoryId: 'resto', actual: 10000 }]),
    mb('2026-09', 300000, 200000, [{ categoryId: 'resto', actual: 10000 }]), mb('2026-10', 300000, 250000, [{ categoryId: 'resto', actual: 25000 }])]
  const s = insights(h, (id) => id)
  expect(s[0]).toMatch(/octobre, tes dépenses ont augmenté de 25 %/)
  expect(s[1]).toMatch(/resto, \+150,00/)
  expect(s[2]).toMatch(/17 % \(moyenne précédente 33 %\)/)
})
