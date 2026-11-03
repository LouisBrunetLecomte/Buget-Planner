import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { axisEuro, axisProps, ChartTooltip, gridProps, monthShort, TableView } from '@/components/charts'
import { addMonths, monthOf, today } from '@/core/dates'
import { amortize, paymentFor, payoffPlan } from '@/core/debt'
import { formatMoney, parseAmount } from '@/core/money'
import * as p from '@/db/planningRepo'
import { mutate, useDb } from '@/app/store'
import { AccountSelect, attempt, Empty, Money, PageHeader } from '@/app/ui'

const money = (s: string) => { const v = parseAmount(s); if (v === null || v < 0) throw new Error('Montant invalide'); return v }
const pct = (s: string) => { const v = Number(s.replace(',', '.')); if (!(v >= 0 && v < 100)) throw new Error('Taux invalide'); return v }

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="h-2 rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, value * 100)}%`, background: 'var(--viz-1)' }} />
    </div>
  )
}

// ---------- objectifs ----------
function Goals() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const goals = useMemo(() => p.goalsStatus(db, today()), [db, version])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => p.savingsRuleAmounts(db, addMonths(monthOf(today()), -1)), [db, version])
  const [name, setName] = useState(''), [target, setTarget] = useState(''), [deadline, setDeadline] = useState(''), [accountId, setAccountId] = useState<string | null>(null)
  const [ruleKind, setRuleKind] = useState<'arrondi' | 'pourcentage'>('arrondi'), [ruleValue, setRuleValue] = useState('1'), [ruleGoal, setRuleGoal] = useState<string>('')
  const goalName = (id: string) => goals.find((x) => x.g.id === id)?.g.name ?? '?'

  return (
    <div className="grid gap-4">
      <form className="grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-[1fr_9rem_10rem_12rem_auto]" onSubmit={(e) => {
        e.preventDefault()
        if (attempt(() => mutate((d) => p.createGoal(d, { name: name.trim(), target: money(target), deadline: deadline || null, accountId })), 'Objectif créé')) { setName(''); setTarget(''); setDeadline('') }
      }}>
        <Input aria-label="Nom de l’objectif" placeholder="Nouvel objectif (vacances, apport…)" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input aria-label="Montant cible" placeholder="Cible €" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} required />
        <Input aria-label="Échéance" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <AccountSelect value={accountId} onChange={setAccountId} allLabel="Versements manuels" />
        <Button type="submit">Ajouter</Button>
      </form>
      {!goals.length ? <Empty>Aucun objectif. Fixe-toi une cible et une date : l’app calcule combien mettre de côté chaque mois.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {goals.map(({ g, current, pct: v, monthly }) => (
            <li key={g.id}><Card size="sm"><CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div><CardTitle>{g.name}</CardTitle><CardDescription>{g.deadline ? `avant le ${new Date(g.deadline).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}` : 'sans échéance'}{g.accountId ? ' · suit le solde du compte lié' : ''}</CardDescription></div>
                <Button size="xs" variant="ghost" onClick={() => { if (confirm(`Supprimer l’objectif « ${g.name} » ?`)) mutate((d) => p.deleteGoal(d, g.id)) }}>Supprimer</Button>
              </div>
              <div className="mt-2 flex justify-between text-sm"><Money cents={current} colored={false} className="font-medium" /><span className="text-muted-foreground">sur {formatMoney(g.target)} · {Math.round(v * 100)} %</span></div>
              <Meter value={v} label={`Avancement ${g.name}`} />
              {monthly !== null && <CardDescription className="text-xs">{monthly === 0 ? 'Objectif atteint 🎉' : `Mets de côté ${formatMoney(monthly)} par mois pour y arriver.`}</CardDescription>}
              {!g.accountId && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget), v2 = String(f.get('c') ?? '')
                  if (attempt(() => mutate((d) => p.addContribution(d, g.id, today(), money(v2))), 'Versement ajouté')) e.currentTarget.reset()
                }}>
                  <Input name="c" aria-label={`Versement sur ${g.name}`} placeholder="Versement €" inputMode="decimal" className="w-32" />
                  <Button size="sm" type="submit" variant="outline">Verser</Button>
                </form>
              )}
            </CardHeader></Card></li>
          ))}
        </ul>
      )}
      <Card>
        <CardHeader><CardTitle>Règles d’épargne</CardTitle><CardDescription>Ce que chaque règle propose de verser, d’après le mois dernier.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {rules.map(({ r, amount }) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{r.kind === 'arrondi' ? `Arrondi à ${r.value / 100} €` : `${r.value} % des revenus`}</Badge>
              <span>→ {goalName(r.goalId)} : <Money cents={amount} colored={false} className="font-medium" /></span>
              <Button size="xs" disabled={!amount} onClick={() => attempt(() => mutate((d) => p.addContribution(d, r.goalId, today(), amount, r.kind)), 'Versement ajouté')}>Verser</Button>
              <Button size="xs" variant="ghost" onClick={() => mutate((d) => p.deleteSavingsRule(d, r.id))}>Supprimer</Button>
            </div>
          ))}
          {goals.length > 0 && (
            <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => {
              e.preventDefault()
              const v = Number(ruleValue.replace(',', '.'))
              if (!ruleGoal || !(v > 0)) return toast.error('Choisis un objectif et une valeur')
              mutate((d) => p.createSavingsRule(d, { kind: ruleKind, value: ruleKind === 'arrondi' ? Math.round(v * 100) : v, goalId: ruleGoal }))
            }}>
              <Select value={ruleKind} onValueChange={(v) => setRuleKind(v as typeof ruleKind)}>
                <SelectTrigger aria-label="Type de règle" className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="arrondi">Arrondi supérieur à (€)</SelectItem><SelectItem value="pourcentage">Pourcentage des revenus (%)</SelectItem></SelectContent>
              </Select>
              <Input aria-label="Valeur" className="w-20" inputMode="decimal" value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} />
              <Select value={ruleGoal} onValueChange={setRuleGoal}>
                <SelectTrigger aria-label="Objectif" className="w-48"><SelectValue placeholder="vers l’objectif…" /></SelectTrigger>
                <SelectContent>{goals.filter((x) => !x.g.accountId).map((x) => <SelectItem key={x.g.id} value={x.g.id}>{x.g.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" type="submit" variant="outline">Ajouter la règle</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- dettes ----------
function DebtCard({ d }: { d: p.Debt }) {
  const [extra, setExtra] = useState(''), [lump, setLump] = useState(''), [open, setOpen] = useState(false)
  const base = useMemo(() => amortize(p.toLoan({ ...d, extraMonthly: 0 })), [d])
  const sim = useMemo(() => {
    const e = parseAmount(extra) ?? 0, l = parseAmount(lump) ?? 0
    if (!e && !l) return null
    // le supplément démarre ce mois-ci, pas au début du prêt
    const cur = monthOf(today())
    const lumps = [...(e ? Array.from({ length: 600 }, (_, k) => ({ month: addMonths(cur, k), amount: e })) : []), ...(l ? [{ month: cur, amount: l }] : [])]
    try { return amortize({ ...p.toLoan({ ...d, extraMonthly: 0 }), lumpSums: lumps }) } catch { return null }
  }, [d, extra, lump])
  const interest = (r: typeof base) => r.reduce((s, x) => s + x.interest, 0)
  const cur = monthOf(today())
  const remaining = base.find((r) => r.month === addMonths(cur, -1))?.balance ?? (cur <= d.startMonth ? d.principal : 0)
  const left = base.filter((r) => r.month >= cur)
  return (
    <Card size="sm"><CardHeader>
      <div className="flex items-start justify-between gap-2">
        <div><CardTitle>{d.name}</CardTitle><CardDescription>{formatMoney(d.principal)} à {d.rate.toString().replace('.', ',')} % · {formatMoney(d.payment)}/mois · fin {monthShort(base.at(-1)!.month)}</CardDescription></div>
        <Button size="xs" variant="ghost" onClick={() => { if (confirm(`Supprimer « ${d.name} » ?`)) mutate((x) => p.deleteDebt(x, d.id)) }}>Supprimer</Button>
      </div>
      <div className="mt-2 flex justify-between text-sm"><span>Reste dû <Money cents={remaining} colored={false} className="font-medium" /></span><span className="text-muted-foreground">{left.length} mensualités · {formatMoney(interest(left))} d’intérêts restants</span></div>
      <Meter value={1 - remaining / d.principal} label={`Remboursé ${d.name}`} />
      <fieldset className="mt-3 grid gap-2 rounded-md border p-2 text-sm">
        <legend className="px-1 font-medium">Remboursement anticipé</legend>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="En plus chaque mois" placeholder="+ € par mois" className="w-32" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <Input aria-label="Versement ponctuel ce mois-ci" placeholder="ponctuel € ce mois" className="w-40" inputMode="decimal" value={lump} onChange={(e) => setLump(e.target.value)} />
        </div>
        {sim && <p>Fin en {monthShort(sim.at(-1)!.month)} : <strong>{base.length - sim.length} mois</strong> plus tôt, <strong>{formatMoney(interest(base) - interest(sim))}</strong> d’intérêts économisés.</p>}
      </fieldset>
      <Button size="xs" variant="link" className="justify-start px-0" onClick={() => setOpen(!open)}>{open ? 'Masquer' : 'Voir'} le tableau d’amortissement</Button>
      {open && (
        <div className="max-h-64 overflow-auto text-xs">
          <table className="w-full tabular-nums"><thead className="sticky top-0 bg-card text-left text-muted-foreground"><tr><th className="p-1">Mois</th><th className="p-1 text-right">Mensualité</th><th className="p-1 text-right">Intérêts</th><th className="p-1 text-right">Capital</th><th className="p-1 text-right">Reste dû</th></tr></thead>
            <tbody>{base.map((r) => <tr key={r.month} className={r.month === cur ? 'bg-muted font-medium' : 'border-t'}><td className="p-1">{r.month}</td><td className="p-1 text-right">{formatMoney(r.payment)}</td><td className="p-1 text-right">{formatMoney(r.interest)}</td><td className="p-1 text-right">{formatMoney(r.principal)}</td><td className="p-1 text-right">{formatMoney(r.balance)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </CardHeader></Card>
  )
}

function Debts() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debts = useMemo(() => p.listDebts(db), [db, version])
  const [f, setF] = useState({ name: '', principal: '', rate: '', months: '', start: monthOf(today()) })
  const [extra, setExtra] = useState('100')
  const plans = useMemo(() => {
    const cur = monthOf(today())
    const lite = debts.map((d) => ({ id: d.id, name: d.name, rate: d.rate, payment: d.payment, balance: p.debtBalanceAt(d, addMonths(cur, -1)) || (cur <= d.startMonth ? d.principal : 0) })).filter((d) => d.balance > 0)
    if (lite.length < 2) return null
    const x = parseAmount(extra) ?? 0
    try { return { boule: payoffPlan(lite, x, 'boule'), avalanche: payoffPlan(lite, x, 'avalanche') } } catch { return null }
  }, [debts, extra])
  return (
    <div className="grid gap-4">
      <form className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 md:grid-cols-[1fr_8rem_6rem_7rem_9rem_auto]" onSubmit={(e) => {
        e.preventDefault()
        const ok = attempt(() => {
          const principal = money(f.principal), rate = pct(f.rate), months = Number(f.months)
          if (!(months > 0 && months <= 600)) throw new Error('Durée invalide (en mois)')
          return mutate((d) => p.createDebt(d, { name: f.name.trim(), principal, rate, payment: paymentFor(principal, rate, months), startMonth: f.start }))
        }, 'Crédit ajouté')
        if (ok) setF({ ...f, name: '', principal: '', rate: '', months: '' })
      }}>
        <Input className="col-span-2 md:col-span-1" aria-label="Nom du crédit" placeholder="Crédit (immobilier, auto…)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <Input aria-label="Montant emprunté" placeholder="Emprunté €" inputMode="decimal" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} required />
        <Input aria-label="Taux annuel" placeholder="Taux %" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required />
        <Input aria-label="Durée en mois" placeholder="Durée (mois)" type="number" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} required />
        <Input aria-label="Première échéance" type="month" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required />
        <Button type="submit">Ajouter</Button>
      </form>
      {!debts.length ? <Empty>Aucun crédit. Ajoute-en un pour voir son tableau d’amortissement et simuler un remboursement anticipé.</Empty>
        : <div className="grid gap-3 md:grid-cols-2">{debts.map((d) => <DebtCard key={d.id} d={d} />)}</div>}
      {plans && (
        <Card><CardHeader><CardTitle>Boule de neige ou avalanche ?</CardTitle>
          <CardDescription>En consacrant chaque mois <Input aria-label="Budget supplémentaire mensuel" className="inline-flex h-7 w-24" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} /> € de plus au remboursement :</CardDescription></CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            {(['boule', 'avalanche'] as const).map((k) => (
              <div key={k} className="rounded-md border p-3">
                <div className="font-medium">{k === 'boule' ? 'Boule de neige (plus petit solde d’abord)' : 'Avalanche (taux le plus élevé d’abord)'}</div>
                <p>Libéré dans {plans[k].months} mois · {formatMoney(plans[k].totalInterest)} d’intérêts</p>
                <ol className="ml-4 list-decimal text-muted-foreground">{plans[k].payoff.map((x) => <li key={x.id}>{x.name} : mois {x.month}</li>)}</ol>
              </div>
            ))}
            <p className="text-muted-foreground md:col-span-2">L’avalanche coûte le moins d’intérêts ; la boule de neige donne des victoires plus rapides.</p>
          </CardContent></Card>
      )}
    </div>
  )
}

// ---------- patrimoine ----------
const ASSET_KIND = { immobilier: 'Immobilier', investissement: 'Placement', vehicule: 'Véhicule', autre: 'Autre' } as const
function NetWorth() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nw = useMemo(() => p.netWorth(db, today()), [db, version])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hist = useMemo(() => p.netWorthHistory(db, today()), [db, version])
  const [name, setName] = useState(''), [kind, setKind] = useState<p.Asset['kind']>('investissement'), [value, setValue] = useState('')
  const data = hist.map((h) => ({ month: h.month, net: h.net / 100 }))
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardDescription>Patrimoine net</CardDescription><CardTitle className="text-4xl font-semibold"><Money cents={nw.net} colored={false} /></CardTitle>
          <CardDescription>{formatMoney(nw.accounts)} sur les comptes + {formatMoney(nw.assetsTotal)} de biens et placements − {formatMoney(nw.debtsTotal)} de crédits</CardDescription></CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" tickFormatter={monthShort} {...axisProps} />
                <YAxis tickFormatter={axisEuro} width={48} {...axisProps} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip labelFormat={monthShort} />} />
                <Line dataKey="net" name="Patrimoine net" stroke="var(--viz-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <TableView head={['Mois', 'Comptes', 'Biens', 'Crédits', 'Net']} rows={hist.map((h) => [monthShort(h.month), formatMoney(h.accounts), formatMoney(h.assets), formatMoney(-h.debts), formatMoney(h.net)])} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Biens et placements</CardTitle><CardDescription>Mets à jour la valeur quand tu veux (relevé d’assurance-vie, estimation immobilière…).</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          {nw.assets.map(({ a, value: v }) => (
            <form key={a.id} className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => {
              e.preventDefault()
              const s = String(new FormData(e.currentTarget).get('v') ?? '')
              if (attempt(() => mutate((d) => p.setAssetValue(d, a.id, today(), money(s))), 'Valeur mise à jour')) e.currentTarget.reset()
            }}>
              <span className="min-w-32 flex-1"><span className="font-medium">{a.name}</span> <Badge variant="outline">{ASSET_KIND[a.kind]}</Badge></span>
              <Money cents={v} colored={false} />
              <Input name="v" aria-label={`Nouvelle valeur de ${a.name}`} placeholder="Nouvelle valeur" inputMode="decimal" className="w-32" />
              <Button size="xs" type="submit" variant="outline">Mettre à jour</Button>
              <Button size="xs" type="button" variant="ghost" onClick={() => { if (confirm(`Supprimer « ${a.name} » ?`)) mutate((d) => p.deleteAsset(d, a.id)) }}>Supprimer</Button>
            </form>
          ))}
          <form className="flex flex-wrap gap-2 border-t pt-3" onSubmit={(e) => {
            e.preventDefault()
            if (attempt(() => mutate((d) => p.createAsset(d, name.trim(), kind, money(value), today())), 'Ajouté')) { setName(''); setValue('') }
          }}>
            <Input aria-label="Nom du bien" placeholder="Bien ou placement" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} required />
            <Select value={kind} onValueChange={(v) => setKind(v as p.Asset['kind'])}>
              <SelectTrigger aria-label="Type" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ASSET_KIND).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
            <Input aria-label="Valeur" placeholder="Valeur €" inputMode="decimal" className="w-28" value={value} onChange={(e) => setValue(e.target.value)} required />
            <Button type="submit">Ajouter</Button>
          </form>
          {nw.debts.length > 0 && <div className="border-t pt-3 text-sm">{nw.debts.map(({ d, balance }) => <div key={d.id} className="flex justify-between"><span>{d.name}</span><Money cents={-balance} /></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  )
}

export function PatrimoinePage() {
  return (
    <>
      <PageHeader title="Épargne, crédits et patrimoine" />
      <Tabs defaultValue="goals">
        <TabsList className="mb-3"><TabsTrigger value="goals">Objectifs</TabsTrigger><TabsTrigger value="debts">Crédits</TabsTrigger><TabsTrigger value="nw">Patrimoine</TabsTrigger></TabsList>
        <TabsContent value="goals"><Goals /></TabsContent>
        <TabsContent value="debts"><Debts /></TabsContent>
        <TabsContent value="nw"><NetWorth /></TabsContent>
      </Tabs>
    </>
  )
}
