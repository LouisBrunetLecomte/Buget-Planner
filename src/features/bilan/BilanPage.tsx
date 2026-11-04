import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, Flame, Lightbulb, OctagonAlert, PartyPopper } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { axisEuro, axisProps, ChartTooltip, gridProps, TableView } from '@/components/charts'
import { addMonths, today } from '@/core/dates'
import { SOURCES, type Tone } from '@/core/coach'
import { formatMoney } from '@/core/money'
import { periodChallenges, periodReport } from '@/db/coachRepo'
import * as b from '@/db/budgetRepo'
import { useDb } from '@/app/store'
import { PageHeader } from '@/app/ui'
import { usePeriodTitle } from '@/app/periods'
import { cn } from '@/lib/utils'

const Card = ({ title, subtitle, children, className }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) => (
  <section className={cn('rounded-3xl bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-none', className)}>
    <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
    {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
    <div className="mt-4">{children}</div>
  </section>
)
const short = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const pct = (x: number) => `${Math.round(x * 100)} %`
const DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const TONE: Record<Tone, { icon: typeof Lightbulb; cls: string; label: string }> = {
  attention: { icon: OctagonAlert, cls: 'text-destructive', label: 'À surveiller' },
  conseil: { icon: Lightbulb, cls: 'text-amber-600 dark:text-amber-400', label: 'Conseil' },
  bravo: { icon: PartyPopper, cls: 'text-emerald-700 dark:text-emerald-400', label: 'Bravo' },
}

/** Bilan d'une période : où part l'argent, à quel rythme et à quelle fréquence, puis les conseils sur mesure. */
export function BilanPage() {
  const { db, version } = useDb()
  const title = usePeriodTitle()
  const [key, setKey] = useState(() => b.currentPeriod(db, today()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const r = useMemo(() => periodReport(db, key, today()), [db, version, key])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ch = useMemo(() => periodChallenges(db, r, today()), [db, version, r])
  const p = r.profile
  const evolution = r.previous && r.previous.spent > 0 ? p.spent / r.previous.spent - 1 : null
  const cats = p.byCategory.slice(0, 8), maxCat = cats[0]?.total ?? 1
  const maxDay = Math.max(1, ...p.weekdays)
  const daily = p.daily.map((d) => ({ date: d.date, total: d.total / 100 }))

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Bilan" subtitle={`${title(key)} · du ${short(r.start)} au ${short(r.end)}${r.current ? ' · en cours' : ''}`}>
        <div className="flex items-center rounded-full bg-secondary p-1">
          <Button size="icon-sm" variant="ghost" aria-label="Période précédente" onClick={() => setKey(addMonths(key, -1))}><ChevronLeft /></Button>
          <button type="button" className="px-3 text-sm" onClick={() => setKey(b.currentPeriod(db, today()))}>{r.current ? 'Période en cours' : 'Revenir à aujourd’hui'}</button>
          <Button size="icon-sm" variant="ghost" aria-label="Période suivante" onClick={() => setKey(addMonths(key, 1))}><ChevronRight /></Button>
        </div>
      </PageHeader>

      {/* les chiffres clés de la période */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {([
          ['Dépensé', formatMoney(p.spent), `${p.count} opération${p.count > 1 ? 's' : ''}`],
          ['Dont quotidien', formatMoney(p.variable), `charges fixes ${formatMoney(p.fixed)}`],
          ['Gardé', r.savingRate === null ? '—' : pct(Math.max(-9.99, r.savingRate)), r.income > 0 ? `de ${formatMoney(r.income)} reçus` : 'pas encore de revenu reçu'],
          ['Par jour', formatMoney(Math.round(p.variable / p.elapsed)), `en moyenne sur ${p.elapsed} j`],
        ] as const).map(([l, v, sub]) => (
          <div key={l} className="rounded-3xl bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-none">
            <p className="text-sm text-muted-foreground">{l}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{v}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>
      {evolution !== null && (
        <p className="mb-5 flex items-center gap-1.5 text-sm text-muted-foreground">
          {evolution > 0 ? <ArrowUpRight className="size-4 text-destructive" /> : <ArrowDownRight className="size-4 text-emerald-600" />}
          {evolution > 0 ? `${pct(evolution)} de plus` : `${pct(-evolution)} de moins`} que la période précédente {r.current ? 'à la même date' : ''} ({formatMoney(r.previous!.spent)}).
        </p>
      )}

      <div className="grid gap-5">
        <Card title="Défis et séries" subtitle={r.current ? 'Tes défis de la période en cours.' : 'Comment s’est terminée cette période.'}>
          <p className="mb-4 flex items-center gap-2 text-sm">
            <Flame className={cn('size-5', ch.streak.current ? 'text-orange-500' : 'text-muted-foreground')} aria-hidden />
            {ch.streak.current
              ? <span><strong className="font-semibold">{ch.streak.current} période{ch.streak.current > 1 ? 's' : ''} d’affilée</strong> dans le budget{ch.streak.best > ch.streak.current ? ` (record : ${ch.streak.best})` : ch.streak.current > 1 ? ', ton record' : ''}.</span>
              : <span className="text-muted-foreground">Pas encore de série : termine une période dans ton budget pour la lancer{ch.streak.best ? ` (record : ${ch.streak.best})` : ''}.</span>}
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {ch.list.map((c) => (
              <li key={c.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-2 text-sm font-medium">{c.title}{c.done && <Check className="size-4 shrink-0 text-emerald-600" aria-label="Réussi" />}</div>
                <div className="mt-2 h-1.5 rounded-full bg-secondary" role="progressbar" aria-label={c.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress * 100)}>
                  <div className={cn('h-full rounded-full', c.done && 'bg-emerald-600')} style={{ width: `${c.progress * 100}%`, ...(c.done ? {} : { background: 'var(--viz-1)' }) }} />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{c.detail}</p>
              </li>
            ))}
          </ul>
          {(ch.wins.length > 0 || ch.misses.length > 0) && (
            <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
              <div><p className="mb-1 font-medium">Budgets tenus</p>
                {ch.wins.length ? <ul className="grid gap-1">{ch.wins.map((w) => <li key={w.name} className="flex justify-between gap-2"><span className="truncate">{w.name}</span><span className="tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(w.left)} de reste</span></li>)}</ul> : <p className="text-muted-foreground">Aucun pour l’instant.</p>}</div>
              <div><p className="mb-1 font-medium">À resserrer</p>
                {ch.misses.length ? <ul className="grid gap-1">{ch.misses.map((w) => <li key={w.name} className="flex justify-between gap-2"><span className="truncate">{w.name}</span><span className="tabular-nums text-destructive">+{formatMoney(w.over)}</span></li>)}</ul> : <p className="text-muted-foreground">Rien de dépassé 👏</p>}</div>
            </div>
          )}
        </Card>

        <Card title="Tes conseils sur mesure" subtitle="Calculés à partir de tes chiffres, d’après les repères des experts (sources indiquées).">
          {!r.advice.length ? <p className="text-sm text-muted-foreground">Pas encore assez de données sur cette période.</p> : (
            <ul className="grid gap-5">
              {r.advice.map((a) => {
                const t = TONE[a.tone]
                return (
                  <li key={a.id} className="flex gap-3">
                    <t.icon className={cn('mt-0.5 size-5 shrink-0', t.cls)} aria-label={t.label} />
                    <div className="min-w-0">
                      <p className="font-medium">{a.title}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{a.body}</p>
                      {a.action && <p className="mt-1.5 text-sm"><span className="font-medium">À faire : </span>{a.action}</p>}
                      {a.source && <a href={SOURCES[a.source].url} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-primary hover:underline">{SOURCES[a.source].label}</a>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="grid gap-5 md:grid-cols-2">
          <Card title="Où part ton argent" subtitle="Par catégorie, avec le nombre de dépenses.">
            {!cats.length ? <p className="text-sm text-muted-foreground">Aucune dépense sur cette période.</p> : (
              <ul className="grid gap-3 text-sm">
                {cats.map((c) => (
                  <li key={c.id ?? 'none'} title={`${c.count} dépense(s), ${formatMoney(c.avg)} en moyenne`}>
                    <div className="flex justify-between gap-2"><span className="truncate">{r.catName(c.id)}</span><span className="tabular-nums">{formatMoney(c.total)} <span className="text-muted-foreground">{pct(c.total / Math.max(1, p.spent))}</span></span></div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-2 rounded-r-full" style={{ width: `${(c.total / maxCat) * 85}%`, background: 'var(--viz-1)', minWidth: 3 }} aria-hidden />
                      <span className="shrink-0 text-xs text-muted-foreground">{c.count}× · moy. {formatMoney(c.avg)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Là où tu vas le plus souvent" subtitle="Dépenses du quotidien, hors loyer et abonnements.">
            {!p.merchants.length ? <p className="text-sm text-muted-foreground">Rien pour l’instant.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-normal">Où</th><th className="pb-2 text-right font-normal">Fois</th><th className="pb-2 text-right font-normal">Total</th><th className="pb-2 text-right font-normal">Moy.</th></tr></thead>
                <tbody>{p.merchants.slice(0, 7).map((m) => (
                  <tr key={m.key} className="border-t border-border/70"><td className="max-w-[10rem] truncate py-2">{m.label}</td><td className="py-2 text-right tabular-nums">{m.count}</td><td className="py-2 text-right tabular-nums">{formatMoney(m.total)}</td><td className="py-2 text-right tabular-nums text-muted-foreground">{formatMoney(m.avg)}</td></tr>
                ))}</tbody>
              </table>
            )}
            {p.small.count > 0 && <p className="mt-4 text-sm text-muted-foreground"><strong className="font-medium text-foreground">{p.small.count} petit{p.small.count > 1 ? 's' : ''} achat{p.small.count > 1 ? 's' : ''}</strong> de moins de 15 € : {formatMoney(p.small.total)} au total.</p>}
          </Card>
        </div>

        <Card title="Au fil de la période" subtitle="Dépenses du quotidien jour par jour (hors loyer et abonnements).">
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={daily} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" tickFormatter={short} {...axisProps} minTickGap={24} />
                <YAxis tickFormatter={axisEuro} width={40} {...axisProps} />
                <Tooltip content={<ChartTooltip labelFormat={short} />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
                <Bar dataKey="total" name="Dépensé" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {pct(p.firstWeekShare)} de tes dépenses du quotidien dans la première semaine · {pct(p.weekendShare)} le week-end.
          </p>
          <TableView head={['Jour', 'Dépensé']} rows={p.daily.filter((d) => d.total).map((d) => [short(d.date), formatMoney(d.total)])} />
        </Card>

        <Card title="Selon le jour de la semaine" subtitle="Quels jours tu dépenses le plus.">
          <div className="grid grid-cols-7 items-end gap-2" style={{ height: 120 }}>
            {p.weekdays.map((v, i) => (
              <div key={DAYS[i]} className="flex h-full flex-col items-center justify-end gap-1" title={`${DAYS[i]} : ${formatMoney(v)}`}>
                <span className="text-[11px] tabular-nums text-muted-foreground">{v ? formatMoney(v).replace(/,\d\d/, '') : ''}</span>
                <div className="w-full max-w-6 rounded-t-[4px]" style={{ height: `${(v / maxDay) * 80}%`, minHeight: v ? 3 : 0, background: i >= 5 ? 'var(--viz-2)' : 'var(--viz-1)' }} />
                <span className="text-xs text-muted-foreground">{DAYS[i]}</span>
              </div>
            ))}
          </div>
        </Card>

        <p className="text-xs text-muted-foreground">Ces conseils sont des repères généraux, pas un conseil financier personnalisé. Pour un accompagnement gratuit : les Points conseil budget labellisés par la Banque de France.</p>
      </div>
    </div>
  )
}
