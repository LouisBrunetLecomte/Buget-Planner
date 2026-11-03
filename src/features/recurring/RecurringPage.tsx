import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { addMonths, daysBetween, daysInMonth, endOfMonth, monthOf, today } from '@/core/dates'
import { formatMoney } from '@/core/money'
import * as b from '@/db/budgetRepo'
import { mutate, useDb } from '@/app/store'
import { attempt, dayLabel, Empty, Money, PageHeader, useCategories } from '@/app/ui'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { freqLabel, KIND_LABEL, RecurringDialog, type RecurringDraft } from './RecurringDialog'

const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
function inDays(d: string) { const n = daysBetween(today(), d); return n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} j` }

function Summary({ st }: { st: b.RecurringStatus[] }) {
  const act = st.filter((s) => s.r.active)
  const sum = (f: (s: b.RecurringStatus) => boolean) => act.filter(f).reduce((t, s) => t + s.monthly, 0)
  const abo = sum((s) => s.r.kind === 'abonnement'), fixes = sum((s) => s.r.kind !== 'revenu'), rev = sum((s) => s.r.kind === 'revenu')
  const provision = sum((s) => s.r.kind !== 'revenu' && (s.r.freq === 'year' || (s.r.freq === 'month' && s.r.interval >= 3)))
  const cards: [string, number, string][] = [
    ['Revenus récurrents', rev, 'par mois'],
    ['Charges fixes', fixes, `par mois, abonnements compris · ${formatMoney(fixes * 12)} par an`],
    ['Abonnements', abo, `par mois · ${formatMoney(abo * 12)} par an`],
    ['À provisionner', provision, 'par mois pour les charges trimestrielles/annuelles'],
  ]
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {cards.map(([t, v, d]) => (
        <Card key={t} size="sm"><CardHeader><CardDescription>{t}</CardDescription><CardTitle className="text-xl"><Money cents={v} colored={false} /></CardTitle><CardDescription className="text-xs">{d}</CardDescription></CardHeader></Card>
      ))}
    </div>
  )
}

function List({ st, edit }: { st: b.RecurringStatus[]; edit: (d: RecurringDraft) => void }) {
  const { label } = useCategories()
  if (!st.length) return <Empty>Aucune récurrence. Ajoute-en une ou regarde l’onglet Détection.</Empty>
  return (
    <ul className="grid gap-2">
      {st.map(({ r, next, monthly, increase, missed }) => {
        const soon = next && daysBetween(today(), next) <= 7
        const renewal = next && r.freq === 'year' && daysBetween(today(), next) <= 30
        return (
          <li key={r.id}>
            <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3', !r.active && 'opacity-50')}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => edit(r)}>
                <span className="font-medium">{r.name}</span>{' '}
                <Badge variant="outline">{KIND_LABEL[r.kind]}</Badge>
                <span className="block text-xs text-muted-foreground">{freqLabel(r.freq, r.interval)}{r.freq === 'month' ? `, ${dayLabel(r.dayOfMonth ?? Number(r.startDate.slice(8, 10)))}` : ''}{label(r.categoryId) ? ` · ${label(r.categoryId)}` : ''}{r.freq !== 'month' || r.interval !== 1 ? ` · ${formatMoney(monthly)}/mois` : ''}</span>
              </button>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {increase && <Badge variant="outline" className="border-[var(--viz-critical)]">▲ Hausse : {formatMoney(increase.from)} → {formatMoney(increase.to)}</Badge>}
                {increase && Math.abs(increase.to) !== Math.abs(r.amount) && <Button size="xs" variant="outline" onClick={() => mutate((d) => b.updateRecurring(d, r.id, { amount: increase.to }))}>Mettre à jour</Button>}
                {missed.map((m) => <Badge key={m} variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">Non retrouvé le {fmtDay(m)}</Badge>)}
                {renewal && <Badge variant="secondary">Renouvellement {inDays(next)}</Badge>}
                {next && r.active && (
                  <label className="flex items-center gap-1.5" title={`Coche quand c’est ${r.amount > 0 ? 'reçu' : 'payé'}`}>
                    <Checkbox aria-label={`${r.name} du ${fmtDay(next)} ${r.amount > 0 ? 'reçu' : 'payé'}`} checked={false}
                      onCheckedChange={(v) => v === true && attempt(() => mutate((d) => b.tickOccurrence(d, r.id, next, today()), { label: `${r.name} ${r.amount > 0 ? 'reçu' : 'payé'}` }), `${r.name} du ${fmtDay(next)} : ${r.amount > 0 ? 'reçu' : 'payé'}`)} />
                    <span className={cn('text-muted-foreground', soon && 'font-medium text-foreground')}>{fmtDay(next)} ({inDays(next)})</span>
                  </label>
                )}
              </div>
              <Money cents={r.amount} className="w-24 text-right font-medium" />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Calendar() {
  const { db, version } = useDb()
  const [month, setMonth] = useState(monthOf(today()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const occ = useMemo(() => b.occurrencesBetween(db, `${month}-01`, endOfMonth(month)), [db, version, month])
  const firstDow = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 // lundi = 0
  const days = daysInMonth(month)
  const total = occ.reduce((s, o) => s + o.recurring.amount, 0)
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="outline" aria-label="Mois précédent" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft /></Button>
        <span className="w-40 text-center font-medium capitalize">{new Date(`${month}-15`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</span>
        <Button size="icon" variant="outline" aria-label="Mois suivant" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight /></Button>
        <span className="ml-auto text-sm text-muted-foreground">Solde des échéances : <Money cents={total} /></span>
      </div>
      <div className="hidden grid-cols-7 gap-1 text-center text-xs text-muted-foreground md:grid">{['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => <div key={d}>{d}</div>)}</div>
      <ol className="grid gap-1 md:grid-cols-7">
        {Array.from({ length: firstDow }, (_, i) => <li key={`e${i}`} className="hidden md:block" aria-hidden />)}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`
          const items = occ.filter((o) => o.date === date)
          return (
            <li key={date} className={cn('min-h-20 rounded-md border p-1.5 text-xs', date === today() && 'border-primary', !items.length && 'max-md:hidden')}>
              <div className="mb-1 font-medium text-muted-foreground">{i + 1}<span className="md:hidden"> {new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' })}</span></div>
              {items.map((o) => (
                <div key={o.recurring.id} className={cn('mb-0.5 truncate rounded px-1', o.recurring.amount > 0 ? 'bg-emerald-100 dark:bg-emerald-950' : 'bg-muted', o.paid && 'line-through opacity-60')}
                  title={`${o.recurring.name} ${formatMoney(o.recurring.amount)}${o.paid ? ' (payé)' : ''}`}>
                  {o.recurring.name} {formatMoney(o.recurring.amount)}
                </div>
              ))}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">Barré = prélèvement retrouvé dans tes opérations.</p>
    </>
  )
}

