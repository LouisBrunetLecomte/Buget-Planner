import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { parseAmount, formatMoney } from '@/core/money'
import { normalizeLabel } from '@/core/labels'
import { categorize } from '@/core/rules'
import { today } from '@/core/dates'
import * as repo from '@/db/repo'
import { mutate, useDb } from '@/app/store'
import { AccountSelect, attempt, CategorySelect, Empty, Money, PageHeader, useAccounts, useCategories } from '@/app/ui'
import { TxDialog } from './TxDialog'
import { isFreelance } from '@/db/extrasRepo'

const LAST_ACCOUNT = 'budget:lastAccount' // non sensible : simple identifiant aléatoire

function QuickAdd() {
  const { db, version } = useDb()
  const accounts = useAccounts().filter((a) => !a.archived)
  const [accountId, setAccountId] = useState<string | null>(() => localStorage.getItem(LAST_ACCOUNT))
  const [amount, setAmount] = useState(''), [label, setLabel] = useState(''), [date, setDate] = useState(today())
  const [categoryId, setCategoryId] = useState<string | null>(null), [touched, setTouched] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  const acc = accounts.find((a) => a.id === accountId) ?? accounts[0]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => repo.listRules(db), [db, version])
  const suggested = acc && label ? categorize(rules, normalizeLabel(label), acc.id) : null

  // "n" n'importe où : nouvelle opération
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable)) {
        e.preventDefault(); amountRef.current?.focus()
      }
    }
    addEventListener('keydown', f); return () => removeEventListener('keydown', f)
  }, [])

  if (!acc) return null
  function submit() {
    // saisie sans signe = dépense ; "+" devant = revenu
    const raw = parseAmount(amount)
    if (raw === null || raw === 0) return toast.error('Montant illisible')
    const cents = amount.trim().startsWith('+') || amount.trim().startsWith('-') ? raw : -raw
    const ok = attempt(() => mutate((d) => repo.addTransaction(d, { accountId: acc!.id, date, amount: cents, label: label.trim() || '(saisie)', categoryId: touched ? categoryId : (suggested ?? null) }), { label: `Ajout : ${label.trim() || 'saisie'}` }))
    if (!ok) return
    localStorage.setItem(LAST_ACCOUNT, acc!.id)
    toast.success(`${formatMoney(cents, acc!.currency)} ajouté`)
    setAmount(''); setLabel(''); setCategoryId(null); setTouched(false)
    amountRef.current?.focus()
  }

  return (
    <form aria-label="Saisie rapide" className="mb-4 grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 md:grid-cols-[7rem_1fr_12rem_10rem_9rem_auto]"
      onSubmit={(e) => { e.preventDefault(); submit() }}>
      <Input ref={amountRef} aria-label="Montant (préfixe + pour un revenu)" placeholder="12,50 ou +100" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <Input aria-label="Libellé" placeholder="Libellé" value={label} onChange={(e) => setLabel(e.target.value)} />
      <CategorySelect value={touched ? categoryId : suggested} onChange={(v) => { setCategoryId(v); setTouched(true) }} placeholder="Catégorie" />
      <AccountSelect value={acc.id} onChange={(v) => v && setAccountId(v)} />
      <Input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button type="submit" className="col-span-2 md:col-span-1">Ajouter</Button>
    </form>
  )
}

const IGNORED = 'ignoredTransferPairs'

