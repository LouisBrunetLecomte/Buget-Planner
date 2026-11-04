import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, OctagonAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { addDays, daysBetween, today } from '@/core/dates'
import { formatMoney } from '@/core/money'
import * as b from '@/db/budgetRepo'
import * as an from '@/db/analyticsRepo'
import { balances, confirmBalance, getSetting, putSetting } from '@/db/repo'
import { parseAmount } from '@/core/money'
import { Input } from '@/components/ui/input'
import { mutate, useDb } from '@/app/store'
import { attempt, Empty, useAccounts, useCategories } from '@/app/ui'
import { tickDue } from '@/app/periods'
import { cn } from '@/lib/utils'

const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const euros = (c: number) => formatMoney(c).replace(/,00(?=\s€)/, '') // « 412 € » plutôt que « 412,00 € » dans les phrases
const Section = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => (
  <section className={cn('rounded-3xl bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-none', className)}><h2 className="mb-4 text-[17px] font-semibold tracking-tight">{title}</h2>{children}</section>
)

/**
 * Le solde vient de toi : Buget ne peut pas deviner ta banque. On l'affiche avec la date où tu l'as confirmé,
 * et on le corrige d'un geste. Ensuite, ce que tu coches ou saisis le fait évoluer.
 */
function Balance() {
  const { db, version } = useDb()
  const accounts = useAccounts().filter((a) => !a.archived && (a.type === 'courant' || a.type === 'carte' || a.type === 'especes'))
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const d = useMemo(() => {
    const bal = balances(db), x = b.resteAVivreFor(db, today())
    return { bal, x, payday: addDays(x.end, 1) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  const confirmed = accounts.map((a) => a.balanceSetAt?.slice(0, 10) ?? null)
  const stale = confirmed.some((c) => !c || daysBetween(c, today()) > 7)
  const last = confirmed.filter(Boolean).sort().at(0) ?? null
  const startEdit = () => { setValues(Object.fromEntries(accounts.map((a) => [a.id, ((d.bal.get(a.id) ?? 0) / 100).toFixed(2).replace('.', ',')]))); setEditing(true) }
  const save = () => {
    const ok = attempt(() => mutate((tx) => {
      for (const a of accounts) {
        const c = parseAmount(values[a.id] ?? '')
        if (c === null) throw new Error(`Montant illisible pour ${a.name}`)
        confirmBalance(tx, a.id, c, today()) // même si le montant ne change pas : la confirmation du jour est enregistrée
      }
      return true
    }, { label: 'Solde corrigé' }), 'Solde à jour')
    if (ok) setEditing(false)
  }
  if (!accounts.length) return <Empty>Ajoute ton compte courant avec son solde dans <a className="underline" href="#/comptes">Comptes</a>.</Empty>
  return (
    <section className="px-5 pt-6 pb-10 text-center">
      <p className="text-[17px] text-muted-foreground">{accounts.length > 1 ? 'Sur tes comptes' : 'Sur ton compte'}</p>
      {editing ? (
        <form className="mx-auto my-3 grid max-w-xs gap-2" onSubmit={(e) => { e.preventDefault(); save() }}>
          {accounts.map((a) => (
            <label key={a.id} className="grid gap-1 text-left text-xs text-muted-foreground">{a.name} : ce qu’affiche ta banque maintenant
              <Input autoFocus={a === accounts[0]} inputMode="decimal" className="h-11 text-center text-2xl font-semibold text-foreground" value={values[a.id] ?? ''} onChange={(e) => setValues({ ...values, [a.id]: e.target.value })} />
            </label>
          ))}
          <div className="flex justify-center gap-2"><Button type="submit">Enregistrer</Button><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button></div>
        </form>
      ) : (
        <button type="button" onClick={startEdit} className="my-2 block w-full text-6xl font-semibold tracking-tight md:text-[80px] md:leading-none" title="Corriger avec le montant de ta banque">{formatMoney(d.x.liquid)}</button>
      )}
      {!editing && (stale
        ? <button type="button" onClick={startEdit} className="text-sm text-amber-700 underline dark:text-amber-400">Vérifie ce montant avec ta banque et corrige-le si besoin</button>
        : <p className="text-xs text-muted-foreground">Confirmé le {new Date(last!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })} · touche le montant pour le corriger</p>)}
      {/* une seule réponse à « combien il me reste » : à vivre = solde + à recevoir − à payer − budget restant */}
      {d.x.amount >= 0
        ? <p className="mt-6 text-[17px] text-muted-foreground">À vivre jusqu’à ta paie du {fmtDay(d.payday)} : <strong className="font-medium text-foreground">{euros(d.x.amount)}</strong> · {euros(d.x.perDay)}/jour</p>
        : <p className="mt-6 text-[17px] text-destructive">Il manque <strong className="font-medium">{euros(-d.x.amount)}</strong> d’ici ta paie du {fmtDay(d.payday)}</p>}
      {d.x.incoming > 0 && <p className="mt-1 text-xs text-muted-foreground">dont {euros(d.x.incoming)} attendus, pas encore reçus</p>}
      {d.x.confidence !== 'none' && d.x.dailyEveryday > 0 && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="forecast-end">Si tu dépenses comme d’habitude ({euros(d.x.dailyEveryday)}/jour) : ≈ {formatMoney(d.x.forecastEnd)} avant ta paie</p>
      )}
    </section>
  )
}

/** Ton solde avant chaque paie, sur 6 périodes, dépense du quotidien comprise : un clic ouvre le budget de la période. */
function Forecast() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const f = useMemo(() => an.forecast(db, today(), 6), [db, version])
  const none = f.confidence === 'none'
  return (
    <Section title="Prévisions">
      {none && (
        <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-medium">Tes dépenses du quotidien ne sont pas encore comptées : ces prévisions sont trop hautes.</strong> Note tes dépenses quelques jours dans le <a className="underline" href="#/operations">Journal</a>, ou fixe un budget Courses.
        </p>
      )}
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {f.periods.map((p) => (
          <li key={p.key}>
            <a href={`#/budget?m=${p.key}`} aria-label={`Avant le ${fmtDay(addDays(p.end, 1))} : ${none ? 'au mieux ' : '≈ '}${formatMoney(p.balance)}`} className={cn('block rounded-2xl bg-secondary p-3 text-center transition-colors hover:bg-accent dark:bg-accent dark:hover:bg-[#3a3a3c]', p.balance < 0 && 'ring-1 ring-destructive/50')}>
              <span className="block text-xs text-muted-foreground">avant le {fmtDay(addDays(p.end, 1))}</span>
              <span data-testid="forecast-case" className={cn('block text-sm font-medium tabular-nums', p.balance < 0 && 'text-destructive')}>{none ? <span className="font-normal text-muted-foreground">au mieux </span> : '≈ '}{formatMoney(p.balance)}</span>
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Ton solde la veille de chaque paie, charges, budget et ponctuels déduits{f.dailyEveryday > 0 ? <>, si tu dépenses comme d’habitude ({euros(f.dailyEveryday)}/jour)</> : ''}. Touche une case pour ajuster ce budget.
      </p>
    </Section>
  )
}

/** À payer / à recevoir d'ici la paie (retards compris) : on coche, tout se met à jour. */
function Due() {
  const { db, version } = useDb()
  const occ = useMemo(() => {
    const { start, end } = b.periodBounds(db, b.currentPeriod(db, today()))
    return b.occurrencesBetween(db, start, end).filter((o) => !o.paid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  if (!occ.length) return null
  return (
    <Section title="À payer et à recevoir">
      {(
        <ul className="grid gap-2 text-sm">
          {occ.map((o) => {
            const n = daysBetween(today(), o.date), verb = o.recurring.amount > 0 ? 'reçu' : 'payé'
            return (
              <li key={o.recurring.id + o.date} className="flex items-center justify-between gap-3">
                <label className="flex min-w-0 items-center gap-2.5">
                  <Checkbox aria-label={`${o.recurring.name} ${verb}`} onCheckedChange={(v) => v === true && tickDue(o.recurring.id, o.recurring.name, o.date, verb)} />
                  <span className="truncate">{o.recurring.name}</span>
                  <span className={cn('shrink-0 text-xs', n < 0 ? 'text-destructive' : 'text-muted-foreground')}>{n < 0 ? 'en retard' : n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} j`}</span>
                </label>
                <span className={cn('tabular-nums', o.recurring.amount > 0 && 'text-emerald-700 dark:text-emerald-400')}>{o.recurring.amount > 0 ? '+' : ''}{formatMoney(o.recurring.amount)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

/** Ce qu'il reste dans chaque poste du budget (courses, sorties…), le plus gros en haut. */
function Envelopes() {
  const { db, version } = useDb()
  const { byId } = useCategories()
  const label = (id: string) => byId.get(id)?.name ?? '?'
  const rows = useMemo(() => {
    const cur = b.currentPeriod(db, today())
    return b.getBudget(db, cur, cur)[0]!.rows.filter((r) => r.kind === 'depense' && !(r.items.length && !r.exception) && r.remaining !== 0).sort((x, y) => y.planned + y.carry - (x.planned + x.carry))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  if (!rows.length) return null
  return (
    <Section title="Ce qu’il reste par poste">
      <ul className="grid gap-3 text-sm">
        {rows.map((r) => {
          const avail = r.planned + r.carry, left = avail - r.actual, pct = avail > 0 ? Math.min(1, r.actual / avail) : 1
          return (
            <li key={r.categoryId}>
              <div className="flex justify-between gap-2"><span className="truncate">{label(r.categoryId)}</span><span className={cn('tabular-nums', left < 0 && 'text-destructive')}>{left < 0 ? `dépassé de ${formatMoney(-left)}` : formatMoney(left)}</span></div>
              <div className="mt-1 h-1 rounded-full bg-muted"><div className={cn('h-full rounded-full', left < 0 ? 'bg-[var(--viz-critical)]' : 'bg-[var(--viz-1)]')} style={{ width: `${pct * 100}%` }} /></div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/** Seulement ce qui demande d'agir (découvert, dépassement, salaire pas reçu, doublon) ; les simples rappels sont déjà dans la liste. */
function Alerts() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => an.alerts(db, today()).filter((a) => !a.id.startsWith('decouvert-mois') && (a.severity === 'critique' || a.type === 'revenu' || a.type === 'anomalie' && a.title === 'Doublon probable')).slice(0, 2), [db, version])
  if (!list.length) return null
  return (
    <ul className="grid gap-2">
      {list.map((a) => {
        const Icon = a.severity === 'critique' ? OctagonAlert : AlertTriangle
        return (
          <li key={a.id} className={cn('flex items-start gap-2.5 rounded-xl border p-3 text-sm', a.severity === 'critique' ? 'border-destructive/50' : 'border-amber-400/60')}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', a.severity === 'critique' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400')} aria-label={a.severity === 'critique' ? 'Critique' : 'Attention'} />
            <a href={a.href} className="min-w-0 flex-1"><span className="font-medium">{a.title}</span><span className="block text-xs text-muted-foreground">{a.body}</span></a>
            <Button size="icon-xs" variant="ghost" aria-label={`Masquer l’alerte ${a.title}`} onClick={() => mutate((d) => an.dismissAlert(d, a.id), { undoable: false })}><X /></Button>
          </li>
        )
      })}
    </ul>
  )
}

/** Une seule ligne « prochaine étape » tant que l'essentiel n'est pas en place, puis le rappel de sauvegarde. */
function NextStep() {
  const { db, version } = useDb()
  const step = useMemo(() => {
    const has = (q: string) => ((db as unknown as { $client: { exec: (s: string) => { values: unknown[][] }[] } }).$client.exec(q)[0]?.values[0]?.[0] as number) > 0
    const lastBackup = getSetting<string>(db, 'lastBackup')
    const todo: [string, string][] = [
      ...(!has('select count(*) from recurring') ? [['Ajoute ton salaire et tes charges avec leur date', '#/recurrences'] as [string, string]] : []),
      ...(!has('select count(*) from budget_line') ? [['Ajoute ton budget : courses, sorties…', '#/budget'] as [string, string]] : []),
      ...(!lastBackup || daysBetween(lastBackup, today()) > 30 ? [['Télécharge une sauvegarde chiffrée de tes données', '#/reglages'] as [string, string]] : []),
    ]
    return todo[0] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  if (!step || getSetting<boolean>(db, 'onboardingDone')) return null
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm">
      <a href={step[1]} className="flex flex-1 items-center gap-1"><span className="text-muted-foreground">Prochaine étape :</span> {step[0]} <ChevronRight className="size-4" /></a>
      <Button size="xs" variant="ghost" onClick={() => mutate((d) => putSetting(d, 'onboardingDone', true), { undoable: false })}>Plus tard</Button>
    </div>
  )
}

export function HomePage() {
  const accounts = useAccounts()
  if (!accounts.length) return <Empty>Bienvenue ! Commence par <a className="underline" href="#/comptes">ajouter ton compte</a> avec son solde actuel.</Empty>
  return (
    <div className="mx-auto grid max-w-3xl gap-5 pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:pb-0">
      <h1 className="sr-only">Aperçu</h1>
      <Balance />
      <Alerts />
      <Forecast />
      <div className="grid gap-4 md:grid-cols-2">
        <Due />
        <Envelopes />
      </div>
      <NextStep />
    </div>
  )
}
