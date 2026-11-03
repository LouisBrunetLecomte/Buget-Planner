import { expect, it } from 'vitest'
import { periodEnd, periodLabel, periodOf, periodStart } from './period'

it('périodes d’une paie à la veille de la suivante', () => {
  expect([periodStart('2026-11', 12), periodEnd('2026-11', 12)]).toEqual(['2026-11-12', '2026-12-11'])
  expect(periodOf('2026-11-12', 12)).toBe('2026-11')
  expect(periodOf('2026-12-11', 12)).toBe('2026-11')
  expect(periodOf('2026-11-11', 12)).toBe('2026-10')
  expect(periodOf('2027-01-05', 12)).toBe('2026-12') // à cheval sur l'année
  expect(periodLabel('2026-11', 12)).toBe('12 nov. → 11 déc. 2026')
})
it('jour 1 = mois classiques ; dernier jour du mois ramené', () => {
  expect([periodStart('2026-11', 1), periodEnd('2026-11', 1), periodOf('2026-11-30', 1)]).toEqual(['2026-11-01', '2026-11-30', '2026-11'])
  expect(periodLabel('2026-11', 1)).toBe('novembre 2026')
  // paie « le dernier jour » : 30 nov. → 30 déc. ; en février la période démarre le 28
  expect([periodStart('2026-11', 31), periodEnd('2026-11', 31)]).toEqual(['2026-11-30', '2026-12-30'])
  expect(periodEnd('2027-01', 31)).toBe('2027-02-27')
  expect(periodOf('2027-02-28', 31)).toBe('2027-02')
})
