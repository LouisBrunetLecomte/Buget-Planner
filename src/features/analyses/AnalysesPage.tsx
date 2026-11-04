import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { axisEuro, axisProps, ChartTooltip, gridProps, LegendItem, TableView } from '@/components/charts'
import { today } from '@/core/dates'
import { formatMoney } from '@/core/money'
import * as an from '@/db/analyticsRepo'
import { currentPeriod } from '@/db/budgetRepo'
import { useDb } from '@/app/store'
import { Empty, MonthPicker, PageHeader, useCategories } from '@/app/ui'
import { usePeriodTitle } from '@/app/periods'

const e = (c: number) => c / 100 // les graphiques travaillent en euros

function BalanceForecast({ horizon }: { horizon: number }) {
  const title = usePeriodTitle(), ms = (m: string) => title(m, 'short')
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => an.balanceAndForecast(db, today(), horizon), [db, version, horizon])
  // mois en cours : réel à date + projection de fin de mois sur la même abscisse ;
  // la prévision part de la fin du dernier mois complet pour que les deux tracés se rejoignent
  const proj = new Map(d.proj.map((p) => [p.month, e(p.balance)]))
  const merged: { month: string; reel?: number; prevision?: number }[] = d.hist.map((h) => ({ month: h.month, reel: e(h.balance), prevision: proj.get(h.month) }))
  for (const p of d.proj) if (!merged.some((m) => m.month === p.month)) merged.push({ month: p.month, prevision: e(p.balance) })
  const firstProj = merged.findIndex((m) => m.prevision !== undefined)
  if (firstProj > 0) merged[firstProj - 1]!.prevision = merged[firstProj - 1]!.reel
  const neg = d.proj.find((p) => p.balance < 0)
  return (
    <Card>
      <CardHeader><CardTitle>Solde total et prévision</CardTitle><CardDescription>Fin de période (de paie à paie), tous comptes, depuis ton premier jour dans Budget. Prévision : ce qui reste à payer et recevoir, puis le budget prévu.</CardDescription></CardHeader>
      <CardContent>
        {neg && <p role="alert" className="mb-2 text-sm text-destructive">⚠ Découvert probable fin {ms(neg.month)} ({formatMoney(neg.balance)}), avant ta paie.</p>}
        <div className="mb-2 flex gap-4"><LegendItem color="var(--viz-1)" label="Réel" line /><LegendItem color="var(--viz-1)" label="Prévision" line dashed /></div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={merged} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" tickFormatter={ms} {...axisProps} />
              <YAxis tickFormatter={axisEuro} width={48} {...axisProps} />
              {neg && <ReferenceLine y={0} stroke="var(--viz-critical)" />}
              <Tooltip content={<ChartTooltip labelFormat={ms} />} />
              <Line dataKey="reel" name="Réel" stroke="var(--viz-1)" strokeWidth={2} dot={merged.filter((x) => x.reel !== undefined).length === 1 ? { r: 4, fill: 'var(--viz-1)', strokeWidth: 2, stroke: 'var(--card)' } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} connectNulls={false} />
              <Line dataKey="prevision" name="Prévision" stroke="var(--viz-1)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <TableView head={['Mois', 'Réel', 'Prévision']} rows={merged.map((x) => [ms(x.month), x.reel !== undefined ? formatMoney(Math.round(x.reel * 100)) : '—', x.prevision !== undefined ? formatMoney(Math.round(x.prevision * 100)) : '—'])} />
      </CardContent>
    </Card>
  )
}

