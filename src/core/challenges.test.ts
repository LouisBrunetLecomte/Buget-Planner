import { describe, expect, it } from 'vitest'
import { budgetStreak, challenges, noSpendDays } from './challenges'

describe('séries et défis', () => {
  it('série de périodes dans le budget', () => {
    const p = (planned: number, actual: number) => ({ planned, actual })
    expect(budgetStreak([p(100, 90), p(100, 120), p(100, 100), p(0, 50), p(100, 80)])).toEqual({ current: 2, best: 2 })
    expect(budgetStreak([p(100, 90), p(100, 90), p(100, 90), p(100, 200)])).toEqual({ current: 0, best: 3 })
    expect(budgetStreak([])).toEqual({ current: 0, best: 0 })
  })
  it('jours sans dépense jusqu’à aujourd’hui seulement', () => {
    const daily = [{ date: '2026-11-01', total: 0 }, { date: '2026-11-02', total: -500 }, { date: '2026-11-03', total: 0 }, { date: '2026-11-04', total: 0 }]
    expect(noSpendDays(daily, '2026-11-03')).toBe(2)
  })
  it('défis : rythme du budget au prorata', () => {
    const base = { noSpend: 8, elapsed: 10, days: 30, finished: false, planned: 3000, actual: 900, savingRate: 0.1, variable: 500, previousVariable: 1000 }
    const c = Object.fromEntries(challenges(base).map((x) => [x.id, x]))
    expect(c['sans-depense']!.done).toBe(true)
    expect(c.budget!.detail).toBe('En avance sur le rythme prévu')
    expect(c.budget!.done).toBe(false) // pas fini tant que la période court
    expect(c.epargne!.progress).toBeCloseTo(0.5)
    expect(c.moins!.done).toBe(true)
    expect(challenges({ ...base, actual: 1100 }).find((x) => x.id === 'budget')!.detail).toBe('Au-dessus du rythme prévu')
    expect(challenges({ ...base, planned: 0, savingRate: null, previousVariable: null }).map((x) => x.id)).toEqual(['sans-depense'])
  })
})
