import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, OctagonAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { addDays, daysBetween, today } from '@/core/dates'
import { formatMoney } from '@/core/money'
import * as b from '@/db/budgetRepo'
import * as an from '@/db/analyticsRepo'
import { balances, confirmBalance, getSetting, putSetting } from '@/db/repo'
import { liquidProjection } from '@/db/analyticsRepo'
import { periodEnd } from '@/core/period'
import { parseAmount } from '@/core/money'
import { Input } from '@/components/ui/input'
import { mutate, useDb } from '@/app/store'
import { attempt, Empty, useAccounts, useCategories } from '@/app/ui'
import { cn } from '@/lib/utils'

const fmtDay = (d: string) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const Section = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => (
  <section className={cn('rounded-2xl border bg-card p-5', className)}><h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>{children}</section>
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
    const after = x.liquid - x.dated - x.envelopes
    return { bal, x, after, perDay: Math.floor(after / x.daysLeft), payday: addDays(x.end, 1) }
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
    <section className="rounded-2xl border bg-card px-5 py-8 text-center">
      <p className="text-sm text-muted-foreground">{accounts.length > 1 ? 'Sur tes comptes' : 'Sur ton compte'}</p>
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
        <button type="button" onClick={startEdit} className="my-1 block w-full text-5xl font-semibold tracking-tight" title="Corriger avec le montant de ta banque">{formatMoney(d.x.liquid)}</button>
      )}
      {!editing && (stale
        ? <button type="button" onClick={startEdit} className="text-sm text-amber-700 underline dark:text-amber-400">Vérifie ce montant avec ta banque et corrige-le si besoin</button>
        : <p className="text-xs text-muted-foreground">Confirmé le {new Date(last!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })} · touche le montant pour le corriger</p>)}
      <p className={cn('mt-4 text-sm', d.after < 0 ? 'text-destructive' : 'text-muted-foreground')}>
        Après tes charges et ton budget : <strong className="font-medium text-foreground">{formatMoney(d.after)}</strong>
        {d.after > 0 && <> · {formatMoney(d.perDay)} par jour</>} jusqu’au {fmtDay(d.payday)}
      </p>
      {d.x.incoming > 0 && <p className="mt-1 text-xs text-muted-foreground">+ {formatMoney(d.x.incoming)} attendus, pas encore reçus</p>}
    </section>
  )
}

/** Ton solde avant chaque paie, sur 6 mois : un clic ouvre le budget du mois pour l'ajuster. */
function Forecast() {
  const { db, version } = useDb()
  const rows = useMemo(() => {
    const day = b.periodDay(db)
    return liquidProjection(db, today(), 6).map((p) => ({ ...p, end: periodEnd(p.month, day) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  const short = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <Section title="Prévisions : ton solde avant chaque paie">
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {rows.map((r) => (
          <li key={r.month}>
            <a href={`#/budget?m=${r.month}`} className={cn('block rounded-xl border p-2.5 text-center hover:bg-muted', r.balance < 0 && 'border-destructive/60')}>
              <span className="block text-xs text-muted-foreground">{short(r.end)}</span>
              <span className={cn('block text-sm font-medium tabular-nums', r.balance < 0 && 'text-destructive')}>{formatMoney(r.balance)}</span>
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">D’après ton budget et tes échéances. Clique sur un mois pour le modifier (vacances, prime…).</p>
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
                  <Checkbox aria-label={`${o.recurring.name} ${verb}`} onCheckedChange={(v) => v === true && attempt(() => mutate((d) => b.tickOccurrence(d, o.recurring.id, o.date, today()), { label: `${o.recurring.name} ${verb}` }), `${o.recurring.name} : ${verb}`)} />
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
  const { label } = useCategories()
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
    <div className="mx-auto grid max-w-3xl gap-4">
      <h1 className="sr-only">Accueil</h1>
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
