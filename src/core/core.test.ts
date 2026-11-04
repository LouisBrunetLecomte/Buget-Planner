import { describe, expect, it } from 'vitest'
import { parseAmount, formatMoney } from './money'
import { parseDate, guessDateFormat } from './dates'
import { normalizeLabel } from './labels'
import { readCsvGrid, suggestMapping, parseCsv, parseOfx, parseQif, decodeFile, detectKind } from './parsers'
import { withImportKeys } from './dedup'
import { findTransferPairs } from './transfers'
import { categorize, learnPattern } from './rules'
import { validateSplits } from './splits'
import { deriveKey, seal, open, newSalt } from './crypto'

describe('montants', () => {
  it.each([
    ['12,34', 1234], ['-12,34', -1234], ['1 234,56', 123456], ['1 234,56 €', 123456], ['1.234,56', 123456],
    ['1,234.56', 123456], ['-12.5', -1250], ['(12,00)', -1200], ['12,00-', -1200], ['+3', 300], ['0,005', 1], ['1,234', 123400],
  ])('%s → %i', (s, c) => expect(parseAmount(s)).toBe(c))
  it('rejette les textes', () => { expect(parseAmount('abc')).toBeNull(); expect(parseAmount('')).toBeNull() })
  it('formate en français', () => expect(formatMoney(-123456)).toMatch(/-1\s234,56\s€/))
})

describe('dates', () => {
  it('lit les formats', () => {
    expect(parseDate('03/11/2026', 'DD/MM/YYYY')).toBe('2026-11-03')
    expect(parseDate('3.11.26', 'DD/MM/YYYY')).toBe('2026-11-03')
    expect(parseDate('2026-11-03 14:22:01', 'YYYY-MM-DD')).toBe('2026-11-03')
    expect(parseDate('20261103120000[+1:CET]', 'YYYYMMDD')).toBe('2026-11-03')
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull()
  })
  it('devine le format', () => {
    expect(guessDateFormat(['25/10/2026', '03/11/2026'])).toBe('DD/MM/YYYY')
    expect(guessDateFormat(['2026-10-25'])).toBe('YYYY-MM-DD')
  })
})

it('normalise les libellés', () => {
  expect(normalizeLabel('CB CARREFOUR MARKET 02/11 ')).toBe('CARREFOUR MARKET')
  expect(normalizeLabel('PRLV SEPA Électricité de France')).toBe('ELECTRICITE DE FRANCE')
})

describe('CSV', () => {
  const csv = `Compte courant;;;\nDate;Libellé;Débit;Crédit\n02/11/2026;CB BOULANGERIE;4,50;\n01/11/2026;VIR SALAIRE;;2 100,00\n31/13/2026;bad;1;\n`
  const grid = readCsvGrid(csv)
  const m = suggestMapping(grid)
  it('devine le mapping débit/crédit', () => {
    expect(m).toMatchObject({ skipRows: 1, date: 0, label: [1], debit: 2, credit: 3, dateFormat: 'DD/MM/YYYY' })
    expect(m.amount).toBeUndefined()
  })
  it('parse et signale les erreurs', () => {
    const r = parseCsv(grid, m)
    expect(r.rows).toEqual([
      { date: '2026-11-02', amount: -450, label: 'CB BOULANGERIE' },
      { date: '2026-11-01', amount: 210000, label: 'VIR SALAIRE' },
    ])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.line).toBe(5)
  })
  it('colonne signée + devise', () => {
    const g = readCsvGrid('Date,Description,Amount,Currency\n2026-10-01,Coffee,-3.20,usd\n')
    const r = parseCsv(g, suggestMapping(g))
    expect(r.rows).toEqual([{ date: '2026-10-01', amount: -320, label: 'Coffee', currency: 'USD' }])
  })
  it('décode le Windows-1252', () => {
    const bytes = new Uint8Array([0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9]) // "Libellé" en CP1252
    expect(decodeFile(bytes.buffer)).toBe('Libellé')
  })
})

it('OFX SGML', () => {
  const ofx = `OFXHEADER:100\n<OFX><CURDEF>EUR<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102<TRNAMT>-45,10<FITID>1<NAME>CB AUCHAN<MEMO>CARTE X1234
</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261101120000<TRNAMT>1500.00<NAME>VIR SALAIRE</STMTTRN></OFX>`
  expect(detectKind('a.txt', ofx)).toBe('ofx')
  const r = parseOfx(ofx)
  expect(r.currency).toBe('EUR')
  expect(r.rows).toEqual([
    { date: '2026-11-02', amount: -4510, label: 'CB AUCHAN CARTE X1234' },
    { date: '2026-11-01', amount: 150000, label: 'VIR SALAIRE' },
  ])
})

