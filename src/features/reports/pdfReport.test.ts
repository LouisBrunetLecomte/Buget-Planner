import { expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { openDb } from '@/db/client'
import { seedDemo } from '@/db/seed'
import { annualReport, monthlyReport } from './pdfReport'

async function text(bytes: ArrayBuffer) {
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise
  let t = ''
  for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n'
  return t
}

it('rapports PDF : accents, euros, sections', async () => {
  const { db } = openDb(await initSqlJs())
  seedDemo(db, new Date('2026-11-03'))
  const m = await text(monthlyReport(db, '2026-10').pdf.output('arraybuffer'))
  expect(m).toContain('Rapport mensuel : octobre 2026')
  expect(m).toContain('Dépenses par catégorie')
  expect(m).toMatch(/2 650,00 €/)
  const a = await text(annualReport(db, 2026).pdf.output('arraybuffer'))
  expect(a).toContain('Bilan annuel 2026')
  expect(a).toContain('Patrimoine net')
}, 30_000)
