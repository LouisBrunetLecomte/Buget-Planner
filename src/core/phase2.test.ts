import { describe, expect, it } from 'vitest'
import { addMonths, daysInMonth, monthsBetween } from './dates'
import { detectRecurring, matchOccurrences, monthlyEquivalent, occurrences, priceIncrease } from './recurring'
import { applyScope, computeBudget, lineFor, projectBalances, resteAVivre, type Actuals, type Cat } from './budget'

it('arithmétique des mois', () => {
  expect(addMonths('2026-11', 2)).toBe('2027-01')
  expect(addMonths('2026-01', -1)).toBe('2025-12')
  expect(daysInMonth('2028-02')).toBe(29)
  expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
})

describe('échéancier', () => {
  it('mensuel le 31 → ramené au dernier jour', () => {
    expect(occurrences({ freq: 'month', interval: 1, startDate: '2026-01-31', endDate: null }, '2026-01-01', '2026-04-30'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('trimestriel, annuel, hebdo, fin', () => {
    expect(occurrences({ freq: 'month', interval: 3, startDate: '2026-01-15', endDate: null }, '2026-03-01', '2026-12-31')).toEqual(['2026-04-15', '2026-07-15', '2026-10-15'])
    expect(occurrences({ freq: 'year', interval: 1, startDate: '2024-02-29', endDate: null }, '2025-01-01', '2028-12-31')).toEqual(['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
    expect(occurrences({ freq: 'week', interval: 2, startDate: '2026-01-02', endDate: '2026-02-10' }, '2026-01-20', '2026-03-01')).toEqual(['2026-01-30'])
  })
  it('équivalent mensuel (provision)', () => {
    expect(monthlyEquivalent({ freq: 'year', interval: 1 }, -12000)).toBe(-1000)
    expect(monthlyEquivalent({ freq: 'week', interval: 1 }, -1200)).toBe(-5200)
    expect(monthlyEquivalent({ freq: 'month', interval: 3 }, -3000)).toBe(-1000)
  })
  it('rapprochement échéances / opérations et hausse de prix', () => {
    const txs = [{ id: 'a', date: '2026-01-16', amountEur: -1349 }, { id: 'b', date: '2026-02-15', amountEur: -1499 }]
    const m = matchOccurrences(['2026-01-15', '2026-02-15', '2026-03-15'], txs, { freq: 'month' })
    expect([...m.keys()]).toEqual(['2026-01-15', '2026-02-15'])
    expect(priceIncrease(txs)).toEqual({ from: -1349, to: -1499, date: '2026-02-15' })
    expect(priceIncrease(txs.slice(0, 1))).toBeNull()
  })
})

describe('détection des récurrences', () => {
  const t = (date: string, amountEur: number, labelNorm: string) => ({ date, amountEur, labelNorm, accountId: 'c', categoryId: null })
  const txs = [
    ...['2026-07-05', '2026-08-05', '2026-09-04', '2026-10-05'].map((d) => t(d, -92000, 'SCI LES TILLEULS LOYER')),
    ...['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15'].map((d, i) => t(d, i < 3 ? -1349 : -1499, 'NETFLIX COM')),
    ...['2026-07-02', '2026-07-09', '2026-07-30', '2026-08-03', '2026-08-28', '2026-09-20', '2026-10-01'].map((d) => t(d, -3500, 'CARREFOUR MARKET 12')),
    ...['2025-03-10', '2026-03-12'].map((d) => t(d, -45000, 'ASSURANCE HABITATION MAIF')),
    ...['2026-01-05', '2026-02-05', '2026-03-05'].map((d) => t(d, -2000, 'ABONNEMENT RESILIE')),
  ]
  const s = detectRecurring(txs, '2026-11-03')
  it('trouve loyer, Netflix (malgré la hausse), assurance annuelle', () => {
    expect(s.map((x) => [x.pattern, x.freq, x.interval])).toEqual([
      ['SCI LES TILLEULS', 'month', 1], ['ASSURANCE HABITATION MAIF', 'year', 1], ['NETFLIX COM', 'month', 1],
    ])
    expect(s.find((x) => x.pattern === 'NETFLIX COM')).toMatchObject({ amount: -1499, startDate: '2026-10-15' })
  })
})

describe('budget', () => {
  const cats: Cat[] = [
    { id: 'rev', parentId: null, kind: 'revenu', rollover: false, bucket: null },
    { id: 'alim', parentId: null, kind: 'depense', rollover: false, bucket: 'besoin' },
    { id: 'courses', parentId: 'alim', kind: 'depense', rollover: false, bucket: null },
    { id: 'resto', parentId: 'alim', kind: 'depense', rollover: false, bucket: 'envie' },
    { id: 'voyage', parentId: null, kind: 'depense', rollover: true, bucket: 'envie' },
    { id: 'vir', parentId: null, kind: 'transfert', rollover: false, bucket: null },
  ]
  const lines = [
    { categoryId: 'rev', amount: 250000, validFrom: '2026-01', validTo: null },
    { categoryId: 'alim', amount: 40000, validFrom: '2026-01', validTo: null },
    { categoryId: 'resto', amount: 10000, validFrom: '2026-01', validTo: null },
    { categoryId: 'voyage', amount: 10000, validFrom: '2026-01', validTo: null },
  ]
  const actuals: Actuals = new Map([
    ['2026-01', new Map([['rev', 250000], ['courses', -35000], ['resto', -12000], ['voyage', 0], ['vir', -30000], ['', -500]])],
    ['2026-02', new Map([['rev', 250000], ['voyage', -25000]])],
  ])
  const exceptions = [{ id: 'x', categoryId: 'voyage', month: '2026-02', amount: 30000, reason: 'Vacances' }]
  const [jan, feb, mar] = computeBudget(cats, lines, exceptions, actuals, '2026-01', '2026-03')

  it('sous-catégorie non budgétée → parent ; virements et non catégorisé', () => {
    const row = (m: typeof jan, id: string) => m!.rows.find((r) => r.categoryId === id)!
    expect(row(jan, 'alim').actual).toBe(35000)
    expect(row(jan, 'resto')).toMatchObject({ actual: 12000, remaining: -2000 })
    expect(jan!.unbudgetedExpense).toBe(500)
    expect(jan!.actualExpense).toBe(35000 + 12000 + 500)
    expect(jan!.toAssign).toBe(250000 - 60000)
    expect(jan!.buckets).toEqual({ besoin: { planned: 40000, actual: 35000 }, envie: { planned: 20000, actual: 12000 } })
  })
  it('exception ponctuelle + report cumulé', () => {
    const v = (m: typeof jan) => m!.rows.find((r) => r.categoryId === 'voyage')!
    expect(v(jan)).toMatchObject({ planned: 10000, carry: 0, remaining: 10000 })
    expect(v(feb)).toMatchObject({ base: 10000, planned: 30000, carry: 10000, actual: 25000, remaining: 15000 })
    expect(v(feb).exception?.reason).toBe('Vacances')
    expect(v(mar)).toMatchObject({ planned: 10000, exception: null, carry: 15000 })
  })
  it('projection du solde', () => {
    // février en cours : revenus déjà reçus ; reste alim 40000, resto 10000, voyage 15000 à dépenser
    const p = projectBalances(100000, [jan!, feb!, mar!], '2026-02')
    expect(p).toEqual([{ month: '2026-02', balance: 100000 - 40000 - 10000 - 15000 }, { month: '2026-03', balance: 35000 + 250000 - 60000 }])
  })
})

describe('portées de modification', () => {
  const lines = [{ categoryId: 'a', amount: 100, validFrom: '2026-01', validTo: null }, { categoryId: 'a', amount: 300, validFrom: '2026-09', validTo: null }]
  it('à partir de ce mois : ferme le passé, remplace le futur', () => {
    const n = applyScope(lines, 'a', '2026-05', 200, 'from')
    expect(n).toEqual([{ categoryId: 'a', amount: 100, validFrom: '2026-01', validTo: '2026-04' }, { categoryId: 'a', amount: 200, validFrom: '2026-05', validTo: null }])
    expect(lineFor(n, 'a', '2026-04')!.amount).toBe(100)
    expect(lineFor(n, 'a', '2026-12')!.amount).toBe(200)
  })
  it('tous les mois : une seule ligne', () => {
    expect(applyScope(lines, 'a', '2026-05', 50, 'all')).toEqual([{ categoryId: 'a', amount: 50, validFrom: '2000-01', validTo: null }])
  })
})

it('reste à vivre', () => {
  expect(resteAVivre(50000, [-10000, 5000], '2026-11-21', '2026-11-30')).toEqual({ amount: 45000, daysLeft: 10, perDay: 4500 })
})

describe('échéances datées comme source du budget', () => {
  const cats: Cat[] = [
    { id: 'loyer', parentId: null, kind: 'depense', rollover: false, bucket: null },
    { id: 'salaire', parentId: null, kind: 'revenu', rollover: false, bucket: null },
    { id: 'net', parentId: null, kind: 'depense', rollover: false, bucket: null },
  ]
  const plan = new Map([
    ['2026-11', new Map([['loyer', [{ id: 'r1', name: 'Loyer', date: '2026-11-05', amount: -92000 }]], ['salaire', [{ id: 's', name: 'Salaire', date: '2026-11-28', amount: 265000 }]],
      ['net', [{ id: 'b', name: 'Box', date: '2026-11-10', amount: -2999 }, { id: 'm', name: 'Mobile', date: '2026-11-12', amount: -1999 }]]])],
  ])
  it('le prévu suit les échéances ; une ligne saisie l’emporte ; une exception aussi', () => {
    const [m] = computeBudget(cats, [{ categoryId: 'net', amount: 6000, validFrom: '2026-01', validTo: null }], [], new Map(), '2026-11', '2026-11', plan)
    const r = (id: string) => m!.rows.find((x) => x.categoryId === id)!
    expect(r('loyer')).toMatchObject({ source: 'echeances', planned: 92000 })
    expect(r('salaire')).toMatchObject({ source: 'echeances', planned: 265000, kind: 'revenu' })
    expect(r('net')).toMatchObject({ source: 'ligne', planned: 6000 })
    expect(r('net').items).toHaveLength(2)
    const [e] = computeBudget(cats, [], [{ id: 'x', categoryId: 'loyer', month: '2026-11', amount: 0, reason: 'Logé chez des amis' }], new Map(), '2026-11', '2026-11', plan)
    expect(e!.rows.find((x) => x.categoryId === 'loyer')!.planned).toBe(0)
  })
})