function Detection({ edit }: { edit: (d: RecurringDraft) => void }) {
  const { db, version } = useDb()
  const { label } = useCategories()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sug = useMemo(() => b.recurringSuggestions(db, today()), [db, version])
  if (!sug.length) return <Empty>Rien de nouveau détecté. La détection cherche les opérations qui reviennent à intervalle régulier avec un montant stable (au moins 3 fois, 2 pour l’annuel).</Empty>
  return (
    <ul className="grid gap-2">
      {sug.map((s) => (
        <li key={s.pattern + s.accountId} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
          <div className="min-w-0 flex-1">
            <span className="font-medium">{s.pattern}</span> <Badge variant="outline">{KIND_LABEL[s.kind]}</Badge>
            <span className="block text-xs text-muted-foreground">{freqLabel(s.freq, s.interval)} · vu {s.count} fois · dernier le {fmtDay(s.startDate)}{label(s.categoryId) ? ` · ${label(s.categoryId)}` : ''}</span>
          </div>
          <Money cents={s.amount} className="font-medium" />
          <Button size="sm" onClick={() => edit({ name: s.pattern.charAt(0) + s.pattern.slice(1).toLowerCase(), kind: s.kind, amount: s.amount, freq: s.freq, interval: s.interval, startDate: s.startDate, accountId: s.accountId, categoryId: s.categoryId, pattern: s.pattern })}>Suivre</Button>
          <Button size="sm" variant="ghost" onClick={() => mutate((d) => b.ignoreSuggestion(d, s.pattern))}>Ignorer</Button>
        </li>
      ))}
    </ul>
  )
}

export function RecurringPage() {
  const { db, version } = useDb()
  const [editing, setEditing] = useState<RecurringDraft | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const st = useMemo(() => b.recurringStatus(db, today()), [db, version])
  const sorted = [...st].sort((x, y) => Number(y.r.active) - Number(x.r.active) || (x.next ?? '9').localeCompare(y.next ?? '9'))
  return (
    <>
      <PageHeader title="Charges fixes et revenus récurrents"><Button onClick={() => setEditing({})}>Ajouter</Button></PageHeader>
      <Summary st={st} />
      <Tabs defaultValue="list">
        <TabsList className="mb-3"><TabsTrigger value="list">Échéances</TabsTrigger><TabsTrigger value="cal">Calendrier</TabsTrigger><TabsTrigger value="detect">Détection</TabsTrigger></TabsList>
        <TabsContent value="list"><List st={sorted} edit={setEditing} /></TabsContent>
        <TabsContent value="cal"><Card><CardContent className="pt-4"><Calendar /></CardContent></Card></TabsContent>
        <TabsContent value="detect"><Detection edit={setEditing} /></TabsContent>
      </Tabs>
      {editing && <RecurringDialog draft={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
