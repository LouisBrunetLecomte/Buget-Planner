import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { addMonths, daysInMonth, monthsBetween, today } from '@/core/dates'
import { projectBalances, type MonthBudget, type Row } from '@/core/budget'
import { formatMoney } from '@/core/money'
import * as b from '@/db/budgetRepo'
import { mutate, useDb } from '@/app/store'
import { attempt, DaySelect, Empty, Money, PageHeader, useCategories } from '@/app/ui'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseAmount } from '@/core/money'
import { createCategory } from '@/db/repo'
import { cn } from '@/lib/utils'
import { BudgetDialog, monthName } from './BudgetDialog'

function Bar({ value, max, income }: { value: number; max: number; income?: boolean }) {
  const pct = max > 0 ? value / max : value > 0 ? 1 : 0
  const color = income ? 'bg-emerald-500' : pct > 1 ? 'bg-red-500' : pct >= 0.8 ? 'bg-amber-500' : 'bg-primary'
  return (
    <div className="h-1.5 w-full rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Consommé">
      <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
    </div>
  )
}


/** Une ligne : reçu, payé, et ce qui n'a pas encore de rôle dans le budget. */
function Summary({ m }: { m: MonthBudget }) {
  return (
    <p className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
      <span>Reçu <strong className="font-medium text-foreground tabular-nums">{formatMoney(m.actualIncome)}</strong> / {formatMoney(m.plannedIncome)}</span>
      <span>Payé <strong className="font-medium text-foreground tabular-nums">{formatMoney(m.actualExpense)}</strong> / {formatMoney(m.plannedExpense)}</span>
      {m.plannedIncome > 0 && m.toAssign !== 0 && (
        <span className={cn(m.toAssign < 0 && 'text-destructive')}>{m.toAssign > 0 ? `${formatMoney(m.toAssign)} de revenus sans affectation` : `Budget supérieur aux revenus de ${formatMoney(-m.toAssign)}`}</span>
      )}
    </p>
  )
}

type TickStatus = Map<string, { paid: boolean; ticked: boolean; before: boolean }>
const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Case « payé / reçu » : cocher enregistre l'opération réelle, décocher l'efface. Tout l'app suit. */
function Tick({ checked, disabled, label, title, onChange }: { checked: boolean; disabled?: boolean; label: string; title?: string; onChange: (v: boolean) => void }) {
  return (
    <label className={cn('flex items-center gap-2 py-0.5 text-sm', checked && 'text-muted-foreground')} title={title}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} aria-label={label} />
      <span className={cn(checked && 'line-through decoration-1')}>{label}</span>
    </label>
  )
}

