import { useMemo } from 'react'
import { AlertTriangle, Info, OctagonAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { addDays, addMonths, daysBetween, today } from '@/core/dates'
import { insights, type Severity } from '@/core/analytics'
import { formatMoney } from '@/core/money'
import * as b from '@/db/budgetRepo'
import * as an from '@/db/analyticsRepo'
import { mutate, useDb } from '@/app/store'
import { getSetting, putSetting } from '@/db/repo'
import { attempt, Empty, Money, PageHeader, useAccounts, useCategories } from '@/app/ui'
import { Checkbox } from '@/components/ui/checkbox'
import { ResteAVivre } from '@/features/budget/BudgetPage'
import { cn } from '@/lib/utils'

const SEV: Record<Severity, { icon: typeof Info; cls: string; label: string }> = {
  critique: { icon: OctagonAlert, cls: 'text-[var(--viz-critical)]', label: 'Critique' },
  attention: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400', label: 'Attention' },
  info: { icon: Info, cls: 'text-muted-foreground', label: 'Info' },
}

function Alerts() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => an.alerts(db, today()), [db, version])
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Alertes</CardTitle></CardHeader>
      <CardContent>
        {!list.length ? <p className="text-sm text-muted-foreground">Rien à signaler.</p> : (
          <ul className="grid gap-2">
            {list.map((a) => {
              const S = SEV[a.severity]
              return (
                <li key={a.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                  <S.icon className={cn('mt-0.5 size-4 shrink-0', S.cls)} aria-label={S.label} />
                  <a href={a.href} className="min-w-0 flex-1 hover:underline"><span className="font-medium">{a.title}</span><span className="block text-xs text-muted-foreground">{a.body}</span></a>
                  <Button size="icon-xs" variant="ghost" aria-label={`Masquer l’alerte ${a.title}`} onClick={() => mutate((d) => an.dismissAlert(d, a.id))}><X /></Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Upcoming() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const occ = useMemo(() => b.occurrencesBetween(db, b.periodBounds(db, b.currentPeriod(db, today())).start, addDays(today(), 14)).filter((o) => !o.paid), [db, version])
  return (
    <Card>
      <CardHeader><CardTitle>À payer / à recevoir</CardTitle><CardDescription>Coche quand c’est fait</CardDescription></CardHeader>
      <CardContent>
        {!occ.length ? <p className="text-sm text-muted-foreground">Aucune échéance suivie. <a className="underline" href="#/recurrences">Détecter mes charges fixes</a></p> : (
          <ul className="grid gap-1 text-sm">
            {occ.map((o) => {
              const n = daysBetween(today(), o.date)
              return (
                <li key={o.recurring.id + o.date} className="flex items-center justify-between gap-2">
                  <label className="flex min-w-0 items-center gap-2">
                    <Checkbox aria-label={`${o.recurring.name} ${o.recurring.amount > 0 ? 'reçu' : 'payé'}`} onCheckedChange={(v) => v === true && attempt(() => mutate((d) => b.tickOccurrence(d, o.recurring.id, o.date, today()), { label: `${o.recurring.name} ${o.recurring.amount > 0 ? 'reçu' : 'payé'}` }), `${o.recurring.name} : ${o.recurring.amount > 0 ? 'reçu' : 'payé'}`)} />
                    <span className="truncate">{o.recurring.name} <span className="text-xs text-muted-foreground">{n < 0 ? `en retard (${-n} j)` : n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} j`}</span></span>
                  </label>
                  <Money cents={o.recurring.amount} />
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Health() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const h = useMemo(() => an.health(db, today()), [db, version])
  if (!h.enough) return (
    <Card>
      <CardHeader><CardDescription>Score de santé financière</CardDescription><CardTitle className="text-xl">Bientôt</CardTitle>
        <CardDescription className="text-xs">Il sera calculé après ta première période complète (de paie à paie) avec un revenu reçu : coche ton salaire quand il arrive.</CardDescription></CardHeader>
    </Card>
  )
  return (
    <Card>
      <CardHeader><CardDescription>Score de santé financière</CardDescription><CardTitle className="text-3xl">{h.score}<span className="text-base font-normal text-muted-foreground"> / 100</span></CardTitle></CardHeader>
      <CardContent>
        <ul className="grid gap-2 text-xs">
          {h.parts.map((p) => (
            <li key={p.label}>
              <div className="flex justify-between"><span>{p.label}</span><span className="tabular-nums text-muted-foreground">{p.points}/{p.max}</span></div>
              <div className="my-1 h-1.5 rounded-full bg-muted" role="meter" aria-valuenow={p.points} aria-valuemin={0} aria-valuemax={p.max} aria-label={p.label}>
                <div className="h-full rounded-full" style={{ width: `${(p.points / p.max) * 100}%`, background: 'var(--viz-1)' }} />
              </div>
              <span className="text-muted-foreground">{p.hint}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Premiers pas, puis rappel de sauvegarde (le mot de passe est irrécupérable : la sauvegarde est la seule assurance). */
function Onboarding() {
  const { db, version } = useDb()
  const st = useMemo(() => {
    const has = (sql: string) => (db as unknown as { $client: { exec: (s: string) => { values: unknown[][] }[] } }).$client.exec(sql)[0]?.values[0]?.[0] as number > 0
    const lastBackup = getSetting<string>(db, 'lastBackup') ?? null
    return {
      steps: [
        ['Créer tes comptes', has('select count(*) from account'), '#/comptes'],
        ['Ajouter ton salaire et tes charges avec leur date', has('select count(*) from recurring'), '#/recurrences'],
        ['Créer ton budget (courses, sorties…)', has('select count(*) from budget_line') || has('select count(*) from recurring where category_id is not null and kind = \'charge\''), '#/budget'],
        ['Cocher un premier paiement, ou importer un relevé', has('select count(*) from "transaction"'), '#/budget'],
        ['Télécharger une sauvegarde chiffrée', !!lastBackup, '#/reglages'],
      ] as [string, boolean, string][],
      stale: !lastBackup || daysBetween(lastBackup, today()) > 30, lastBackup,
      dismissed: getSetting<boolean>(db, 'onboardingDone') ?? false,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  const done = st.steps.filter((x) => x[1]).length
  if (done < st.steps.length && !st.dismissed) return (
    <Card className="lg:col-span-3">
      <CardHeader><CardTitle>Bien démarrer ({done}/{st.steps.length})</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {st.steps.map(([l, ok, href]) => <a key={l} href={href} className={cn('rounded-md border px-3 py-1.5 text-sm', ok ? 'text-muted-foreground line-through' : 'hover:bg-muted')}>{ok ? '✓ ' : ''}{l}</a>)}
        <Button size="sm" variant="ghost" onClick={() => mutate((d) => putSetting(d, 'onboardingDone', true), { undoable: false })}>Masquer</Button>
      </CardContent>
    </Card>
  )
  if (st.stale) return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm lg:col-span-3 dark:border-amber-800 dark:bg-amber-950/40">
      {st.lastBackup ? `Dernière sauvegarde le ${new Date(st.lastBackup).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}.` : 'Aucune sauvegarde téléchargée.'} Si tu oublies ton mot de passe ou perds cet appareil, c’est la seule façon de retrouver tes données. <a className="font-medium underline" href="#/reglages">Sauvegarder maintenant</a>
    </div>
  )
  return null
}

function Insights() {
  const { db, version } = useDb()
  const { label } = useCategories()
  const list = useMemo(() => {
    const cur = b.currentPeriod(db, today())
    return insights(b.getBudget(db, addMonths(cur, -4), addMonths(cur, -1)), (id) => label(id) ?? '?')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, label])
  if (!list.length) return null
  return (
    <Card>
      <CardHeader><CardTitle>Ce qu’il faut retenir</CardTitle></CardHeader>
      <CardContent><ul className="grid list-disc gap-1 pl-4 text-sm">{list.map((s) => <li key={s}>{s}</li>)}</ul></CardContent>
    </Card>
  )
}

export function HomePage() {
  const { db, version } = useDb()
  const accounts = useAccounts()
  const k = useMemo(() => {
    const cur = b.currentPeriod(db, today())
    const m = b.getBudget(db, cur, cur)[0]!
    const h = an.health(db, today())
    return { total: b.totalBalance(db), m, rate: h.rate, enough: h.enough }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  if (!accounts.length) return <><PageHeader title="Accueil" /><Empty>Bienvenue ! Commence par <a className="underline" href="#/comptes">créer un compte</a>, puis <a className="underline" href="#/import">importe un relevé</a>.</Empty></>
  const spentPct = k.m.plannedExpense ? k.m.actualExpense / k.m.plannedExpense : 0
  return (
    <>
      <PageHeader title="Accueil" />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Card size="sm" className="col-span-2 lg:col-span-1"><CardHeader><CardDescription>Solde total (tous comptes)</CardDescription><CardTitle className="text-3xl font-semibold"><Money cents={k.total} colored={false} /></CardTitle><CardDescription className="text-xs">{((n) => `${n} compte${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}`)(accounts.filter((a) => !a.archived).length)}</CardDescription></CardHeader></Card>
        <div className="col-span-2 lg:col-span-1"><ResteAVivre /></div>
        <Card size="sm"><CardHeader><CardDescription>Dépensé sur la période</CardDescription>
          <CardTitle className="text-xl"><Money cents={k.m.actualExpense} colored={false} /></CardTitle>
          {k.m.plannedExpense > 0 ? <>
            <div className="h-1.5 rounded-full bg-muted" role="meter" aria-valuenow={Math.round(spentPct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget consommé">
              <div className={cn('h-full rounded-full', spentPct > 1 ? 'bg-[var(--viz-critical)]' : 'bg-[var(--viz-1)]')} style={{ width: `${Math.min(100, spentPct * 100)}%` }} />
            </div>
            <CardDescription className="text-xs">sur {formatMoney(k.m.plannedExpense)} prévus</CardDescription>
          </> : <CardDescription className="text-xs"><a className="underline" href="#/budget">Créer un budget</a></CardDescription>}
        </CardHeader></Card>
        <Card size="sm"><CardHeader><CardDescription>Taux d’épargne</CardDescription><CardTitle className="text-xl">{k.enough ? `${Math.round(k.rate * 100)} %` : '—'}</CardTitle><CardDescription className="text-xs">{k.enough ? '3 dernières périodes complètes' : 'après ta première paie complète'}</CardDescription></CardHeader></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Onboarding />
        <Alerts />
        <Upcoming />
        <Health />
        <Insights />
      </div>
    </>
  )
}
