import { describe, expect, it } from 'vitest'
import { parseReceipt } from './receipt'
import { parseStatementItems, type PdfItem } from './pdfStatement'
import { fiscalEstimate } from './fiscal'
import { toCsv, vatOf } from './exporters'

it('ticket de caisse', () => {
  const t = `CARREFOUR CITY\nBienvenue\n12 RUE DE PARIS\nPAIN 1,20\nLAIT 0,99\nSOUS-TOTAL 2,19\nTOTAL TTC 2,19 €\nTVA 5,5% 0,11\n03/11/2026 12:04`
  expect(parseReceipt(t)).toEqual({ total: 219, date: '2026-11-03', merchant: 'CARREFOUR CITY' })
  expect(parseReceipt('SNACK\n3,50\n12,00\n').total).toBe(1200)
})

describe('relevé PDF', () => {
  const it_ = (str: string, x: number, y: number): PdfItem => ({ str, x, y, page: 1 })
  const items = [
    it_('Relevé du 01/10/2026 au 31/10/2026', 50, 800),
    it_('Date', 50, 700), it_('Libellé', 120, 700), it_('Débit', 400, 700), it_('Crédit', 480, 700),
    it_('02/10', 50, 680), it_('CB CARREFOUR', 120, 680), it_('45,10', 405, 680),
    it_('05/10', 50, 660), it_('VIR SALAIRE', 120, 660), it_('ACME', 200, 660), it_('2 650,00', 478, 660),
    it_('SOLDE', 50, 640), it_('1 000,00', 478, 640),
  ]
  it('sens par colonne, année déduite, lignes hors opération ignorées', () => {
    expect(parseStatementItems(items)).toEqual([
      { date: '2026-10-02', amount: -4510, label: 'CB CARREFOUR' },
      { date: '2026-10-05', amount: 265000, label: 'VIR SALAIRE ACME' },
    ])
  })
})

it('récapitulatif fiscal', () => {
  const e = fiscalEstimate({ don: 30_000, garde: 500_000, domicile: 2_000_000 }, 1)
  expect(e.don.benefit).toBe(19_800)
  expect(e.garde.benefit).toBe(175_000)
  expect(e.domicile.benefit).toBe(675_000) // plafond 13 500 €
})

it('CSV Excel FR, anti-injection de formules, TVA', () => {
  const csv = toCsv(['Libellé', 'Montant'], [['=HYPERLINK("x")', 12.5], ['a;b', null]])
  expect(csv).toBe('﻿Libellé;Montant\r\n"\'=HYPERLINK(""x"")";12,5\r\n"a;b";')
  expect(vatOf(12000, 20)).toEqual({ ht: 10000, tva: 2000 })
  expect(vatOf(-1055, 5.5)).toEqual({ ht: -1000, tva: -55 })
})

it('assistant : réponse ramenée à une catégorie existante', async () => {
  const { matchCategory, ollamaChat, DEFAULT_ASSISTANT } = await import('./assistant')
  expect(matchCategory('Catégorie : Restaurants.', ['Courses', 'Restaurants', 'Restaurants rapides'])).toBe('Restaurants')
  expect(matchCategory('je ne sais pas', ['Courses'])).toBeNull()
  await expect(ollamaChat({ ...DEFAULT_ASSISTANT, url: 'https://evil.example.com' }, [])).rejects.toThrow(/cette machine/)
})