function TransferSuggestions() {
  const { db, version } = useDb()
  const accounts = useAccounts()
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?'
  const pairs = useMemo(() => {
    const ignored = new Set(repo.getSetting<string[]>(db, IGNORED) ?? [])
    return repo.transferSuggestions(db).filter(([a, b]) => !ignored.has(`${a.id}|${b.id}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
  if (!pairs.length) return null
  return (
    <details className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      <summary className="cursor-pointer font-medium">{pairs.length} virement(s) interne(s) probable(s) à confirmer</summary>
      <ul className="mt-2 grid gap-2">
        {pairs.map(([a, b]) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{a.date} · {name(a.accountId)} → {name(b.accountId)} · <Money cents={b.amountEur} colored={false} /> <span className="text-muted-foreground">({a.label} / {b.label})</span></span>
            <span className="flex gap-1">
              <Button size="sm" onClick={() => mutate((d) => repo.linkTransfer(d, [a.id, b.id]))}>C’est un virement interne</Button>
              <Button size="sm" variant="ghost" onClick={() => mutate((d) => repo.putSetting(d, IGNORED, [...(repo.getSetting<string[]>(d, IGNORED) ?? []), `${a.id}|${b.id}`]))}>Non</Button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function TransactionsPage() {
  const { db, version } = useDb()
  const accounts = useAccounts()
  const { label: catLabel } = useCategories()
  const [q, setQ] = useState(''), [accountId, setAccountId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null), [month, setMonth] = useState('')
  const [onlyUncat, setOnlyUncat] = useState(false), [scope, setScope] = useState<'all' | 'pro' | 'perso'>('all'), [showFilters, setShowFilters] = useState(false)
  const freelance = isFreelance(db)
  const [selected, setSelected] = useState<Set<string>>(new Set()), [editing, setEditing] = useState<repo.Tx | null>(null)

  const txs = useMemo(() => repo.listTransactions(db, {
    q: q.trim() || undefined, accountId: accountId ?? undefined,
    categoryId: onlyUncat ? 'none' : (categoryId ?? undefined),
    ...(month ? { from: `${month}-01`, to: `${month}-31` } : {}),
    limit: 1000,
    ...(scope !== 'all' ? { pro: scope === 'pro' } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [db, version, q, accountId, categoryId, month, onlyUncat, scope])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const splitIds = useMemo(() => repo.listSplitTxIds(db), [db, version])
  const visibleSel = txs.filter((t) => selected.has(t.id)).map((t) => t.id)
  const running = useMemo(() => {
    const acc = accountId ? accounts.find((a) => a.id === accountId) : accounts.filter((a) => !a.archived).length === 1 ? accounts.find((a) => !a.archived) : undefined
    if (!acc || q.trim() || categoryId || month || onlyUncat || scope !== 'all') return null
    // on part du solde actuel et on remonte le temps ; ce qui précède la date du solde saisi y est déjà compris
    let bal = repo.balances(db).get(acc.id) ?? 0
    const out = new Map<string, number>()
    for (const t of txs) {
      if (t.accountId !== acc.id) continue
      out.set(t.id, bal)
      const counted = !acc.balanceDate || t.date > acc.balanceDate || (t.date === acc.balanceDate && !t.importKey)
      if (counted) bal -= t.amount
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, txs, accountId, accounts, q, categoryId, month, onlyUncat, scope])

  if (!accounts.length) return <><PageHeader title="Journal" /><Empty>Crée d’abord un compte dans l’onglet <a className="underline" href="#/comptes">Comptes</a>.</Empty></>

  return (
    <>
      <PageHeader title="Journal" subtitle="Toutes tes opérations, comme sur un relevé : débit, crédit et solde." />
      <QuickAdd />
      <TransferSuggestions />
      {/* recherche toujours visible ; les autres filtres seulement sur demande */}
      <div className="mb-3 flex gap-2">
        <Input type="search" aria-label="Rechercher" placeholder="Rechercher (libellé, note, montant)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant={showFilters || accountId || categoryId || month || onlyUncat ? 'secondary' : 'outline'} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>Filtres</Button>
      </div>
      {showFilters && (
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-[12rem_14rem_10rem_auto]">
          <AccountSelect value={accountId} onChange={setAccountId} allLabel="Tous les comptes" />
          <CategorySelect value={categoryId} onChange={setCategoryId} allowNone={false} placeholder="Toutes catégories" />
          <Input type="month" aria-label="Mois" value={month} onChange={(e) => setMonth(e.target.value)} />
          <label className="col-span-2 flex items-center gap-2 text-sm md:col-span-1"><Checkbox checked={onlyUncat} onCheckedChange={(v) => setOnlyUncat(v === true)} />Non catégorisées</label>
          {freelance && (
            <div className="col-span-2 flex gap-1 md:col-span-4" role="group" aria-label="Pro ou perso">
              {(['all', 'perso', 'pro'] as const).map((k) => <Button key={k} size="xs" variant={scope === k ? 'default' : 'outline'} aria-pressed={scope === k} onClick={() => setScope(k)}>{{ all: 'Tout', perso: 'Perso', pro: 'Pro' }[k]}</Button>)}
            </div>
          )}
        </div>
      )}
      {(categoryId || accountId || month || q || onlyUncat) && (
        <Button variant="link" size="sm" className="mb-2 px-0" onClick={() => { setQ(''); setAccountId(null); setCategoryId(null); setMonth(''); setOnlyUncat(false) }}>Effacer les filtres</Button>
      )}

      {visibleSel.length > 0 && (
        <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-sm">
          <span className="text-sm">{visibleSel.length} sélectionnée(s)</span>
          <div className="w-56"><CategorySelect value={null} placeholder="Catégoriser en…" onChange={(c) => { mutate((d) => repo.setCategoryBulk(d, visibleSel, c), { label: `Catégorisation de ${visibleSel.length} opération(s)` }); setSelected(new Set()) }} /></div>
          <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Supprimer ${visibleSel.length} opération(s) ?`)) { mutate((d) => repo.deleteTransactions(d, visibleSel), { label: `Suppression de ${visibleSel.length} opération(s)` }); setSelected(new Set()) } }}>Supprimer</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Annuler</Button>
        </div>
      )}

      {txs.length === 0 ? <Empty>Aucune opération. Ajoute-en une ci-dessus ou <a className="underline" href="#/import">importe un relevé</a>.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 pb-2"><Checkbox aria-label="Tout sélectionner" checked={visibleSel.length === txs.length} onCheckedChange={(v) => setSelected(v === true ? new Set(txs.map((t) => t.id)) : new Set())} /></th>
                <th className="pb-2 font-normal">Date</th><th className="pb-2 font-normal">Libellé</th><th className="hidden pb-2 font-normal md:table-cell">Catégorie</th>
                <th className="pb-2 text-right font-normal">Débit</th><th className="pb-2 text-right font-normal">Crédit</th>
                {running && <th className="hidden pb-2 pl-4 text-right font-normal sm:table-cell">Solde</th>}
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t border-border/70 hover:bg-secondary/60" onClick={() => setEditing(t)}>
                  <td className="py-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Sélectionner ${t.label}`} checked={selected.has(t.id)} onCheckedChange={(v) => { const s = new Set(selected); if (v === true) s.add(t.id); else s.delete(t.id); setSelected(s) }} />
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3 tabular-nums text-muted-foreground">{new Date(t.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</td>
                  <td className="max-w-[18rem] py-3 pr-3">
                    <button type="button" className="block w-full truncate text-left" onClick={(e) => { e.stopPropagation(); setEditing(t) }}>{t.label}</button>
                    <span className="block truncate text-xs text-muted-foreground md:hidden">{t.transferGroupId ? 'Virement interne' : splitIds.has(t.id) ? 'Ventilée' : catLabel(t.categoryId) ?? 'À catégoriser'}</span>
                    {t.notes && <span className="block truncate text-xs text-muted-foreground">{t.notes}</span>}
                  </td>
                  <td className="hidden py-3 pr-3 text-muted-foreground md:table-cell">
                    {t.transferGroupId ? 'Virement interne' : splitIds.has(t.id) ? 'Ventilée' : t.categoryId ? catLabel(t.categoryId) : <span className="text-amber-700 dark:text-amber-400">À catégoriser</span>}
                  </td>
                  <td className="py-3 text-right tabular-nums">{t.amount < 0 ? formatMoney(-t.amount, t.currency) : ''}</td>
                  <td className="py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{t.amount > 0 ? formatMoney(t.amount, t.currency) : ''}</td>
                  {running && <td className="hidden py-3 pl-4 text-right tabular-nums sm:table-cell">{running.get(t.id) !== undefined ? formatMoney(running.get(t.id)!, t.currency) : ''}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-foreground/20 font-medium"><td colSpan={4} className="py-3">Total affiché (hors virements internes)</td>
              <td className="py-3 text-right tabular-nums">{formatMoney(txs.filter((t) => !t.transferGroupId && t.amountEur < 0).reduce((x, t) => x - t.amountEur, 0))}</td>
              <td className="py-3 text-right tabular-nums">{formatMoney(txs.filter((t) => !t.transferGroupId && t.amountEur > 0).reduce((x, t) => x + t.amountEur, 0))}</td>
              {running && <td className="hidden sm:table-cell" />}</tr></tfoot>
          </table>
        </div>
      )}
      {editing && <TxDialog tx={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
