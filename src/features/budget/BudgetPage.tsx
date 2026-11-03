import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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



const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })


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

interface Line { key: string; label: string; sub?: string; undo?: () => void; date?: string; planned: number; actual: number; tick: { checked: boolean; disabled: boolean; title: string; onChange: (v: boolean) => void } | null; edit: () => void }

/** Écart favorable (vert) : plus reçu que prévu, ou moins dépensé que prévu ; rien tant que rien n'est réalisé. */
function Gap({ l, kind }: { l: Pick<Line, 'planned' | 'actual'>; kind: 'revenu' | 'depense' }) {
  const g = kind === 'revenu' ? l.actual - l.planned : l.planned - l.actual
  if (!l.actual || !g) return <span className="text-muted-foreground">—</span>
  return <span className={g > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>{g > 0 ? '+' : ''}{formatMoney(g)}</span>
}

/** Section comptable : lignes Prévu / Réalisé / Écart / Pointé, puis sous-total. */
function LedgerSection({ title, kind, lines }: { title: string; kind: 'revenu' | 'depense'; lines: Line[] }) {
  if (!lines.length) return null
  const sum = (f: (l: Line) => number) => lines.reduce((t, l) => t + f(l), 0)
  return (
    <tbody>
      <tr><th colSpan={6} className="pt-8 pb-2 text-left text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</th></tr>
      {lines.map((l) => (
        <tr key={l.key} className="border-t border-border/70">
          <td className="py-3 pr-2">
            <button type="button" className="text-left hover:text-primary" onClick={l.edit}>{l.label}</button>
            {(l.sub || l.undo) && <span className="block text-xs text-muted-foreground">{l.sub}{l.undo && <> · <button type="button" className="text-primary hover:underline" onClick={l.undo}>annuler l’exception</button></>}</span>}
          </td>
          <td className="hidden py-3 text-muted-foreground sm:table-cell">{l.date ? fmtDay(l.date) : ''}</td>
          <td className="py-3 text-right tabular-nums">{formatMoney(l.planned)}</td>
          <td className="py-3 text-right tabular-nums">{l.actual ? formatMoney(l.actual) : <span className="text-muted-foreground">—</span>}</td>
          <td className="hidden py-3 text-right tabular-nums md:table-cell"><Gap l={l} kind={kind} /></td>
          <td className="py-3 pl-3 text-right">
            {l.tick && <Checkbox checked={l.tick.checked} disabled={l.tick.disabled} title={l.tick.title} aria-label={`${l.label} ${kind === 'revenu' ? 'reçu' : 'payé'}`} onCheckedChange={(v) => l.tick!.onChange(v === true)} />}
          </td>
        </tr>
      ))}
      <tr className="border-t border-foreground/20 font-medium">
        <td className="py-3">Total {title.toLowerCase()}</td><td className="hidden sm:table-cell" />
        <td className="py-3 text-right tabular-nums">{formatMoney(sum((l) => l.planned))}</td>
        <td className="py-3 text-right tabular-nums">{formatMoney(sum((l) => l.actual))}</td>
        <td className="hidden py-3 text-right tabular-nums md:table-cell"><Gap l={{ planned: sum((l) => l.planned), actual: sum((l) => l.actual) }} kind={kind} /></td><td />
      </tr>
    </tbody>
  )
}

function MonthView({ month }: { month: string }) {
  const { db, version } = useDb()
  const { byId } = useCategories()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const m = useMemo(() => b.getBudget(db, month, month)[0]!, [db, version, month])
  // pointage : échéances réglées (cochées ou retrouvées) avec leur montant réel, lignes cochées
  const ticks = useMemo(() => {
    const { start, end } = b.periodBounds(db, month)
    const status = new Map(b.occurrencesBetween(db, start, end).map((o) => [`${o.recurring.id}|${o.date}`, { paid: o.paid, ticked: o.ticked }]))
    return { status, lines: new Set([...b.pointed(db).keys()].filter((k) => k.startsWith('line:'))), future: start > today() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, month])
  const [edit, setEdit] = useState<{ categoryId: string; row: Row | null } | null>(null)
  const [adding, setAdding] = useState(false)
  const name = (id: string) => byId.get(id)?.name ?? '?'

  // une ligne par échéance datée (comme une écriture), une ligne par poste sans date
  const rev: Line[] = [], fixed: Line[] = [], variable: Line[] = []
  for (const r of m.rows) {
    const verb = r.kind === 'revenu' ? 'reçu' : 'payé'
    const open = () => setEdit({ categoryId: r.categoryId, row: r })
    if (r.items.length && !r.exception) {
      for (const i of r.items) {
        const st = ticks.status.get(`${i.id}|${i.date}`)
        const before = st?.paid?.id === 'avant-buget', byBank = !!st?.paid && !st.ticked && !before
        const line: Line = {
          key: i.id + i.date, label: i.name, sub: i.name !== name(r.categoryId) ? name(r.categoryId) : undefined, date: i.date,
          planned: Math.abs(i.amount), actual: st?.paid && !before ? Math.abs(st.paid.amountEur) : 0, edit: open,
          tick: { checked: !!st?.paid, disabled: byBank || before || (ticks.future && !st?.paid), title: before ? 'Avant ton premier jour : déjà compris dans ton solde' : byBank ? 'Retrouvé dans tes opérations importées' : `Coche quand c’est ${verb}`,
            onChange: (v) => attempt(() => mutate((d) => (v ? b.tickOccurrence(d, i.id, i.date, today()) : b.untick(d, b.occurrenceRef(i.id, i.date))), { label: `${i.name} ${v ? verb : `non ${verb}`}` })) },
        }
        ;(r.kind === 'revenu' ? rev : fixed).push(line)
      }
    } else {
      const avail = r.planned + r.carry
      const line: Line = {
        key: r.categoryId, label: name(r.categoryId), sub: [r.exception && `Exception${r.exception.reason ? ` : ${r.exception.reason}` : ''}`, r.carry && `report ${formatMoney(r.carry)}`].filter(Boolean).join(' · ') || undefined,
        planned: avail, actual: r.actual, edit: open,
        undo: r.exception ? () => { mutate((d) => b.removeException(d, r.exception!.id), { label: 'Exception annulée' }); toast.success('Exception annulée') } : undefined,
        tick: avail > 0 ? { checked: ticks.lines.has(b.lineRef(r.categoryId, month)), disabled: ticks.future, title: ticks.future ? 'Période à venir' : `Coche quand c’est ${verb} : le montant prévu est enregistré`,
          onChange: (v) => attempt(() => mutate((d) => (v ? b.tickLine(d, r.categoryId, month, avail, today()) : b.untick(d, b.lineRef(r.categoryId, month))), { label: `${name(r.categoryId)} ${v ? verb : `non ${verb}`}` })) } : null,
      }
      ;(r.kind === 'revenu' ? rev : variable).push(line)
    }
  }
  const byDate = (x: Line, y: Line) => (x.date ?? '').localeCompare(y.date ?? '') || y.planned - x.planned
  rev.sort(byDate); fixed.sort(byDate); variable.sort((x, y) => y.planned - x.planned)
  const tot = (ls: Line[], f: (l: Line) => number) => ls.reduce((t, l) => t + f(l), 0)
  const result = { planned: tot(rev, (l) => l.planned) - tot([...fixed, ...variable], (l) => l.planned), actual: m.actualIncome - m.actualExpense }

  function propose() {
    const s = b.suggestBudget(db, month)
    if (!s.length) return toast.error('Pas assez d’historique : importe au moins un mois d’opérations.')
    mutate((d) => s.forEach((x) => b.setBudget(d, x.categoryId, month, x.amount, 'from')))
    toast.success(`${s.length} lignes proposées d’après tes 3 derniers mois. Ajuste-les à ta guise.`)
  }

  return (
    <>
      {m.rows.length === 0 ? (
        <Empty>
          Aucun budget pour {b.periodBounds(db, month).label}.
          <div className="mt-3"><Button onClick={propose}>Proposer un budget à partir de mon historique</Button></div>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="pb-2 text-left font-normal">Libellé</th><th className="hidden pb-2 text-left font-normal sm:table-cell">Date</th><th className="pb-2 text-right font-normal">Prévu</th><th className="pb-2 text-right font-normal">Réalisé</th><th className="hidden pb-2 text-right font-normal md:table-cell">Écart</th><th className="pb-2 pl-3 text-right font-normal">Pointé</th></tr>
            </thead>
            <LedgerSection title="Revenus" kind="revenu" lines={rev} />
            <LedgerSection title="Charges fixes" kind="depense" lines={fixed} />
            <LedgerSection title="Dépenses variables" kind="depense" lines={variable} />
            <tfoot>
              <tr className="border-t-2 border-foreground text-base font-semibold">
                <td className="pt-4">Résultat de la période</td><td className="hidden sm:table-cell" />
                <td className={cn('pt-4 text-right tabular-nums', result.planned < 0 && 'text-destructive')}>{formatMoney(result.planned)}</td>
                <td className={cn('pt-4 text-right tabular-nums', result.actual < 0 && 'text-destructive')}>{formatMoney(result.actual)}</td>
                <td className="hidden md:table-cell" /><td />
              </tr>
            </tfoot>
          </table>
          {!rev.length && (() => { const st = b.appStart(db), pb = b.periodBounds(db, month); return st && st >= pb.start && st <= pb.end })() && (
            <p className="mt-4 text-sm text-muted-foreground">Aucun revenu sur cette période : tu as commencé Buget après ta dernière paie, elle est déjà comprise dans ton solde.</p>
          )}
          {m.unbudgetedExpense > 0 && <p className="mt-4 text-sm text-muted-foreground">Dépenses hors budget : <Money cents={m.unbudgetedExpense} colored={false} /> (catégories sans ligne de budget, ou non catégorisées).</p>}
        </div>
      )}
      <div className="mt-8">
        {adding ? <NewLine key={month} month={month} /> : <Button variant="outline" onClick={() => setAdding(true)}>Ajouter une ligne</Button>}
      </div>
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
      <PageHeader title="Budget" subtitle={bounds.day > 1 ? `De paie à paie · ${bounds.label}` : bounds.label}>
        <div className="flex items-center rounded-full bg-secondary p-1">
          <Button size="icon-sm" variant="ghost" aria-label="Mois précédent" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft /></Button>
          <button type="button" className={cn('px-3 text-sm', month === cur ? 'font-medium' : 'text-primary')} onClick={() => setMonth(cur)} title="Revenir à la période en cours">{month === cur ? 'Période en cours' : 'Aujourd’hui'}</button>
          <Button size="icon-sm" variant="ghost" aria-label="Mois suivant" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight /></Button>
        </div>
      </PageHeader>
      <Tabs defaultValue="month">
        <TabsList className="mb-6"><TabsTrigger value="month">Période</TabsTrigger><TabsTrigger value="year">Année et projection</TabsTrigger></TabsList>
        <TabsContent value="month"><MonthView month={month} /></TabsContent>
        <TabsContent value="year"><YearView month={month} /></TabsContent>
      </Tabs>
    </>
  )
}