function IncomeVsExpense() {
  const title = usePeriodTitle(), ms = (m: string) => title(m, 'short')
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => an.monthlyTotals(db, today()), [db, version])
  const data = rows.map((r) => ({ month: r.month, income: e(r.income), expense: e(r.expense) }))
  const empty = rows.every((r) => !r.income && !r.expense)
  return (
    <Card>
      <CardHeader><CardTitle>Revenus et dépenses</CardTitle><CardDescription>Par période, hors virements internes.</CardDescription></CardHeader>
      <CardContent>
        {empty ? <Empty>Rien encore de payé ou reçu. Ce graphique se remplit quand tu coches tes paiements (Budget, Accueil) ou importes un relevé.</Empty> : <>
        <div className="mb-2 flex gap-4"><LegendItem color="var(--viz-1)" label="Revenus" /><LegendItem color="var(--viz-2)" label="Dépenses" /></div>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" tickFormatter={ms} {...axisProps} />
              <YAxis tickFormatter={axisEuro} width={48} {...axisProps} />
              <Tooltip content={<ChartTooltip labelFormat={ms} />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
              <Bar dataKey="income" name="Revenus" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey="expense" name="Dépenses" fill="var(--viz-2)" radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <TableView head={['Période', 'Revenus', 'Dépenses', 'Épargne']} rows={rows.map((r) => [ms(r.month), formatMoney(r.income), formatMoney(r.expense), formatMoney(r.income - r.expense)])} />
        </>}
      </CardContent>
    </Card>
  )
}

/** Barres classées, une seule teinte : comparer les postes entre eux (plutôt qu'un camembert). */
function Breakdown({ month }: { month: string }) {
  const title = usePeriodTitle(), ms = (m: string) => title(m, 'short')
  const { db, version } = useDb()
  const { label } = useCategories()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => an.spendingByRoot(db, month), [db, version, month])
  const max = d.rows[0]?.amount ?? 0
  return (
    <Card>
      <CardHeader><CardTitle>Répartition des dépenses</CardTitle><CardDescription>{ms(month)} · total {formatMoney(d.total)}</CardDescription></CardHeader>
      <CardContent>
        {!d.rows.length ? <Empty>Aucune dépense ce mois-ci.</Empty> : (
          <ul className="grid gap-2">
            {d.rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-sm" title={`${label(r.id) ?? 'Non catégorisé'} : ${formatMoney(r.amount)}`}>
                <span className="truncate">{label(r.id) ?? 'Non catégorisé'}</span>
                <span className="h-3 rounded-r" style={{ width: `${(r.amount / max) * 100}%`, background: 'var(--viz-1)', minWidth: 2 }} aria-hidden />
                <span className="tabular-nums">{formatMoney(r.amount)} <span className="text-muted-foreground">{d.total ? Math.round((r.amount / d.total) * 100) : 0} %</span></span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

interface SNode { x: number; y: number; width: number; height: number; payload: { name: string; value: number; depth: number } }
function SankeyNode({ x, y, width, height, payload }: SNode) {
  const right = payload.depth === 0, hub = payload.depth === 1
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2} fill={payload.name === 'Épargne' ? 'var(--viz-1)' : hub ? 'var(--viz-muted)' : payload.depth === 0 ? 'var(--viz-1)' : 'var(--viz-2)'} />
      {!hub && height > 8 && (
        <text x={right ? x + width + 6 : x - 6} y={y + height / 2} dy="0.35em" textAnchor={right ? 'start' : 'end'} fontSize={11} fill="var(--foreground)">
          {payload.name} <tspan fill="var(--viz-muted)">{formatMoney(Math.round(payload.value * 100))}</tspan>
        </text>
      )}
    </g>
  )
}

function Flows({ month }: { month: string }) {
  const title = usePeriodTitle(), ms = (m: string) => title(m, 'short')
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => an.sankeyData(db, month), [db, version, month])
  const data = { nodes: d.nodes, links: d.links.map((l) => ({ ...l, value: e(l.value) })) }
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>D’où vient l’argent, où il va</CardTitle><CardDescription>{ms(month)} · {formatMoney(d.inTotal)} reçus, {formatMoney(d.outTotal)} dépensés</CardDescription></CardHeader>
      <CardContent>
        {!d.links.length ? <Empty>Pas de flux ce mois-ci.</Empty> : <>
          <div className="mb-2 flex gap-4"><LegendItem color="var(--viz-1)" label="Revenus et épargne" /><LegendItem color="var(--viz-2)" label="Dépenses" /></div>
          {/* les libellés des deux côtés demandent de la largeur : défilement horizontal sur mobile */}
          <div className="overflow-x-auto"><div className="h-80 min-w-[640px]">
            <ResponsiveContainer>
              <Sankey data={data} nodePadding={14} nodeWidth={8} margin={{ top: 8, bottom: 8, left: 150, right: 190 }} link={{ stroke: 'var(--viz-deemph)', strokeOpacity: 0.5 }}
                node={(p: SNode) => <SankeyNode {...p} />}>
                <Tooltip content={<ChartTooltip />} />
              </Sankey>
            </ResponsiveContainer>
          </div></div>
          <TableView head={['De', 'Vers', 'Montant']} rows={d.links.map((l) => [d.nodes[l.source]!.name, d.nodes[l.target]!.name, formatMoney(l.value)])} />
        </>}
      </CardContent>
    </Card>
  )
}

