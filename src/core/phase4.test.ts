import { describe, expect, it } from 'vitest'
import { amortize, balanceAt, paymentFor, payoffPlan } from './debt'
import { changeImpact, dailyForecast, roundUp, simulate, suggestedMonthly } from './planning'

describe('crédits', () => {
  it('mensualité et amortissement (20 000 € à 4 % sur 60 mois)', () => {
    const p = paymentFor(2_000_000, 4, 60)
    expect(p).toBe(36_834) // 368,33… arrondi au centime supérieur : pas de 61e échéance de quelques centimes
    const rows = amortize({ principal: 2_000_000, rate: 4, payment: p, startMonth: '2026-01' })
    expect(rows).toHaveLength(60)
    expect(rows.at(-1)!.balance).toBe(0)
    expect(rows[0]).toMatchObject({ interest: 6_667, principal: p - 6_667 })
  })
  it('remboursement anticipé : moins de mois et d’intérêts', () => {
    const base = amortize({ principal: 2_000_000, rate: 4, payment: 36_833, startMonth: '2026-01' })
    const fast = amortize({ principal: 2_000_000, rate: 4, payment: 36_833, startMonth: '2026-01', extraMonthly: 10_000, lumpSums: [{ month: '2026-06', amount: 300_000 }] })
    const interest = (r: typeof base) => r.reduce((s, x) => s + x.interest, 0)
    expect(fast.length).toBeLessThan(base.length - 15)
    expect(interest(fast)).toBeLessThan(interest(base))
    expect(balanceAt({ principal: 2_000_000, rate: 4, payment: 36_833, startMonth: '2026-01' }, '2025-12')).toBe(0)
  })
  it('mensualité trop faible', () => expect(() => amortize({ principal: 1_000_000, rate: 12, payment: 10_000, startMonth: '2026-01' })).toThrow(/intérêts/))
  it('boule de neige vs avalanche', () => {
    const debts = [
      { id: 'carte', name: 'Revolving', balance: 300_000, rate: 19, payment: 10_000 },
      { id: 'auto', name: 'Auto', balance: 800_000, rate: 5, payment: 20_000 },
      { id: 'perso', name: 'Perso', balance: 100_000, rate: 8, payment: 5_000 },
    ]
    const boule = payoffPlan(debts, 20_000, 'boule'), aval = payoffPlan(debts, 20_000, 'avalanche')
    expect(boule.payoff[0]!.id).toBe('perso')
    expect(aval.payoff[0]!.id).toBe('carte')
    expect(aval.totalInterest).toBeLessThanOrEqual(boule.totalInterest)
    expect(payoffPlan(debts, 0, 'avalanche').months).toBeGreaterThan(aval.months)
  })
})

describe('objectifs et épargne', () => {
  it('versement mensuel suggéré', () => {
    expect(suggestedMonthly(300_000, 60_000, '2027-06-30', '2026-11-03')).toBe(30_000) // 8 mois
    expect(suggestedMonthly(100, 200, '2027-01-01', '2026-11-03')).toBe(0)
    expect(suggestedMonthly(100, 0, null, '2026-11-03')).toBeNull()
  })
  it('arrondi supérieur', () => expect(roundUp([-450, -1200, -399])).toBe(50 + 0 + 1))
})

describe('scénarios', () => {
  const base = ['2027-01', '2027-02', '2027-03', '2027-04'].map((month) => ({ month, net: 50_000 }))
  it('perte de revenu, achat ponctuel, nouveau crédit', () => {
    const s = simulate(100_000, base, [
      { type: 'mensuel', label: 'Chômage', amount: -80_000, from: '2027-02', to: '2027-03' },
      { type: 'ponctuel', label: 'Voiture', amount: -200_000, month: '2027-04' },
      { type: 'credit', label: 'Prêt', principal: 1_200_000, rate: 0, months: 12, from: '2027-03' },
    ])
    expect(s.map((x) => x.balance)).toEqual([150_000, 120_000, -10_000, -260_000])
    expect(changeImpact({ type: 'credit', label: '', principal: 1_200_000, rate: 0, months: 2, from: '2027-01' }, '2027-03')).toBe(0)
  })
})

it('calendrier jour par jour', () => {
  const d = dailyForecast(10_000, '2026-11-03', 4, [{ date: '2026-11-05', label: 'Loyer', amount: -92_000 }], 2_000)
  expect(d.map((x) => x.balance)).toEqual([10_000, 8_000, -86_000, -88_000])
  expect(d[2]!.events[0]!.label).toBe('Loyer')
})
