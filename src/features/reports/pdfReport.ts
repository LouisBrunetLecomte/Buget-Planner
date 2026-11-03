import { jsPDF } from 'jspdf'
import type { Db } from '@/db/client'
import { getBudget, periodBounds } from '@/db/budgetRepo'
import { spendingByRoot } from '@/db/analyticsRepo'
import { netWorth } from '@/db/planningRepo'
import { listCategories } from '@/db/repo'
import { formatRaw } from '@/core/money'
import { savingsRate } from '@/core/analytics'
import { today } from '@/core/dates'

// Les polices standard du PDF ne connaissent pas les espaces fines insécables du format français
const m = (c: number) => formatRaw(c).replace(/[  ]/g, ' ')
const monthName = (mo: string) => new Date(`${mo}-15`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

class Doc {
  pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  y = 20
  title(t: string, sub: string) {
    this.pdf.setFont('helvetica', 'bold').setFontSize(18).text(t, 15, this.y); this.y += 7
    this.pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110).text(sub, 15, this.y).setTextColor(0); this.y += 10
  }
  h(t: string) { this.space(14); this.pdf.setFont('helvetica', 'bold').setFontSize(12).text(t, 15, this.y); this.y += 6; this.pdf.setFont('helvetica', 'normal').setFontSize(10) }
  kpis(items: [string, string][]) {
    const w = 180 / items.length
    items.forEach(([l, v], i) => { this.pdf.setFontSize(9).setTextColor(110).text(l, 15 + i * w, this.y).setTextColor(0).setFontSize(13).text(v, 15 + i * w, this.y + 6) })
    this.pdf.setFontSize(10); this.y += 14
  }
  table(head: string[], rows: string[][], widths: number[]) {
    const row = (cells: string[], bold = false) => {
      this.space(6)
      this.pdf.setFont('helvetica', bold ? 'bold' : 'normal')
      let x = 15
      cells.forEach((c, i) => { const right = i > 0; this.pdf.text(this.pdf.splitTextToSize(c, widths[i]! - 2)[0] ?? '', right ? x + widths[i]! - 1 : x, this.y, { align: right ? 'right' : 'left' }); x += widths[i]! })
      this.y += 5.5
    }
    row(head, true); this.pdf.setDrawColor(200).line(15, this.y - 4, 195, this.y - 4)
    rows.forEach((r) => row(r))
    this.y += 3
  }
  bars(rows: [string, number][], total: number) {
    const max = Math.max(...rows.map((r) => r[1]), 1)
    for (const [l, v] of rows) {
      this.space(6)
      this.pdf.text(l, 15, this.y)
      this.pdf.setFillColor(42, 120, 214).rect(70, this.y - 3, Math.max(0.5, (v / max) * 90), 3.2, 'F')
      this.pdf.text(`${m(v)}  ${total ? Math.round((v / total) * 100) : 0} %`, 195, this.y, { align: 'right' })
      this.y += 5.5
    }
  }
  space(h: number) { if (this.y + h > 285) { this.pdf.addPage(); this.y = 20 } }
  done(name: string) {
    const n = this.pdf.getNumberOfPages()
    for (let i = 1; i <= n; i++) this.pdf.setPage(i).setFontSize(8).setTextColor(140).text(`Généré le ${new Date().toLocaleDateString('fr-FR')} · page ${i}/${n}`, 195, 292, { align: 'right' })
    return { pdf: this.pdf, name }
  }
}

export function monthlyReport(db: Db, month: string) {
  const b = getBudget(db, month, month)[0]!, sp = spendingByRoot(db, month), cats = listCategories(db)
  const name = (id: string) => cats.find((c) => c.id === id)?.name ?? 'Non catégorisé'
  const d = new Doc()
  const pb = periodBounds(db, month)
  d.title(`Rapport mensuel : ${pb.label}`, pb.day > 1 ? `Du ${pb.start} au ${pb.end} (de paie à paie), montants en euros, virements internes exclus` : 'Budget personnel, montants en euros, virements internes exclus')
  d.kpis([['Revenus', m(b.actualIncome)], ['Dépenses', m(b.actualExpense)], ['Épargne', m(b.actualIncome - b.actualExpense)], ['Taux d’épargne', `${Math.round(savingsRate([b]) * 100)} %`]])
  d.h('Dépenses par catégorie')
  d.bars(sp.rows.slice(0, 15).map((r) => [name(r.id), r.amount]), sp.total)
  if (b.rows.length) {
    d.h('Budget : prévu et réel')
    d.table(['Catégorie', 'Prévu', 'Réel', 'Reste'], b.rows.map((r) => [name(r.categoryId) + (r.exception ? ' (exception)' : ''), m(r.planned + r.carry), m(r.actual), m(r.remaining)]), [80, 33, 33, 34])
  }
  return d.done(`rapport-${month}.pdf`)
}

export function annualReport(db: Db, year: number) {
  const months = getBudget(db, `${year}-01`, `${year}-12`), cats = listCategories(db)
  const inc = months.reduce((s, x) => s + x.actualIncome, 0), exp = months.reduce((s, x) => s + x.actualExpense, 0)
  const byCat = new Map<string, number>()
  for (let k = 1; k <= 12; k++) for (const r of spendingByRoot(db, `${year}-${String(k).padStart(2, '0')}`).rows) byCat.set(r.id, (byCat.get(r.id) ?? 0) + r.amount)
  const d = new Doc()
  d.title(`Bilan annuel ${year}`, 'Budget personnel, montants en euros, virements internes exclus')
  d.kpis([['Revenus', m(inc)], ['Dépenses', m(exp)], ['Épargne', m(inc - exp)], ['Patrimoine net', m(netWorth(db, today()).net)]])
  d.h('Mois par mois')
  d.table(['Mois', 'Revenus', 'Dépenses', 'Solde'], months.map((x) => [monthName(x.month), m(x.actualIncome), m(x.actualExpense), m(x.actualIncome - x.actualExpense)]), [60, 40, 40, 40])
  d.h('Dépenses de l’année par catégorie')
  d.bars([...byCat].sort((a, b) => b[1] - a[1]).map(([id, v]) => [cats.find((c) => c.id === id)?.name ?? 'Non catégorisé', v]), exp)
  return d.done(`bilan-${year}.pdf`)
}
