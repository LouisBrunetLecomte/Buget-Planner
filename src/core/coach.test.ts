import { describe, expect, it } from 'vitest'
import { coach, spendingProfile, type SpendTx } from './coach'

const tx = (date: string, eur: number, label: string, o: Partial<SpendTx> = {}): SpendTx =>
  ({ id: date + label + eur, date, amount: Math.round(eur * 100), categoryId: 'c', label, labelNorm: label.toUpperCase(), fixed: false, ...o })

describe('profil de dépenses', () => {
  const txs = [
    tx('2026-11-05', -520, 'Loyer', { fixed: true, categoryId: 'loyer' }),
    ...Array.from({ length: 8 }, (_, k) => tx(`2026-11-${String(6 + k).padStart(2, '0')}`, -4.2, 'Boulangerie Marie', { categoryId: 'pain' })),
    tx('2026-11-07', -60, 'Carrefour', { categoryId: 'courses' }), tx('2026-11-14', -45, 'Bar', { categoryId: 'sorties' }), tx('2026-11-15', -30, 'Ciné', { categoryId: 'sorties' }),
    tx('2026-11-20', 1450, 'Salaire'), tx('2026-12-01', -999, 'Hors période'),
  ]
  const p = spendingProfile(txs, '2026-11-05', '2026-12-04', '2026-11-20')
  it('totaux, fixes séparés, catégories triées', () => {
    expect(p.spent).toBe(52000 + 8 * 420 + 6000 + 4500 + 3000)
    expect(p.fixed).toBe(52000)
    expect(p.variable).toBe(p.spent - 52000)
    expect(p.byCategory[0]).toMatchObject({ id: 'loyer', total: 52000, count: 1 })
    expect(p.byCategory.find((c) => c.id === 'sorties')).toMatchObject({ total: 7500, count: 2, avg: 3750 })
  })
  it('fréquence, petites dépenses, jours de la semaine, effet jour de paie', () => {
    expect(p.merchants[0]).toMatchObject({ label: 'Boulangerie Marie', count: 8, total: 3360, avg: 420 })
    expect(p.small).toEqual({ count: 8, total: 3360 })
    expect(p.weekdays.reduce((a, b) => a + b, 0)).toBe(p.variable)
    expect(p.daily).toHaveLength(16)
    expect(p.firstWeekShare).toBeCloseTo((6 * 420 + 6000) / p.variable, 5) // du 5 au 11 nov.
    expect(p.elapsed).toBe(16)
  })
})

describe('conseils', () => {
  const base = spendingProfile([], '2026-11-05', '2026-12-04', '2026-12-04')
  const input = { profile: base, previous: null, catName: () => 'x', income: 145000, monthlyExpense: 120000, savingsBalance: 0, savingsPerPeriod: 0, debtPerPeriod: 0,
    subscriptionsPerPeriod: 0, subscriptionsCount: 0, needs: 0, wants: 0, overspent: [], fees: 0, endBalance: 10000 }
  it('matelas de sécurité, se payer en premier, découvert, endettement', () => {
    const a = coach({ ...input, endBalance: -5000, debtPerPeriod: 60000 })
    expect(a.map((x) => x.id)).toEqual(expect.arrayContaining(['decouvert', 'precaution', 'payer-premier', 'dette']))
    expect(a[0]!.tone).toBe('attention')
    expect(a.find((x) => x.id === 'precaution')!.body).toMatch(/3 à 6 mois/)
    expect(a.find((x) => x.id === 'dette')!.source).toBe('hcsf')
  })
  it('félicite quand c’est bien : 4 mois de réserve, épargne programmée, 25 % gardés', () => {
    const spent = spendingProfile([tx('2026-11-10', -1087.5, 'Divers')], '2026-11-05', '2026-12-04', '2026-12-04')
    const a = coach({ ...input, profile: spent, savingsBalance: 480000, savingsPerPeriod: 15000 })
    expect(a.filter((x) => x.tone !== 'bravo')).toEqual([])
    expect(a.map((x) => x.id).sort()).toEqual(['precaution', 'taux'])
  })
  it('hausse d’une catégorie par rapport à la période précédente', () => {
    const now = spendingProfile([tx('2026-11-10', -200, 'Resto', { categoryId: 'resto' })], '2026-11-05', '2026-12-04', '2026-11-20')
    const before = spendingProfile([tx('2026-10-10', -100, 'Resto', { categoryId: 'resto' })], '2026-10-05', '2026-11-04', '2026-11-04')
    expect(coach({ ...input, profile: now, previous: before, catName: () => 'Restaurants', savingsBalance: 999999 }).find((x) => x.id === 'hausse:resto')!.title).toBe('Restaurants : +100 % par rapport à la période précédente')
  })
})