/** Emphase : l'année en cours en couleur, la précédente en gris de contexte. */
function YearOverYear({ year }: { year: number }) {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => an.yearOverYear(db, year), [db, version, year])
  const { db: db0 } = useDb()
  const cur = currentPeriod(db0, today())
  const data = rows.map((r) => ({ m: new Date(`${r.month}-15`).toLocaleDateString('fr-FR', { month: 'short' }), current: r.month <= cur ? e(r.current) : undefined, previous: e(r.previous) }))
  if (!rows.some((r) => r.previous)) return (
    <Card>
      <CardHeader><CardTitle>Dépenses {year} vs {year - 1}</CardTitle></CardHeader>
      <CardContent><Empty>La comparaison avec l’année précédente apparaîtra quand tu auras des dépenses sur {year - 1}.</Empty></CardContent>
    </Card>
  )
  return (
    <Card>
      <CardHeader><CardTitle>Dépenses {year} vs {year - 1}</CardTitle><CardDescription>Par mois.</CardDescription></CardHeader>
      <CardContent>
        <div className="mb-2 flex gap-4"><LegendItem color="var(--viz-2)" label={String(year)} line /><LegendItem color="var(--viz-deemph)" label={String(year - 1)} line /></div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="m" {...axisProps} />
              <YAxis tickFormatter={axisEuro} width={48} {...axisProps} />
              <Tooltip content={<ChartTooltip />} />
              <Line dataKey="previous" name={String(year - 1)} stroke="var(--viz-deemph)" strokeWidth={2} dot={false} />
              <Line dataKey="current" name={String(year)} stroke="var(--viz-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <TableView head={['Mois', String(year), String(year - 1)]} rows={rows.map((r) => [r.month, r.month <= cur ? formatMoney(r.current) : '—', formatMoney(r.previous)])} />
      </CardContent>
    </Card>
  )
}

export function AnalysesPage() {
  const { db } = useDb()
  const title = usePeriodTitle()
  const [month, setMonth] = useState(() => currentPeriod(db, today()))
  const [horizon, setHorizon] = useState(6)
  return (
    <>
      <PageHeader title="Analyses" />
      {/* filtres : une seule ligne, au-dessus de tout ce qu'ils pilotent */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="flex items-center gap-2">Période analysée <MonthPicker label="Période analysée" value={month} onChange={(m) => m && setMonth(m)} format={(m) => title(m)} /></span>
        <span className="flex items-center gap-1" role="group" aria-label="Horizon de prévision">Prévision
          {[3, 6, 12].map((h) => <Button key={h} size="sm" variant={horizon === h ? 'default' : 'outline'} aria-pressed={horizon === h} onClick={() => setHorizon(h)}>{h} mois</Button>)}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BalanceForecast horizon={horizon} />
        <IncomeVsExpense />
        <Flows month={month} />
        <Breakdown month={month} />
        <YearOverYear year={Number(title(month).slice(-4))} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Montants en euros ; comptes en devise valorisés au dernier taux connu.</p>
    </>
  )
}