function RowLine({ r, onEdit, month, status, lineTicked, future }: { r: Row; onEdit: () => void; month: string; status: TickStatus; lineTicked: boolean; future: boolean }) {
  const { label } = useCategories()
  const avail = r.planned + r.carry
  const verb = r.kind === 'revenu' ? 'reçu' : 'payé'
  const tickItem = (id: string, date: string, v: boolean, name: string) =>
    attempt(() => mutate((d) => (v ? b.tickOccurrence(d, id, date, today()) : b.untick(d, b.occurrenceRef(id, date))), { label: `${name} ${v ? verb : `non ${verb}`}` }))
  const tickLine = (v: boolean) =>
    attempt(() => mutate((d) => (v ? b.tickLine(d, r.categoryId, month, avail, today()) : b.untick(d, b.lineRef(r.categoryId, month))), { label: `${label(r.categoryId)} ${v ? verb : `non ${verb}`}` }))
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t px-3 py-2 first:border-t-0 md:grid-cols-[1fr_9rem_9rem_9rem]">
      <div>
        <button type="button" className="text-left" onClick={onEdit}>
          <span className="font-medium">{label(r.categoryId)}</span>
          {r.exception && <Badge variant="secondary" className="ml-2">Exception{r.exception.reason ? ` : ${r.exception.reason}` : ''}</Badge>}
          {r.carry !== 0 && <span className="ml-2 text-xs text-muted-foreground">report {formatMoney(r.carry)}</span>}
        </button>
        {r.items.length > 0 ? (
          <div className="mt-0.5">
            {r.items.map((i) => {
              const st = status.get(`${i.id}|${i.date}`)
              const byBank = !!st?.paid && !st.ticked
              return <Tick key={i.id + i.date} checked={!!st?.paid} disabled={byBank || (future && !st?.paid)} title={st?.before ? 'Avant ton premier jour dans Buget : déjà compris dans ton solde' : byBank ? 'Retrouvé dans tes opérations importées' : `Coche quand c’est ${verb}`}
                label={`${i.name} ${formatMoney(Math.abs(i.amount))} le ${fmtDay(i.date)}`} onChange={(v) => tickItem(i.id, i.date, v, i.name)} />
            })}
          </div>
        ) : avail > 0 && (
          <Tick checked={lineTicked} disabled={future} label={`${verb[0]!.toUpperCase()}${verb.slice(1)} (${formatMoney(avail)})`} title={future ? 'Période à venir : tu pourras cocher le moment venu' : `Coche quand c’est ${verb} : le montant prévu est enregistré`} onChange={tickLine} />
        )}
        {r.overridden !== null && (
          <button type="button" className="block text-left text-xs text-muted-foreground underline" onClick={() => { if (confirm(`Supprimer l’ancien montant saisi (${formatMoney(r.overridden!)}) ? Tes échéances datées le remplacent déjà.`)) mutate((d) => b.removeLines(d, r.categoryId), { label: 'Ancien montant supprimé' }) }}>
            Ancien montant saisi ({formatMoney(r.overridden)}) remplacé par tes échéances : le supprimer
          </button>
        )}
      </div>
      <span className="text-right text-sm tabular-nums md:order-none">
        <span className="md:hidden"><Money cents={r.actual} colored={false} /> / </span>
        <button type="button" className="hover:underline" onClick={onEdit} aria-label={`Modifier le prévu de ${label(r.categoryId)}`}>{formatMoney(avail)}</button>
        {r.exception && (
          <Button size="icon-xs" variant="ghost" className="ml-1" aria-label="Annuler l’exception" title={`Revenir au modèle (${formatMoney(r.base ?? 0)})`}
            onClick={() => { mutate((d) => b.removeException(d, r.exception!.id)); toast.success(`Exception annulée pour ${monthName(month)}`) }}><X /></Button>
        )}
      </span>
      <span className="hidden text-right text-sm tabular-nums md:block"><Money cents={r.actual} colored={false} /></span>
      <span className={cn('col-span-2 text-right text-sm tabular-nums md:col-span-1', r.kind === 'depense' && r.remaining < 0 && 'text-destructive font-medium')}>
        <Bar value={r.actual} max={avail} income={r.kind === 'revenu'} />
        <span className="text-xs">{r.kind === 'revenu' ? (r.toCome > 0 ? `${formatMoney(r.toCome)} attendus` : r.actual ? 'reçu' : '—') : r.remaining >= 0 ? `reste ${formatMoney(r.remaining)}` : `dépassé de ${formatMoney(-r.remaining)}`}</span>
      </span>
    </li>
  )
}

/** Nouvelle ligne de budget avec son propre libellé (crée la catégorie si elle n'existe pas). */
function NewLine({ month }: { month: string }) {
  const { all } = useCategories()
  const { db } = useDb()
  const [label, setLabel] = useState(''), [kind, setKind] = useState<'depense' | 'revenu'>('depense'), [amount, setAmount] = useState(''), [from, setFrom] = useState(month)
  const [day, setDay] = useState<number | null>(null)
  function add() {
    const name = label.trim(), cents = parseAmount(amount)
    if (!name) return toast.error('Donne un libellé')
    if (cents === null || cents <= 0) return toast.error('Montant invalide')
    const ok = attempt(() => mutate((d) => {
      const existing = all.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.kind === kind)
      const id = existing?.id ?? createCategory(d, { name, kind }).id
      // avec une date : c'est une échéance (calendrier, reste à vivre, alertes la voient) ; sans : un simple montant mensuel
      if (day) b.createRecurring(d, { name, kind: kind === 'revenu' ? 'revenu' : 'charge', amount: kind === 'revenu' ? cents : -cents, freq: 'month', interval: 1,
        startDate: `${from}-${String(Math.min(day, daysInMonth(from))).padStart(2, '0')}`, dayOfMonth: day, categoryId: id })
      else b.setBudget(d, id, from, cents, 'from')
      return true
    }, { label: `Budget : ${name}` }), `« ${name} » ajouté au budget à partir de la période ${b.periodBounds(db, from).label}`)
    if (ok) { setLabel(''); setAmount(''); setDay(null) }
  }
  return (
    <form aria-label="Nouvelle ligne de budget" className="grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-[1fr_8rem_7rem_11rem_auto_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); add() }}>
      <div className="grid gap-1"><Label htmlFor="nl-l">Nouveau libellé</Label><Input id="nl-l" placeholder="ex : Cadeaux, Coiffeur, Prime…" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
      <div className="grid gap-1"><Label htmlFor="nl-k">Type</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger id="nl-k" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="depense">Dépense</SelectItem><SelectItem value="revenu">Revenu</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="grid gap-1"><Label htmlFor="nl-a">Montant (€)</Label><Input id="nl-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="grid gap-1"><Label htmlFor="nl-d">Date précise</Label><DaySelect id="nl-d" value={day} onChange={setDay} allowNone /></div>
      <div className="grid gap-1"><Label htmlFor="nl-f">Toutes les périodes depuis</Label><Input id="nl-f" type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className="text-[11px] text-muted-foreground">{b.periodBounds(db, from).label}</span></div>
      <Button type="submit">Ajouter</Button>
    </form>
  )
}

