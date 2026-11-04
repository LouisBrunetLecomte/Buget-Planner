import { useMemo, useState } from 'react'
import { FileDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { addMonths, today } from '@/core/dates'
import { fiscalEstimate, FISCAL_LABEL, type FiscalKind } from '@/core/fiscal'
import * as x from '@/db/extrasRepo'
import { currentPeriod } from '@/db/budgetRepo'
import { useDb } from '@/app/store'
import { download } from '@/app/files'
import { Money, PageHeader, MonthPicker } from '@/app/ui'
import { usePeriodTitle } from '@/app/periods'

function Fiscal() {
  const { db, version } = useDb()
  const [year, setYear] = useState(new Date().getFullYear() - (new Date().getMonth() < 6 ? 1 : 0))
  const [children, setChildren] = useState(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totals = useMemo(() => x.fiscalTotals(db, year), [db, version, year])
  const est = fiscalEstimate(totals, children)
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Récapitulatif fiscal {year}</CardTitle>
        <CardDescription>D’après tes catégories « Dons », « Garde d’enfants » et « Emploi à domicile » (et leurs sous-catégories). Estimation indicative : vérifie sur impots.gouv.fr.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">Année <Input type="number" className="w-24" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} /></label>
          <label className="flex items-center gap-2">Enfants à charge <Input type="number" min={0} className="w-20" value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} /></label>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-1">Dépense</th><th className="p-1 text-right">Payé</th><th className="p-1 text-right">Avantage estimé</th></tr></thead>
          <tbody>{(Object.keys(FISCAL_LABEL) as FiscalKind[]).map((k) => (
            <tr key={k} className="border-t align-top"><td className="p-1">{FISCAL_LABEL[k]}<div className="text-xs text-muted-foreground">{est[k].note}</div></td>
              <td className="p-1 text-right"><Money cents={est[k].spent} colored={false} /></td><td className="p-1 text-right font-medium"><Money cents={est[k].benefit} colored={false} /></td></tr>
          ))}</tbody>
          <tfoot><tr className="border-t font-medium"><td className="p-1" colSpan={2}>Total estimé</td><td className="p-1 text-right"><Money cents={est.total} colored={false} /></td></tr></tfoot>
        </table>
      </CardContent>
    </Card>
  )
}

function Freelance() {
  const { db, version } = useDb()
  const y = new Date().getFullYear()
  const [from, setFrom] = useState(`${y}-01-01`), [to, setTo] = useState(`${y}-12-31`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => x.freelanceSummary(db, from, to), [db, version, from, to])
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Activité indépendante</CardTitle><CardDescription>Opérations marquées « Professionnel ». Montants HT calculés d’après le taux de TVA saisi.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Du <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /> au <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => download(x.accountingCsv(db, from, to), `export-comptable-${from}-${to}.csv`, 'text/csv')}><FileDown />Export comptable CSV</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
          {([['Recettes HT', s.recettesHt], ['Dépenses HT', s.depensesHt], ['Résultat', s.resultat], ['TVA collectée − déductible', s.tvaDue], ['Opérations', null]] as [string, number | null][]).map(([l, v]) => (
            <div key={l} className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{l}</div><div className="font-medium">{v === null ? s.txs.length : <Money cents={v} colored={false} />}</div></div>
          ))}
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">Notes de frais ({s.notes.length})</div>
          {!s.notes.length ? <p className="text-sm text-muted-foreground">Aucune sur la période.</p> : (
            <ul className="grid gap-1 text-sm">{s.notes.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="truncate">{t.date} · {t.label}</span><Money cents={t.amountEur} /></li>)}</ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function ReportsPage() {
  const { db } = useDb()
  const title = usePeriodTitle()
  const [month, setMonth] = useState(() => addMonths(currentPeriod(db, today()), -1)), [year, setYear] = useState(() => Number(today().slice(0, 4)))
  const run = async (f: () => Promise<void> | void) => { try { await f() } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } }
  return (
    <>
      <PageHeader title="Rapports et exports" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Rapports PDF</CardTitle><CardDescription>Générés sur ton appareil.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><MonthPicker label="Période du rapport" value={month} onChange={(m) => m && setMonth(m)} format={(m) => title(m)} />
              <Button size="sm" onClick={() => run(async () => { const r = (await import('./pdfReport')).monthlyReport(db, month); r.pdf.save(r.name) })}><FileDown />Rapport mensuel</Button></div>
            <div className="flex flex-wrap items-center gap-2"><Input type="number" aria-label="Année du bilan" className="w-24" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
              <Button size="sm" onClick={() => run(async () => { const r = (await import('./pdfReport')).annualReport(db, year); r.pdf.save(r.name) })}><FileDown />Bilan annuel</Button></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Exporter mes données</CardTitle><CardDescription>Pour un tableur, un autre logiciel ou ton droit à la portabilité (RGPD).</CardDescription></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Button size="sm" variant="outline" className="justify-start" onClick={() => run(() => download(x.transactionsCsv(db), `operations-${today()}.csv`, 'text/csv'))}><FileDown />Toutes les opérations (CSV, Excel)</Button>
            <Button size="sm" variant="outline" className="justify-start" onClick={() => run(() => { if (confirm('Ce fichier JSON n’est PAS chiffré : il contient toutes tes données en clair. Continuer ?')) download(x.exportAllJson(db), `budget-complet-${today()}.json`, 'application/json') })}><FileDown />Tout, en JSON (non chiffré)</Button>
            <p className="text-xs text-muted-foreground">La sauvegarde chiffrée, restaurable dans l’app, est dans <a className="underline" href="#/reglages">Paramètres</a>.</p>
          </CardContent>
        </Card>
        <Fiscal />
        {x.isFreelance(db) && <Freelance />}
      </div>
    </>
  )
}
