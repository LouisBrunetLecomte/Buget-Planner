import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { axisEuro, axisProps, ChartTooltip, gridProps, LegendItem, monthShort, TableView } from '@/components/charts'
import { addMonths, monthOf, today } from '@/core/dates'
import { creditPayment, type Change } from '@/core/planning'
import { formatMoney, parseAmount } from '@/core/money'
import * as p from '@/db/planningRepo'
import { mutate, useDb } from '@/app/store'
import { attempt, Empty, Money, PageHeader } from '@/app/ui'
import { cn } from '@/lib/utils'

// 3 séries maximum (base + 2 scénarios) : au-delà, les couleurs ne restent pas distinguables pour tous
const SERIES = ['var(--viz-deemph)', 'var(--viz-1)', 'var(--viz-2)']

function describe(c: Change): string {
  if (c.type === 'mensuel') return `${c.label} : ${formatMoney(c.amount)}/mois de ${monthShort(c.from)}${c.to ? ` à ${monthShort(c.to)}` : ''}`
  if (c.type === 'ponctuel') return `${c.label} : ${formatMoney(c.amount)} en ${monthShort(c.month)}`
  return `${c.label} : ${formatMoney(c.principal)} à ${c.rate} % sur ${c.months} mois (${formatMoney(-creditPayment(c))}/mois) dès ${monthShort(c.from)}`
}

function ChangeForm({ onAdd }: { onAdd: (c: Change) => void }) {
  const cur = monthOf(today())
  const [type, setType] = useState<Change['type']>('mensuel')
  const [f, setF] = useState({ label: '', amount: '', from: addMonths(cur, 1), to: '', rate: '', months: '' })
  const PRESETS: [string, Partial<typeof f> & { type: Change['type'] }][] = [
    ['Perte de revenu', { type: 'mensuel', label: 'Perte de revenu', amount: '-1000' }],
    ['Nouveau crédit', { type: 'credit', label: 'Nouveau crédit', amount: '15000', rate: '4', months: '60' }],
    ['Déménagement', { type: 'mensuel', label: 'Nouveau loyer (différence)', amount: '-250' }],
    ['Achat important', { type: 'ponctuel', label: 'Achat', amount: '-3000' }],
  ]
  function submit() {
    const amt = parseAmount(f.amount)
    if (!f.label.trim() || amt === null || amt === 0) return toast.error('Libellé et montant requis')
    if (type === 'mensuel') onAdd({ type, label: f.label.trim(), amount: amt, from: f.from, to: f.to || null })
    else if (type === 'ponctuel') onAdd({ type, label: f.label.trim(), amount: amt, month: f.from })
    else {
      const rate = Number(f.rate.replace(',', '.')), months = Number(f.months)
      if (!(rate >= 0 && months > 0)) return toast.error('Taux et durée requis')
      onAdd({ type, label: f.label.trim(), principal: Math.abs(amt), rate, months, from: f.from })
    }
    setF({ ...f, label: '', amount: '' })
  }
  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap gap-1">{PRESETS.map(([l, v]) => <Button key={l} type="button" size="xs" variant="outline" onClick={() => { setType(v.type); setF({ ...f, ...v }) }}>{l}</Button>)}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[9rem_1fr_7rem_8rem_8rem]">
        <Select value={type} onValueChange={(v) => setType(v as Change['type'])}>
          <SelectTrigger aria-label="Type de changement" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="mensuel">Chaque mois</SelectItem><SelectItem value="ponctuel">Ponctuel</SelectItem><SelectItem value="credit">Crédit</SelectItem></SelectContent>
        </Select>
        <Input aria-label="Libellé" placeholder="Libellé" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <Input aria-label={type === 'credit' ? 'Montant emprunté' : 'Montant (négatif = dépense)'} placeholder={type === 'credit' ? 'Emprunté €' : '± €'} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input aria-label={type === 'ponctuel' ? 'Mois' : 'À partir de'} type="month" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        {type === 'mensuel' && <Input aria-label="Jusqu’à (optionnel)" type="month" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}
        {type === 'credit' && <div className="flex gap-1"><Input aria-label="Taux %" placeholder="%" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /><Input aria-label="Durée en mois" placeholder="mois" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></div>}
      </div>
      <Button type="button" size="sm" variant="secondary" className="justify-self-start" onClick={submit}>Ajouter ce changement</Button>
    </div>
  )
}

