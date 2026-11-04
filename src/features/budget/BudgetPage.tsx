import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { addDays, addMonths, daysInMonth, monthsBetween, today } from '@/core/dates'
import { type MonthBudget, type Row } from '@/core/budget'
import { formatMoney, evalAmount } from '@/core/money'
import { normalizeLabel } from '@/core/labels'
import { periodKeyFor } from '@/core/period'
import * as b from '@/db/budgetRepo'
import { forecast } from '@/db/analyticsRepo'
import { mutate, useDb } from '@/app/store'
import { attempt, DaySelect, Empty, Money, MonthPicker, PageHeader, useAccounts, useCategories } from '@/app/ui'
import { tickDue, usePeriodTitle } from '@/app/periods'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createCategory } from '@/db/repo'
import { cn } from '@/lib/utils'
import { BudgetDialog } from './BudgetDialog'

const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Prévision de la période `key` (même calcul que l'Aperçu), ou null si elle est passée. */
function forecastFor(db: Parameters<typeof forecast>[0], key: string) {
  const cur = b.currentPeriod(db, today())
  if (key < cur) return null
  return forecast(db, today(), monthsBetween(cur, key).length).periods.find((p) => p.key === key) ?? null
}

type Repeat = 'month' | 'once' | 'year'
const REPEAT: Record<Repeat, string> = { month: 'Chaque mois', once: 'Une seule fois', year: 'Chaque année' }

/** Première date « le `day` » qui tombe dans la période `key`. */
function dateIn(db: Parameters<typeof b.periodBounds>[0], key: string, day: number) {
  const { start } = b.periodBounds(db, key)
  const at = (m: string) => `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`
  return at(start.slice(0, 7)) >= start ? at(start.slice(0, 7)) : at(addMonths(start.slice(0, 7), 1))
}

/**
 * Nouvelle ligne de budget. Le champ Catégorie propose d'abord les catégories existantes (sans accents ni casse) :
 * en choisir une fixe le type. Après chaque ajout, le formulaire revient à « Dépense, chaque mois ».
 */
function NewLine({ month }: { month: string }) {
  const { all, label: catLabel } = useCategories()
  const { db } = useDb()
  const title = usePeriodTitle()
  const savings = useAccounts().filter((a) => !a.archived && a.type === 'epargne')
  const [label, setLabel] = useState(''), [picked, setPicked] = useState<string | null>(null), [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'depense' | 'revenu' | 'epargne'>('depense'), [amount, setAmount] = useState(''), [from, setFrom] = useState(month)
  const [day, setDay] = useState<number | null>(null), [repeat, setRepeat] = useState<Repeat>('month'), [until, setUntil] = useState(''), [to, setTo] = useState<string | null>(null)
  const q = normalizeLabel(label)
  const matches = q && !picked ? all.filter((c) => c.kind !== 'transfert' && normalizeLabel(c.name).includes(q)).sort((x, y) => Number(y.kind === kind) - Number(x.kind === kind)).slice(0, 6) : []
  function pick(id: string) {
    const c = all.find((x) => x.id === id)!
    setPicked(id); setLabel(c.name); setOpen(false)
    if (c.kind === 'depense' || c.kind === 'revenu') setKind(c.kind)
  }
  function add() {
    const name = label.trim(), cents = evalAmount(amount)
    if (!name) return toast.error('Donne un libellé ou choisis une catégorie')
    if (cents === null || cents <= 0) return toast.error('Montant invalide')
    if ((repeat === 'year' || kind === 'epargne') && !day) return toast.error('Choisis la date')
    if (kind === 'epargne' && !to) return toast.error('Choisis le compte épargne')
    const start = day ? dateIn(db, from, day) : null
    const endDate = until && start && repeat !== 'once' ? b.periodBounds(db, until).end : null
    if (endDate && endDate < start!) return toast.error('La fin précède le début')
    const ok = attempt(() => mutate((d) => {
      if (kind === 'epargne') { b.createSavingsTransfer(d, { name, fromAccountId: null, toAccountId: to!, amount: cents, day: day!, startMonth: from, endDate }); return true }
      // catégorie existante (choisie, ou même nom au singulier/pluriel près) avant d'en créer une
      const id = picked ?? b.findCategory(d, name, kind)?.id ?? createCategory(d, { name, kind }).id
      if (repeat === 'once') b.addOneOff(d, { categoryId: id, period: from, amount: cents, day }) // plein, jamais étalé
      else if (start) b.createRecurring(d, { name, kind: kind === 'revenu' ? 'revenu' : 'charge', amount: kind === 'revenu' ? cents : -cents, freq: repeat === 'year' ? 'year' : 'month', interval: 1,
        startDate: start, dayOfMonth: repeat === 'year' ? null : day, endDate, categoryId: id })
      else b.setBudget(d, id, from, cents, 'from')
      return true
    }, { label: `Budget : ${name}` }), `« ${name} » ajouté : ${repeat === 'once' ? title(from) : `${REPEAT[repeat].toLowerCase()} à partir de ${title(from)}`}`)
    if (ok) { setLabel(''); setPicked(null); setAmount(''); setDay(null); setKind('depense'); setRepeat('month'); setUntil(''); setTo(null) }
  }
  return (
    <form aria-label="Nouvelle ligne de budget" className="grid gap-3 rounded-2xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); add() }}>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem_8rem]">
        <div className="relative grid gap-1"><Label htmlFor="nl-l">{kind === 'epargne' ? 'Libellé' : 'Catégorie'}</Label>
          <Input id="nl-l" autoComplete="off" placeholder="ex : Courses, Netflix, Cadeaux…" value={label} aria-describedby={picked ? 'nl-picked' : undefined}
            onChange={(e) => { setLabel(e.target.value); setPicked(null); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
          {picked && <span id="nl-picked" className="text-[11px] text-muted-foreground">Catégorie existante : {catLabel(picked)}</span>}
          {open && kind !== 'epargne' && label.trim() && !picked && (
            <ul aria-label="Catégories proposées" className="absolute top-full z-30 mt-1 grid w-full gap-0.5 rounded-xl border bg-popover p-1 text-sm shadow-md">
              {matches.map((c) => (
                <li key={c.id}><button type="button" className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c.id)}>
                  {catLabel(c.id)} <span className="text-xs text-muted-foreground">{c.kind === 'revenu' ? 'revenu' : 'dépense'}</span></button></li>
              ))}
              <li><button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-primary hover:bg-accent" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}>Créer « {label.trim()} »</button></li>
            </ul>
          )}
        </div>
        <div className="grid gap-1"><Label htmlFor="nl-k">Type</Label>
          <Select value={kind} onValueChange={(v) => { setKind(v as typeof kind); setPicked(null); if (v === 'epargne') setRepeat('month') }}>
            <SelectTrigger id="nl-k" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="depense">Dépense</SelectItem><SelectItem value="revenu">Revenu</SelectItem><SelectItem value="epargne">Virement vers mon épargne</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="grid gap-1"><Label htmlFor="nl-a">Montant (€)</Label><Input id="nl-a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </div>
      {kind === 'epargne' && (savings.length
        ? <div className="grid gap-1 md:w-80"><Label htmlFor="nl-to">Vers</Label>
            <Select value={to ?? ''} onValueChange={setTo}><SelectTrigger id="nl-to" className="w-full"><SelectValue placeholder="Compte épargne" /></SelectTrigger>
              <SelectContent>{savings.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
        : <p className="text-sm text-muted-foreground">Ajoute d’abord ton livret dans <a className="text-primary underline" href="#/comptes">Comptes</a>.</p>)}
      {kind !== 'epargne' && (
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={repeat === 'once'} onCheckedChange={(v) => setRepeat(v === true ? 'once' : 'month')} />
          {kind === 'revenu' ? 'Revenu isolé' : 'Dépense isolée'} : une seule fois, pas récurrente
        </label>
      )}
      <div className="grid gap-3 md:grid-cols-[11rem_11rem_1fr_1fr_auto] md:items-end">
        {repeat === 'once' ? <span /> : (
          <div className="grid gap-1"><Label htmlFor="nl-r">Répéter</Label>
            <Select value={kind === 'epargne' ? 'month' : repeat} onValueChange={(v) => setRepeat(v as Repeat)}>
              <SelectTrigger id="nl-r" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{(['month', 'year'] as Repeat[]).filter((r) => kind !== 'epargne' || r === 'month').map((r) => <SelectItem key={r} value={r}>{REPEAT[r]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1"><Label htmlFor="nl-d">Date</Label><DaySelect id="nl-d" value={day} onChange={setDay} allowNone={repeat !== 'year' && kind !== 'epargne'} /></div>
        <div className="grid gap-1"><span className="text-sm font-medium">{repeat === 'once' ? 'Période' : 'À partir de'}</span><MonthPicker label={repeat === 'once' ? 'Période' : 'À partir de'} value={from} onChange={(m) => m && setFrom(m)} format={(m) => title(m)} /></div>
        {repeat !== 'once' && day ? <div className="grid gap-1"><span className="text-sm font-medium">Jusqu’à (facultatif)</span><MonthPicker label="Jusqu’à" allLabel="Sans fin" value={until} onChange={setUntil} format={(m) => title(m)} /></div> : <span />}
        <Button type="submit">Ajouter</Button>
      </div>
      {repeat === 'once' && <p className="text-xs text-muted-foreground">Compté en entier sur {title(from)}, jamais étalé ni repris les mois suivants.</p>}
    </form>
  )
}

interface Line { key: string; label: string; sub?: string; undo?: () => void; undoLabel?: string; date?: string; planned: number; actual: number; note?: string; settled?: boolean; tick: { checked: boolean; disabled: boolean; title: string; onChange: (v: boolean) => void } | null; edit?: () => void }

const GAP_HELP = 'Écart : différence entre le prévu et le réel, sur les lignes réglées seulement. En vert : plus reçu, ou moins dépensé, que prévu.'

/** Écart d'une ligne réglée ; « — » tant que rien n'est réglé (pas de fausse économie). */
function gapOf(l: Pick<Line, 'planned' | 'actual' | 'settled'>, kind: 'revenu' | 'depense') {
  return l.settled ? (kind === 'revenu' ? l.actual - l.planned : l.planned - l.actual) : null
}
function Gap({ g }: { g: number | null }) {
  if (!g) return <span className="text-muted-foreground">—</span>
  return <span className={g > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>{g > 0 ? '+' : ''}{formatMoney(g)}</span>
}

/** Section comptable : lignes Prévu / Réel / Écart / Payé (ou Reçu), puis sous-total. */
function LedgerSection({ title, kind, lines, verb }: { title: string; kind: 'revenu' | 'depense'; lines: Line[]; verb: string }) {
  if (!lines.length) return null
  const sum = (f: (l: Line) => number) => lines.reduce((t, l) => t + f(l), 0)
  const gaps = lines.map((l) => gapOf(l, kind)).filter((g): g is number => g !== null)
  return (
    <tbody>
      <tr>
        <th colSpan={5} className="pt-8 pb-2 text-left text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</th>
        <th className="pt-8 pb-2 pl-3 text-right text-xs font-normal text-muted-foreground">{verb}</th>
      </tr>
      {lines.map((l) => (
        <tr key={l.key} className="border-t border-border/70">
          <td className="py-3 pr-2">
            {l.edit ? <button type="button" className="text-left hover:text-primary" onClick={l.edit}>{l.label}</button> : <span>{l.label}</span>}
            {(l.sub || l.undo) && <span className="block text-xs text-muted-foreground">{l.sub}{l.undo && <> · <button type="button" className="text-primary hover:underline" onClick={l.undo}>{l.undoLabel ?? 'annuler l’exception'}</button></>}</span>}
          </td>
          <td className="hidden py-3 text-muted-foreground sm:table-cell">{l.date ? fmtDay(l.date) : ''}</td>
          <td className="whitespace-nowrap py-3 pl-3 text-right tabular-nums">{formatMoney(l.planned)}</td>
          <td className="whitespace-nowrap py-3 pl-3 text-right tabular-nums">{l.note ? <span className="text-xs text-muted-foreground">{l.note}</span> : l.actual ? formatMoney(l.actual) : <span className="text-muted-foreground">—</span>}</td>
          <td className="hidden py-3 text-right tabular-nums md:table-cell"><Gap g={gapOf(l, kind)} /></td>
          <td className="py-3 pl-3 text-right">
            {l.tick && <Checkbox checked={l.tick.checked} disabled={l.tick.disabled} title={l.tick.title} aria-label={`${l.label} ${kind === 'revenu' ? 'reçu' : 'payé'}`} onCheckedChange={(v) => l.tick!.onChange(v === true)} />}
          </td>
        </tr>
      ))}
      <tr className="border-t border-foreground/20 font-medium">
        <td className="py-3">Total {title.toLowerCase()}</td><td className="hidden sm:table-cell" />
        <td className="whitespace-nowrap py-3 pl-3 text-right tabular-nums">{formatMoney(sum((l) => l.planned))}</td>
        <td className="whitespace-nowrap py-3 pl-3 text-right tabular-nums">{formatMoney(sum((l) => l.actual))}</td>
        <td className="hidden py-3 text-right tabular-nums md:table-cell" data-testid={`gap-${title}`}><Gap g={gaps.length ? gaps.reduce((t, g) => t + g, 0) : null} /></td><td />
      </tr>
    </tbody>
  )
}

function MonthView({ month }: { month: string }) {
  const { db, version } = useDb()
  const { byId } = useCategories()
  const accounts = useAccounts()
  const title = usePeriodTitle()
  const d = useMemo(() => {
    const m = b.getBudget(db, month, month)[0]!
    const { start, end } = b.periodBounds(db, month)
    const occ = b.occurrencesBetween(db, start, end)
    // pointage : échéances réglées (cochées ou retrouvées) avec leur montant réel, lignes cochées
    const status = new Map(occ.map((o) => [`${o.recurring.id}|${o.date}`, { paid: o.paid, ticked: o.ticked }]))
    return { m, start, end, status, savings: occ.filter((o) => o.recurring.toAccountId), lines: new Set([...b.pointed(db).keys()].filter((k) => k.startsWith('line:'))),
      future: start > today(), current: start <= today() && today() <= end, fp: forecastFor(db, month) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, month])
  const [edit, setEdit] = useState<{ categoryId: string; row: Row | null } | null>(null)
  const [adding, setAdding] = useState(false)
  const { m } = d
  const name = (id: string) => byId.get(id)?.name ?? '?'
  const before = (paid: { id: string } | null | undefined) => paid?.id === 'avant-buget'

  // une ligne par échéance datée (comme une écriture), une ligne par poste sans date
  const rev: Line[] = [], fixed: Line[] = [], variable: Line[] = [], saved: Line[] = []
  for (const r of m.rows) {
    const verb = r.kind === 'revenu' ? 'reçu' : 'payé'
    const open = () => setEdit({ categoryId: r.categoryId, row: r })
    if (r.items.length && !r.exception) {
      for (const i of r.items) {
        const st = d.status.get(`${i.id}|${i.date}`)
        const old = before(st?.paid), byBank = !!st?.paid && !st.ticked && !old
        const line: Line = {
          key: i.id + i.date, label: i.name, sub: i.name !== name(r.categoryId) ? name(r.categoryId) : undefined, date: i.date,
          planned: Math.abs(i.amount), actual: st?.paid && !old ? Math.abs(st.paid.amountEur) : 0, settled: !!st?.paid && !old, edit: open,
          note: old ? 'compris dans ton solde' : undefined,
          tick: { checked: !!st?.paid, disabled: byBank || old || (d.future && !st?.paid),
            title: old ? 'Avant ton premier jour : déjà compris dans ton solde' : byBank ? `Retrouvé dans le Journal : ${formatMoney(st!.paid!.amountEur)} le ${fmtDay(st!.paid!.date)}` : `Coche quand c’est ${verb}`,
            onChange: (v) => (v ? tickDue(i.id, i.name, i.date, verb) : attempt(() => mutate((x) => b.untick(x, b.occurrenceRef(i.id, i.date)), { label: `${i.name} non ${verb}` }))) },
        }
        ;(r.kind === 'revenu' ? rev : fixed).push(line)
      }
    } else {
      const avail = r.planned + r.carry, ticked = d.lines.has(b.lineRef(r.categoryId, month))
      const line: Line = {
        key: r.categoryId, label: name(r.categoryId), sub: [r.exception && (r.base == null ? `Une seule fois${r.exception.reason ? ` : ${r.exception.reason}` : ''}` : `Exception${r.exception.reason ? ` : ${r.exception.reason}` : ''}`), r.carry && `report ${formatMoney(r.carry)}`].filter(Boolean).join(' · ') || undefined,
        planned: avail, actual: r.actual, edit: open, settled: ticked || (r.kind === 'depense' && r.actual > avail),
        // une dépense « une seule fois » n'a pas de montant de base : la retirer, c'est la supprimer
        undoLabel: r.exception && r.base === null ? 'supprimer' : undefined,
        undo: r.exception ? () => { mutate((x) => b.removeException(x, r.exception!.id), { label: r.base === null ? 'Ligne supprimée' : 'Exception annulée' }); toast.success(r.base === null ? 'Supprimé' : 'Exception annulée') } : undefined,
        tick: avail > 0 ? !ticked && r.actual >= avail ? { checked: true, disabled: true, title: `Déjà noté dans le Journal : ${formatMoney(r.actual)}`, onChange: () => {} }
          : { checked: ticked, disabled: d.future, title: d.future ? 'Période à venir' : r.actual > 0 && !ticked ? `Coche quand c’est ${verb} : seuls les ${formatMoney(avail - r.actual)} qui manquent sont enregistrés` : `Coche quand c’est ${verb} : le montant prévu est enregistré`,
          onChange: (v) => attempt(() => mutate((x) => (v ? b.tickLine(x, r.categoryId, month, avail, today()) : b.untick(x, b.lineRef(r.categoryId, month))), { label: `${name(r.categoryId)} ${v ? verb : `non ${verb}`}` })) } : null,
      }
      ;(r.kind === 'revenu' ? rev : variable).push(line)
    }
  }
  // virements vers l'épargne : « mis de côté », jamais comptés comme une dépense
  for (const o of d.savings) {
    const st = d.status.get(`${o.recurring.id}|${o.date}`), old = before(st?.paid)
    saved.push({ key: o.recurring.id + o.date, label: o.recurring.name, sub: `vers ${accounts.find((a) => a.id === o.recurring.toAccountId)?.name ?? 'l’épargne'}`, date: o.date,
      planned: Math.abs(o.recurring.amount), actual: st?.paid && !old ? Math.abs(st.paid.amountEur) : 0, settled: !!st?.paid && !old, note: old ? 'compris dans ton solde' : undefined,
      tick: { checked: !!st?.paid, disabled: old || (d.future && !st?.paid), title: 'Coche quand le virement est fait',
        onChange: (v) => (v ? tickDue(o.recurring.id, o.recurring.name, o.date, 'viré') : attempt(() => mutate((x) => b.untick(x, b.occurrenceRef(o.recurring.id, o.date)), { label: `${o.recurring.name} annulé` }))) } })
  }
  const byDate = (x: Line, y: Line) => (x.date ?? '').localeCompare(y.date ?? '') || y.planned - x.planned
  rev.sort(byDate); fixed.sort(byDate); saved.sort(byDate); variable.sort((x, y) => y.planned - x.planned)
  // le quotidien non budgété (boulangerie, kebab…) : estimé d'après tes dépenses réelles, comme dans l'Aperçu
  const everyday = (d.fp?.everyday ?? 0) + (d.current ? m.unbudgetedExpense : 0)
  if (everyday > 0 || m.unbudgetedExpense > 0)
    variable.push({ key: 'quotidien', label: 'Dépenses du quotidien (non budgétées)', sub: d.fp?.everyday ? 'estimées d’après tes dépenses réelles' : 'catégories sans ligne de budget, ou non catégorisées', planned: d.fp ? everyday : 0, actual: m.unbudgetedExpense, tick: null })
  const tot = (ls: Line[], f: (l: Line) => number) => ls.reduce((t, l) => t + f(l), 0)
  const result = { planned: tot(rev, (l) => l.planned) - tot([...fixed, ...variable], (l) => l.planned), actual: tot(rev, (l) => l.actual) - tot([...fixed, ...variable], (l) => l.actual) }
  const st = b.appStart(db)

  function propose() {
    const s = b.suggestBudget(db, month)
    if (!s.length) return toast.error('Pas assez d’historique : importe au moins un mois d’opérations.')
    mutate((x) => s.forEach((y) => b.setBudget(x, y.categoryId, month, y.amount, 'from')))
    toast.success(`${s.length} lignes proposées d’après tes 3 derniers mois. Ajuste-les à ta guise.`)
  }

  return (
    <>
      {!rev.length && !fixed.length && !variable.length && !saved.length ? (
        <Empty>
          Aucun budget pour {title(month)}.
          <div className="mt-3"><Button onClick={propose}>Proposer un budget à partir de mon historique</Button></div>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="pb-2 text-left font-normal">Libellé</th><th className="hidden pb-2 text-left font-normal sm:table-cell">Date</th>
                <th className="pb-2 text-right font-normal" title="Ce que tu as prévu de recevoir ou de dépenser">Prévu</th>
                <th className="pb-2 text-right font-normal" title="Ce qui a vraiment été reçu ou dépensé">Réel</th>
                <th className="hidden pb-2 text-right font-normal md:table-cell" title={GAP_HELP}>Écart</th><th className="pb-2 pl-3"><span className="sr-only">Réglé</span></th></tr>
            </thead>
            <LedgerSection title="Revenus" kind="revenu" verb="Reçu" lines={rev} />
            <LedgerSection title="Charges fixes" kind="depense" verb="Payé" lines={fixed} />
            <LedgerSection title="Dépenses variables" kind="depense" verb="Payé" lines={variable} />
            <LedgerSection title="Mis de côté" kind="depense" verb="Viré" lines={saved} />
            <tfoot>
              <tr className="border-t-2 border-foreground text-base font-semibold">
                <td className="pt-4" title="Résultat de la période : revenus moins dépenses (hors épargne)">Revenus − dépenses</td><td className="hidden sm:table-cell" />
                <td className={cn('whitespace-nowrap pt-4 pl-3 text-right tabular-nums', result.planned < 0 && 'text-destructive')}>{formatMoney(result.planned)}</td>
                <td className={cn('whitespace-nowrap pt-4 pl-3 text-right tabular-nums', result.actual < 0 && 'text-destructive')}>{formatMoney(result.actual)}</td>
                <td className="hidden md:table-cell" /><td />
              </tr>
              {d.fp && (
                <tr className="text-[15px]">
                  <td colSpan={2} className="pt-3 text-muted-foreground" title="Le même chiffre que la case correspondante des Prévisions, sur l’Aperçu">Ce qu’il te restera avant ta paie du {fmtDay(addDays(d.end, 1))}</td>
                  <td data-testid="budget-reste" className={cn('whitespace-nowrap pt-3 pl-3 text-right font-medium tabular-nums', d.fp.balance < 0 && 'text-destructive')}>{formatMoney(d.fp.balance)}</td>
                  <td colSpan={3} />
                </tr>
              )}
            </tfoot>
          </table>
          {!rev.length && st && st >= d.start && st <= d.end && (
            <p className="mt-4 text-sm text-muted-foreground">Aucun revenu sur cette période : tu as commencé Budget après ta dernière paie, elle est déjà comprise dans ton solde.</p>
          )}
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
  const title = usePeriodTitle()
  const year = title(month).slice(-4), cur = b.currentPeriod(db, today())
  const data = useMemo(() => {
    // les 12 périodes dont le nom tombe dans l'année (paie le 28 : « janvier » commence le 28 décembre)
    const day = b.periodDay(db), first = periodKeyFor(`${year}-01`, day)
    return { months: b.getBudget(db, first, addMonths(first, 11)), projection: forecast(db, today(), 12).periods }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, year])
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
      <h2 className="mb-2 font-medium">Prévu et réel {year}</h2>
      <div className="mb-6 overflow-x-auto rounded-lg border">
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr><th className="sticky left-0 bg-muted p-2 text-left">Catégorie</th>
              {data.months.map((m) => <th key={m.month} className={cn('p-2 text-right', m.month === cur && 'text-foreground')}>{title(m.month, 'short').replace(/ \d+$/, '')}</th>)}
              <th className="p-2 text-right">Réel cumulé / prévu</th></tr>
          </thead>
          <tbody>
            {catIds.map((id) => {
              let a = 0, p = 0
              for (const m of data.months) { const r = rowOf(m, id); if (r && past(m.month)) { a += r.actual; p += r.planned } }
              return (
                <tr key={id} className="border-t">
                  <td className="sticky left-0 max-w-40 truncate bg-background p-2 text-left font-medium">{label(id)}</td>
                  {data.months.map((m) => {
                    const r = rowOf(m, id)
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
              <td className="sticky left-0 bg-muted p-2 text-left">Revenus − dépenses</td>
              {data.months.map((m) => <td key={m.month} className="p-2 text-right">{past(m.month) && <div>{Math.round((m.actualIncome - m.actualExpense) / 100)}</div>}<div className="text-muted-foreground">{Math.round((m.plannedIncome - m.plannedExpense) / 100)}</div></td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="-mt-4 mb-6 text-xs text-muted-foreground">En euros. Périodes passées et en cours : réel en haut, prévu en gris en dessous. • = exception. Le cumul compte jusqu’à la période en cours.</p>

      <h2 className="mb-2 font-medium">Ton solde avant chaque paie, sur 12 mois</h2>
      {firstNeg && <p role="alert" className="mb-2 text-sm text-destructive">Découvert probable avant ta paie du {fmtDay(addDays(firstNeg.end, 1))}.</p>}
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {data.projection.map((p) => (
          <li key={p.key} className={cn('rounded-md border p-2', p.balance < 0 && 'border-destructive')}>
            <div className="text-xs text-muted-foreground">avant le {fmtDay(addDays(p.end, 1))}</div>
            <Money cents={p.balance} colored={false} className={cn('font-medium', p.balance < 0 && 'text-destructive')} />
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">Comptes courants, la veille de chaque paie : charges, budget, ponctuels et dépenses du quotidien déduits. Les mêmes chiffres que sur l’Aperçu.</p>
    </>
  )
}

export function BudgetPage() {
  const { db, version } = useDb()
  const title = usePeriodTitle()
  const [month, setMonth] = useState(() => new URLSearchParams(location.hash.split('?')[1]).get('m') ?? b.currentPeriod(db, today()))
  const cur = b.currentPeriod(db, today())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bounds = useMemo(() => b.periodBounds(db, month), [db, version, month])
  const when = month === cur ? 'en cours' : month < cur ? 'terminée' : 'à venir'
  return (
    <>
      <p className="-mb-1 text-[15px] font-medium text-muted-foreground">Budget</p>
      <PageHeader title={title(month)} subtitle={`${fmtDay(bounds.start)} → ${fmtDay(bounds.end)} · ${when}`}>
        <div className="flex items-center rounded-full bg-secondary p-1">
          <Button size="icon-sm" variant="ghost" aria-label="Mois précédent" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft /></Button>
          {month === cur ? <span className="px-3 text-sm font-medium">Période en cours</span>
            : <button type="button" className="px-3 text-sm text-primary" onClick={() => setMonth(cur)}>Revenir à la période en cours</button>}
          <Button size="icon-sm" variant="ghost" aria-label="Mois suivant" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight /></Button>
        </div>
      </PageHeader>
      <Tabs defaultValue="month">
        <TabsList className="mb-6"><TabsTrigger value="month">Période</TabsTrigger><TabsTrigger value="year">Année et prévisions</TabsTrigger></TabsList>
        <TabsContent value="month"><MonthView month={month} /></TabsContent>
        <TabsContent value="year"><YearView month={month} /></TabsContent>
      </Tabs>
    </>
  )
}
