import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseAmount } from '@/core/money'
import { totalBalance } from '@/db/budgetRepo'
import { today } from '@/core/dates'
import { ACCOUNT_TYPES } from '@/db/schema'
import * as repo from '@/db/repo'
import { mutate, useDb } from '@/app/store'
import { attempt, Empty, Money, PageHeader, useAccounts } from '@/app/ui'

export const TYPE_LABEL: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  courant: 'Courant', epargne: 'Épargne', carte: 'Carte', especes: 'Espèces', credit: 'Crédit', investissement: 'Investissement',
}

function AccountDialog({ acc, onClose }: { acc: repo.Account | null; onClose: () => void }) {
  const [name, setName] = useState(acc?.name ?? ''), [type, setType] = useState<repo.Account['type']>(acc?.type ?? 'courant')
  const [currency, setCurrency] = useState(acc?.currency ?? 'EUR'), [bank, setBank] = useState(acc?.bank ?? '')
  const [opening, setOpening] = useState(acc ? (acc.openingBalance / 100).toFixed(2).replace('.', ',') : '0')
  // nouveau compte : on saisit le solde du jour ; les opérations importées d'avant ne s'y ajoutent pas une 2e fois
  const [balanceDate, setBalanceDate] = useState(acc ? (acc.balanceDate ?? '') : today())
  function save() {
    const cents = parseAmount(opening)
    if (cents === null) return attempt(() => { throw new Error('Solde initial illisible') })
    const cur = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) return attempt(() => { throw new Error('Devise : code ISO à 3 lettres (EUR, USD…)') })
    const v = { name: name.trim(), type, currency: cur, bank: bank.trim() || null, openingBalance: cents, balanceDate: balanceDate || null }
    const ok = attempt(() => mutate((d) => acc ? repo.updateAccount(d, acc.id, v) : repo.createAccount(d, v)), acc ? 'Compte modifié' : 'Compte créé')
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{acc ? 'Modifier le compte' : 'Nouveau compte'}</DialogTitle></DialogHeader>
        <form id="accform" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="grid gap-1.5"><Label htmlFor="an">Nom</Label><Input id="an" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="at">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as repo.Account['type'])}>
                <SelectTrigger id="at" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="ac">Devise</Label><Input id="ac" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} disabled={!!acc} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ab">Banque</Label><Input id="ab" value={bank} onChange={(e) => setBank(e.target.value)} /></div>
            <span />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ao">Solde</Label><Input id="ao" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ad">au</Label><Input id="ad" type="date" value={balanceDate} onChange={(e) => setBalanceDate(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Le solde que t’indique ta banque à cette date. Toutes les opérations, d’avant comme d’après, sont ensuite recalculées autour. Sans date : solde d’avant la toute première opération.</p>
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {acc ? <div className="flex gap-2">
            <Button variant="outline" onClick={() => { mutate((d) => repo.updateAccount(d, acc.id, { archived: !acc.archived })); onClose() }}>{acc.archived ? 'Désarchiver' : 'Archiver'}</Button>
            <Button variant="destructive" onClick={() => { if (confirm(`Supprimer « ${acc.name} » et toutes ses opérations ?`)) { mutate((d) => repo.deleteAccount(d, acc.id), { label: `Suppression du compte ${acc.name}` }); onClose() } }}>Supprimer</Button>
          </div> : <span />}
          <Button type="submit" form="accform">Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AccountsPage() {
  const { db, version } = useDb()
  const accounts = useAccounts()
  const [editing, setEditing] = useState<repo.Account | null | 'new'>(null)
  const bal = useMemo(() => {
    return { b: repo.balances(db), total: totalBalance(db) } // total en EUR au dernier taux connu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, accounts])

  return (
    <>
      <PageHeader title="Comptes"><Button onClick={() => setEditing('new')}>Nouveau compte</Button></PageHeader>
      {accounts.length === 0 ? <Empty>Aucun compte. Crée ton compte courant pour commencer.</Empty> : <>
        <p className="mb-4 text-sm text-muted-foreground">Total (comptes actifs, en EUR) : <Money cents={bal.total} className="text-lg font-semibold text-foreground" colored={false} /></p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setEditing(a)} className={`w-full rounded-lg border bg-card p-4 text-left hover:bg-muted/40 ${a.archived ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{TYPE_LABEL[a.type]}{a.bank ? ` · ${a.bank}` : ''}{a.archived ? ' · archivé' : ''}</div></div>
                  <Money cents={bal.b.get(a.id) ?? 0} currency={a.currency} className="font-semibold" colored={false} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </>}
      {editing && <AccountDialog acc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}
