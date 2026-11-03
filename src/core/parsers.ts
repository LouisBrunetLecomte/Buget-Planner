import Papa from 'papaparse'
import { parseAmount } from './money'
import { type DateFormat, guessDateFormat, parseDate } from './dates'

export interface RawTx { date: string; amount: number; label: string; currency?: string }
export interface ParseResult { rows: RawTx[]; errors: { line: number; reason: string }[] }

/** Les banques françaises exportent souvent en Windows-1252 : on tente UTF-8 strict, sinon CP1252. */
export function decodeFile(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '') }
  catch { return new TextDecoder('windows-1252').decode(buf) }
}

// ---------- CSV ----------
export interface CsvMapping {
  skipRows: number          // lignes à ignorer avant l'en-tête
  hasHeader: boolean
  date: number
  dateFormat: DateFormat
  label: number[]           // plusieurs colonnes concaténées (libellé + complément)
  amount?: number           // colonne signée…
  debit?: number            // …ou débit/crédit séparés
  credit?: number
  currency?: number
}

export function readCsvGrid(text: string): string[][] {
  const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' })
  return res.data.map((r) => r.map((c) => (c ?? '').trim()))
}

const find = (headers: string[], re: RegExp) => { const i = headers.findIndex((h) => re.test(h)); return i < 0 ? undefined : i }

/** Propose un mapping à partir des en-têtes et des premières lignes. L'utilisateur le corrige ensuite. */
export function suggestMapping(grid: string[][]): CsvMapping {
  // l'en-tête est la première ligne contenant un mot "date"
  const skipRows = Math.max(0, grid.findIndex((r) => r.some((c) => /date/i.test(c))))
  const headers = (grid[skipRows] ?? []).map((h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
  const body = grid.slice(skipRows + 1, skipRows + 30)
  const date = find(headers, /date/) ?? 0
  const debit = find(headers, /debit/)
  const credit = find(headers, /credit/)
  const amount = debit !== undefined && credit !== undefined ? undefined : (find(headers, /montant|amount|somme|valeur/) ?? 1)
  const labelIdx = [find(headers, /libelle|description|label|intitule|operation|payee|beneficiaire/), find(headers, /complement|detail|memo/)]
    .filter((i): i is number => i !== undefined)
  return {
    skipRows, hasHeader: true, date,
    dateFormat: guessDateFormat(body.map((r) => r[date] ?? '')) ?? 'DD/MM/YYYY',
    label: labelIdx.length ? labelIdx : [2],
    amount, debit: amount === undefined ? debit : undefined, credit: amount === undefined ? credit : undefined,
    currency: find(headers, /devise|currency/),
  }
}

export function parseCsv(grid: string[][], m: CsvMapping): ParseResult {
  const rows: RawTx[] = [], errors: ParseResult['errors'] = []
  const start = m.skipRows + (m.hasHeader ? 1 : 0)
  grid.slice(start).forEach((r, i) => {
    const line = start + i + 1
    const date = parseDate(r[m.date] ?? '', m.dateFormat)
    let amount: number | null
    if (m.amount !== undefined) amount = parseAmount(r[m.amount] ?? '')
    else {
      const d = parseAmount(r[m.debit ?? -1] ?? ''), c = parseAmount(r[m.credit ?? -1] ?? '')
      amount = d === null && c === null ? null : (c ?? 0) - Math.abs(d ?? 0)
    }
    const label = m.label.map((i) => r[i] ?? '').filter(Boolean).join(' ').trim()
    if (!date) return errors.push({ line, reason: `date illisible « ${r[m.date] ?? ''} »` })
    if (amount === null) return errors.push({ line, reason: 'montant illisible' })
    const currency = m.currency !== undefined ? r[m.currency]?.toUpperCase() : undefined
    rows.push({ date, amount, label: label || '(sans libellé)', ...(currency && /^[A-Z]{3}$/.test(currency) ? { currency } : {}) })
  })
  return { rows, errors }
}

// ---------- OFX (SGML v1 et XML v2) ----------
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'))?.[1]?.trim()

export function parseOfx(text: string): ParseResult & { currency?: string } {
  const rows: RawTx[] = [], errors: ParseResult['errors'] = []
  const currency = tag(text, 'CURDEF')
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, 'DTPOSTED') ?? '', 'YYYYMMDD')
    const amount = parseAmount(tag(b, 'TRNAMT') ?? '')
    const label = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' ')
    if (!date || amount === null) return errors.push({ line: i + 1, reason: 'opération OFX illisible' })
    rows.push({ date, amount, label: label || '(sans libellé)' })
  })
  return { rows, errors, ...(currency ? { currency } : {}) }
}

// ---------- QIF ----------
export function parseQif(text: string): ParseResult {
  const recs: Record<string, string>[] = []
  let cur: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('!')) continue
    if (line === '^') { if (Object.keys(cur).length) recs.push(cur); cur = {}; continue }
    const k = line[0]!, v = line.slice(1).trim()
    cur[k] = cur[k] ? `${cur[k]} ${v}` : v
  }
  const dates = recs.map((r) => (r.D ?? '').replace(/'/g, '/').replace(/ /g, ''))
  const fmt = guessDateFormat(dates) ?? 'DD/MM/YYYY'
  const rows: RawTx[] = [], errors: ParseResult['errors'] = []
  recs.forEach((r, i) => {
    const date = parseDate(dates[i]!, fmt), amount = parseAmount(r.T ?? r.U ?? '')
    if (!date || amount === null) return errors.push({ line: i + 1, reason: 'opération QIF illisible' })
    rows.push({ date, amount, label: [r.P, r.M].filter(Boolean).join(' ') || '(sans libellé)' })
  })
  return { rows, errors }
}

export type FileKind = 'csv' | 'ofx' | 'qif'
export function detectKind(name: string, text: string): FileKind {
  if (/\.(ofx|qfx)$/i.test(name) || /<OFX>/i.test(text)) return 'ofx'
  if (/\.qif$/i.test(name) || /^!Type:/im.test(text)) return 'qif'
  return 'csv'
}