function MonthView({ month }: { month: string }) {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const m = useMemo(() => b.getBudget(db, month, month)[0]!, [db, version, month])
  // état des cases : échéances payées/reçues (cochées ou retrouvées dans les opérations) et lignes cochées
  const ticks = useMemo(() => {
    const { start, end } = b.periodBounds(db, month)
    const status: TickStatus = new Map(b.occurrencesBetween(db, start, end).map((o) => [`${o.recurring.id}|${o.date}`, { paid: !!o.paid, ticked: o.ticked, before: o.paid?.id === 'avant-buget' }]))
    return { status, lines: new Set([...b.pointed(db).keys()].filter((k) => k.startsWith('line:'))), future: start > today() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, month])
  const [edit, setEdit] = useState<{ categoryId: string; row: Row | null } | null>(null)
  const size = (r: Row) => Math.max(r.planned + r.carry, r.actual)
  const groups = (['revenu', 'depense'] as const).map((k) => ({ k, rows: m.rows.filter((r) => r.kind === k).sort((a, b) => size(b) - size(a)) }))

  function propose() {
    const s = b.suggestBudget(db, month)
    if (!s.length) return toast.error('Pas assez d’historique : importe au moins un mois d’opérations.')
    mutate((d) => s.forEach((x) => b.setBudget(d, x.categoryId, month, x.amount, 'from')))
    toast.success(`${s.length} lignes proposées d’après tes 3 derniers mois. Ajuste-les à ta guise.`)
  }

  return (
    <>
      <Summary m={m} />
      {m.rows.length === 0 ? (
        <Empty>
          Aucun budget pour {b.periodBounds(db, month).label}.
          <div className="mt-3"><Button onClick={propose}>Proposer un budget à partir de mon historique</Button></div>
        </Empty>
      ) : groups.map((g) => g.rows.length > 0 && (
        <section key={g.k} className="mb-4">
          <h2 className="mb-1 flex justify-between px-1 text-sm font-medium text-muted-foreground">
            <span>{g.k === 'revenu' ? 'Revenus' : 'Dépenses'}</span>
            <span className="hidden w-[27rem] grid-cols-3 text-right md:grid"><span>Prévu</span><span>Payé / reçu</span><span>Reste</span></span>
          </h2>
          <ul className="rounded-lg border bg-card">{g.rows.map((r) => <RowLine key={r.categoryId} r={r} month={month} status={ticks.status} lineTicked={ticks.lines.has(b.lineRef(r.categoryId, month))} future={ticks.future} onEdit={() => setEdit({ categoryId: r.categoryId, row: r })} />)}</ul>
        </section>
      ))}
      {m.unbudgetedExpense > 0 && <p className="mb-4 text-sm text-muted-foreground">Dépenses hors budget ce mois : <Money cents={m.unbudgetedExpense} colored={false} /> (catégories sans ligne de budget, ou non catégorisées).</p>}
      <NewLine key={month} month={month} />
      {edit && <BudgetDialog {...edit} month={month} onClose={() => setEdit(null)} />}
    </>
  )
}

function YearView({ month }: { month: string }) {
  const { db, version } = useDb()
  const { label } = useCategories()
  const year = month.slice(0, 4), cur = b.currentPeriod(db, today())
  const data = useMemo(() => {
    const months = b.getBudget(db, `${year}-01`, `${year}-12`)
    const proj = b.getBudget(db, cur, addMonths(cur, 11))
    return { months, projection: projectBalances(b.totalBalance(db), proj, cur) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, year, cur])
  // dépenses puis revenus, chaque groupe trié du plus gros total annuel au plus petit
  const totals = new Map<string, { kind: string; v: number }>()
  for (const m of data.months) for (const r of m.rows) totals.set(r.categoryId, { kind: r.kind, v: (totals.get(r.categoryId)?.v ?? 0) + Math.max(r.planned, r.actual) })
  const catIds = [...totals].sort(([, a], [, b2]) => (a.kind === b2.kind ? b2.v - a.v : a.kind === 'depense' ? -1 : 1)).map(([id]) => id)
  const rowOf = (m: MonthBudget, id: string) => m.rows.find((r) => r.categoryId === id)
  const past = (m: string) => m <= cur
  const firstNeg = data.projection.find((p) => p.balance < 0)

  if (!catIds.length) return <Empty>Aucun budget sur {year}.</Empty>
  return (
    <>
      <h2 className="mb-2 font-medium">Prévu vs réel {year}</h2>
      <div className="mb-6 overflow-x-auto rounded-lg border">
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr><th className="sticky left-0 bg-muted p-2 text-left">Catégorie</th>
              {monthsBetween(`${year}-01`, `${year}-12`).map((m) => <th key={m} className={cn('p-2 text-right capitalize', m === cur && 'text-foreground')}>{new Date(`${m}-15`).toLocaleDateString('fr-FR', { month: 'short' })}</th>)}
              <th className="p-2 text-right">Cumul réel / prévu</th></tr>
          </thead>
          <tbody>
            {catIds.map((id) => {
              let a = 0, p = 0
              return (
                <tr key={id} className="border-t">
                  <td className="sticky left-0 max-w-40 truncate bg-background p-2 text-left font-medium">{label(id)}</td>
                  {data.months.map((m) => {
                    const r = rowOf(m, id)
                    if (r && past(m.month)) { a += r.actual; p += r.planned }
                    const over = r && r.kind === 'depense' && past(m.month) && r.actual > r.planned + r.carry
                    return (
                      <td key={m.month} className={cn('p-2 text-right', over && 'text-destructive')} title={r?.exception ? `Exception : ${r.exception.reason ?? ''}` : undefined}>
                        {r ? <>{past(m.month) && <div>{Math.round(r.actual / 100)}</div>}<div className="text-muted-foreground">{Math.round(r.planned / 100)}{r.exception && <span className="text-primary"> •</span>}</div></> : '—'}
                      </td>
                    )
                  })}
                  <td className="p-2 text-right">{formatMoney(a)} / {formatMoney(p)}</td>
                </tr>
              )
            })}
            <tr className="border-t bg-muted/30 font-medium">
              <td className="sticky left-0 bg-muted p-2 text-left">Solde (revenus − dépenses)</td>
              {data.months.map((m) => <td key={m.month} className="p-2 text-right">{past(m.month) && <div>{Math.round((m.actualIncome - m.actualExpense) / 100)}</div>}<div className="text-muted-foreground">{Math.round((m.plannedIncome - m.plannedExpense) / 100)}</div></td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="-mt-4 mb-6 text-xs text-muted-foreground">En euros. Ligne du haut : réel ; ligne du bas : prévu ; • = exception.</p>

      <h2 className="mb-2 font-medium">Projection du solde (tous comptes) sur 12 mois</h2>
      {firstNeg && <p role="alert" className="mb-2 text-sm text-destructive">Découvert probable en {monthName(firstNeg.month)} si le budget est respecté.</p>}
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {data.projection.map((p) => (
          <li key={p.month} className={cn('rounded-md border p-2', p.balance < 0 && 'border-destructive')}>
            <div className="text-xs capitalize text-muted-foreground">fin {new Date(`${p.month}-15`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}</div>
            <Money cents={p.balance} colored={false} className={cn('font-medium', p.balance < 0 && 'text-destructive')} />
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">Mois en cours : ce qu’il reste à recevoir et à dépenser. Mois suivants : revenus prévus − dépenses prévues, exceptions comprises.</p>
    </>
  )
}

export function BudgetPage() {
  const { db, version } = useDb()
  const [month, setMonth] = useState(() => new URLSearchParams(location.hash.split('?')[1]).get('m') ?? b.currentPeriod(db, today()))
  const cur = b.currentPeriod(db, today())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bounds = useMemo(() => b.periodBounds(db, month), [db, version, month])
  return (
    <>
      <PageHeader title="Budget">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Mois précédent" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft /></Button>
          <span className="min-w-36 text-center font-medium capitalize" title={bounds.day > 1 ? `De ta paie du ${bounds.start} à la veille de la suivante` : undefined}>{bounds.label}</span>
          <Button size="icon" variant="outline" aria-label="Mois suivant" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight /></Button>
          {month !== cur && <Button size="sm" variant="ghost" onClick={() => setMonth(cur)}>Aujourd’hui</Button>}
        </div>
      </PageHeader>
      <Tabs defaultValue="month">
        <TabsList className="mb-3"><TabsTrigger value="month">Mois</TabsTrigger><TabsTrigger value="year">Année et projection</TabsTrigger></TabsList>
        <TabsContent value="month"><MonthView month={month} /></TabsContent>
        <TabsContent value="year"><YearView month={month} /></TabsContent>
      </Tabs>
    </>
  )
}