it('QIF', () => {
  const r = parseQif(`!Type:Bank\nD25/10/2026\nT-1 234,50\nPLoyer\n^\nD26/10'26\nT20.00\nPRemb\nMami\n^\n`)
  expect(r.rows).toEqual([
    { date: '2026-10-25', amount: -123450, label: 'Loyer' },
    { date: '2026-10-26', amount: 2000, label: 'Remb ami' },
  ])
})

describe('dédoublonnage', () => {
  const a = { date: '2026-11-02', amount: -250, label: 'CB CAFE' }
  it('distingue deux opérations identiques le même jour', () => {
    const k = withImportKeys([a, a]).map((r) => r.importKey)
    expect(new Set(k).size).toBe(2)
  })
  it('un réimport qui chevauche donne les mêmes clés', () => {
    const first = withImportKeys([a, a, { ...a, date: '2026-11-03' }]).map((r) => r.importKey)
    const second = withImportKeys([a, a, { ...a, date: '2026-11-03' }, { ...a, date: '2026-11-04' }]).map((r) => r.importKey)
    expect(second.filter((k) => !first.includes(k))).toHaveLength(1)
  })
})

describe('virements internes', () => {
  const t = (id: string, accountId: string, date: string, amountEur: number) => ({ id, accountId, date, amountEur, transferGroupId: null })
  it('apparie les montants opposés entre comptes', () => {
    const pairs = findTransferPairs([
      t('a', 'courant', '2026-11-01', -50000), t('b', 'livret', '2026-11-02', 50000),
      t('c', 'courant', '2026-11-01', -50000), // même montant, pas de contrepartie
      t('d', 'courant', '2026-11-01', 50000), // même compte : ignoré
      t('e', 'revolut', '2026-11-10', 50000), // trop loin
    ])
    expect(pairs.map(([o, i]) => [o.id, i.id])).toEqual([['a', 'b']])
  })
  it('tolère 1 % d’écart de change', () => {
    expect(findTransferPairs([t('a', 'x', '2026-11-01', -10000), t('b', 'y', '2026-11-01', 9950)])).toHaveLength(1)
    expect(findTransferPairs([t('a', 'x', '2026-11-01', -10000), t('b', 'y', '2026-11-01', 9800)])).toHaveLength(0)
  })
})

describe('règles', () => {
  const rules = [
    { id: '1', pattern: 'CARREFOUR', isRegex: false, accountId: null, categoryId: 'courses', priority: 0 },
    { id: '2', pattern: 'CARREFOUR ENERGIES', isRegex: false, accountId: null, categoryId: 'carburant', priority: 0 },
    { id: '3', pattern: '^NETFLIX', isRegex: true, accountId: null, categoryId: 'abos', priority: 0 },
    { id: '4', pattern: '[', isRegex: true, accountId: null, categoryId: 'x', priority: 9 },
  ]
  it('motif le plus précis gagne, regex invalide ignorée', () => {
    expect(categorize(rules, 'CARREFOUR ENERGIES 75', 'a')).toBe('carburant')
    expect(categorize(rules, 'CARREFOUR MARKET', 'a')).toBe('courses')
    expect(categorize(rules, 'NETFLIX COM', 'a')).toBe('abos')
    expect(categorize(rules, 'INCONNU', 'a')).toBeNull()
  })
  it('apprend un motif', () => {
    expect(learnPattern('CARREFOUR MARKET 1234 PARIS')).toBe('CARREFOUR MARKET')
    expect(learnPattern('12 34')).toBeNull()
  })
})

it('ventilation', () => {
  expect(validateSplits(-1000, [{ categoryId: 'a', amount: -600 }, { categoryId: 'b', amount: -400 }])).toBeNull()
  expect(validateSplits(-1000, [{ categoryId: 'a', amount: -600 }, { categoryId: 'b', amount: -300 }])).toMatch(/somme/)
  expect(validateSplits(-1000, [{ categoryId: 'a', amount: -1100 }, { categoryId: 'b', amount: 100 }])).toMatch(/signe/)
})

it('chiffrement : aller-retour et mauvais mot de passe', async () => {
  const salt = newSalt()
  const sealed = await seal(await deriveKey('correct horse', salt), salt, new TextEncoder().encode('secret'))
  expect(new TextDecoder().decode(await open(await deriveKey('correct horse', salt), sealed))).toBe('secret')
  await expect(open(await deriveKey('mauvais', salt), sealed)).rejects.toThrow()
}, 20_000)

it('coût sur 12 mois : respecte la date de fin', async () => {
  const { annualCost } = await import('./recurring')
  const r = { freq: 'month' as const, interval: 1, startDate: '2026-09-01', endDate: '2027-01-01', amount: -5000 }
  expect(annualCost(r, '2026-11-03')).toBe(-10000) // déc. et janv. seulement
  expect(annualCost({ ...r, endDate: null }, '2026-11-03')).toBe(-60000)
  expect(annualCost({ ...r, freq: 'year', startDate: '2026-12-24', endDate: null }, '2026-11-03')).toBe(-5000)
})