function Scenarios() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => p.listScenarios(db), [db, version])
  const [selected, setSelected] = useState<string[]>([])
  const [horizon, setHorizon] = useState(12)
  const [draft, setDraft] = useState<{ id?: string; name: string; changes: Change[] } | null>(null)
  const shown = list.filter((s) => selected.includes(s.id)).slice(0, 2)
  const series = useMemo(() => {
    const t = today()
    return [{ name: 'Sans changement', data: p.runScenario(db, t, horizon, []) }, ...shown.map((s) => ({ name: s.name, data: p.runScenario(db, t, horizon, s.changes) }))]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, horizon, shown.map((s) => s.id).join()])
  const data = series[0]!.data.map((pt, i) => Object.fromEntries([['month', pt.month], ...series.map((s, k) => [`s${k}`, s.data[i]!.balance / 100])]))
  const minOf = (s: (typeof series)[number]) => s.data.reduce((m, x) => (x.balance < m.balance ? x : m), s.data[0]!)

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <div className="grid content-start gap-2">
        <Button onClick={() => setDraft({ name: '', changes: [] })}>Nouveau scénario</Button>
        {!list.length && <Empty>Crée un scénario : perte de revenu, nouveau crédit, déménagement, gros achat…</Empty>}
        {list.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <Checkbox aria-label={`Comparer ${s.name}`} checked={selected.includes(s.id)} disabled={!selected.includes(s.id) && selected.length >= 2}
              onCheckedChange={(v) => setSelected(v === true ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
            <button type="button" className="flex-1 truncate text-left" onClick={() => setDraft({ id: s.id, name: s.name, changes: s.changes })}>{s.name}</button>
          </div>
        ))}
        {list.length > 0 && <p className="text-xs text-muted-foreground">Coche jusqu’à 2 scénarios à comparer.</p>}
      </div>
      <div className="grid gap-4">
        {draft && (
          <Card><CardHeader><CardTitle>{draft.id ? 'Modifier le scénario' : 'Nouveau scénario'}</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <Input aria-label="Nom du scénario" placeholder="Nom du scénario" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <ul className="grid gap-1 text-sm">{draft.changes.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1">{describe(c)}<Button size="xs" variant="ghost" aria-label="Retirer" onClick={() => setDraft({ ...draft, changes: draft.changes.filter((_, j) => j !== i) })}>×</Button></li>
              ))}</ul>
              <ChangeForm onAdd={(c) => setDraft({ ...draft, changes: [...draft.changes, c] })} />
              <div className="flex gap-2">
                <Button onClick={() => {
                  if (!draft.name.trim() || !draft.changes.length) return toast.error('Donne un nom et au moins un changement')
                  if (attempt(() => mutate((d) => p.saveScenario(d, { ...draft, name: draft.name.trim() })), 'Scénario enregistré')) setDraft(null)
                }}>Enregistrer</Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>Annuler</Button>
                {draft.id && <Button variant="destructive" className="ml-auto" onClick={() => { mutate((d) => p.deleteScenario(d, draft.id!)); setSelected(selected.filter((x) => x !== draft.id)); setDraft(null) }}>Supprimer</Button>}
              </div>
            </CardContent></Card>
        )}
        <Card>
          <CardHeader><CardTitle>Solde des comptes courants, fin de mois</CardTitle>
            <CardDescription>Base : budget prévu (ou moyenne des 3 derniers mois). Horizon
              {[12, 24].map((h) => <Button key={h} size="xs" className="ml-1" variant={horizon === h ? 'default' : 'outline'} aria-pressed={horizon === h} onClick={() => setHorizon(h)}>{h} mois</Button>)}</CardDescription></CardHeader>
          <CardContent>
            <div className="mb-2 flex flex-wrap gap-4">{series.map((s, k) => <LegendItem key={s.name} color={SERIES[k]!} label={s.name} line />)}</div>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="month" tickFormatter={monthShort} {...axisProps} />
                  <YAxis tickFormatter={axisEuro} width={48} {...axisProps} />
                  <ReferenceLine y={0} stroke="var(--viz-axis)" />
                  <Tooltip content={<ChartTooltip labelFormat={monthShort} />} />
                  {series.map((s, k) => <Line key={s.name} dataKey={`s${k}`} name={s.name} stroke={SERIES[k]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 grid gap-1 text-sm">
              {series.map((s) => { const m = minOf(s), end = s.data.at(-1)!; return (
                <li key={s.name}><span className="font-medium">{s.name}</span> : fin à <Money cents={end.balance} colored={false} />, point bas <Money cents={m.balance} colored={false} className={cn(m.balance < 0 && 'text-destructive font-medium')} /> en {monthShort(m.month)}{m.balance < 0 && ' ⚠ découvert'}</li>
              ) })}
            </ul>
            <TableView head={['Mois', ...series.map((s) => s.name)]} rows={series[0]!.data.map((pt, i) => [monthShort(pt.month), ...series.map((s) => formatMoney(s.data[i]!.balance))])} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function DayByDay() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => p.financialCalendar(db, today(), 60), [db, version])
  const firstNeg = c.days.find((d) => d.balance < 0)
  const data = c.days.map((d) => ({ date: d.date, solde: d.balance / 100 }))
  const fmt = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <Card>
      <CardHeader><CardTitle>Calendrier financier : 60 prochains jours</CardTitle>
        <CardDescription>Comptes courants. Échéances datées + dépenses courantes estimées à {formatMoney(c.dailyVariable)} par jour (ton budget pas encore dépensé, réparti jusqu’à la prochaine paie ; à défaut, ta moyenne passée).</CardDescription></CardHeader>
      <CardContent>
        {firstNeg && <p role="alert" className="mb-2 text-sm text-destructive">⚠ Solde négatif probable à partir du {fmt(firstNeg.date)}.</p>}
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" tickFormatter={fmt} {...axisProps} minTickGap={24} />
              <YAxis tickFormatter={axisEuro} width={48} {...axisProps} />
              <ReferenceLine y={0} stroke="var(--viz-axis)" />
              <Tooltip content={<ChartTooltip labelFormat={fmt} />} />
              <Line dataKey="solde" name="Solde prévu" stroke="var(--viz-1)" strokeWidth={2} dot={false} type="stepAfter" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ol className="mt-3 grid gap-1 text-sm">
          {c.days.filter((d) => d.events.length).map((d) => (
            <li key={d.date} className="grid grid-cols-[5rem_1fr_auto] gap-2 border-t pt-1">
              <span className="text-muted-foreground">{fmt(d.date)}</span>
              <span>{d.events.map((e) => `${e.label} ${formatMoney(e.amount)}`).join(' · ')}</span>
              <Money cents={d.balance} colored={false} className={cn(d.balance < 0 && 'text-destructive')} />
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

export function SimulationsPage() {
  return (
    <>
      <PageHeader title="Prévisions et simulations" />
      <Tabs defaultValue="sc">
        <TabsList className="mb-3"><TabsTrigger value="sc">Et si… ?</TabsTrigger><TabsTrigger value="cal">Jour par jour</TabsTrigger></TabsList>
        <TabsContent value="sc"><Scenarios /></TabsContent>
        <TabsContent value="cal"><DayByDay /></TabsContent>
      </Tabs>
    </>
  )
}
