import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { parseAmount } from '@/core/money'
import { today } from '@/core/dates'
import type { Freq } from '@/core/recurring'
import { RECURRING_KINDS } from '@/db/schema'
import * as b from '@/db/budgetRepo'
import { mutate } from '@/app/store'
import { AccountSelect, attempt, CategorySelect } from '@/app/ui'

export const KIND_LABEL = { revenu: 'Revenu', charge: 'Charge fixe', abonnement: 'Abonnement' } as const
const PRESETS: Record<string, [Freq, number]> = { hebdo: ['week', 1], mensuel: ['month', 1], trimestriel: ['month', 3], semestriel: ['month', 6], annuel: ['year', 1] }

export function freqLabel(freq: Freq, interval: number): string {
  const p = Object.entries(PRESETS).find(([, [f, i]]) => f === freq && i === interval)
  if (p) return p[0][0]!.toUpperCase() + p[0].slice(1)
  return `Tous les ${interval} ${{ week: 'semaines', month: 'mois', year: 'ans' }[freq]}`
}

export type RecurringDraft = Partial<b.Recurring>

export function RecurringDialog({ draft, onClose }: { draft: RecurringDraft; onClose: () => void }) {
  const [name, setName] = useState(draft.name ?? ''), [kind, setKind] = useState<b.Recurring['kind']>(draft.kind ?? 'charge')
  const [amount, setAmount] = useState(draft.amount ? (Math.abs(draft.amount) / 100).toFixed(2).replace('.', ',') : '')
  const [freq, setFreq] = useState<Freq>(draft.freq ?? 'month'), [interval, setInterval] = useState(draft.interval ?? 1)
  const [startDate, setStartDate] = useState(draft.startDate ?? today()), [endDate, setEndDate] = useState(draft.endDate ?? '')
  const [accountId, setAccountId] = useState(draft.accountId ?? null), [categoryId, setCategoryId] = useState(draft.categoryId ?? null)
  const [pattern, setPattern] = useState(draft.pattern ?? ''), [active, setActive] = useState(draft.active ?? true)
  const preset = Object.entries(PRESETS).find(([, [f, i]]) => f === freq && i === interval)?.[0] ?? 'perso'

  function save() {
    const cents = parseAmount(amount)
    if (!cents) return attempt(() => { throw new Error('Montant illisible') })
    if (endDate && endDate < startDate) return attempt(() => { throw new Error('La fin précède le début') })
    const v = { name: name.trim(), kind, amount: kind === 'revenu' ? Math.abs(cents) : -Math.abs(cents), freq, interval: Math.max(1, interval), startDate, endDate: endDate || null, accountId, categoryId, pattern: pattern.trim() || null, active }
    if (attempt(() => mutate((d) => draft.id ? b.updateRecurring(d, draft.id, v) : b.createRecurring(d, v)), draft.id ? 'Modifié' : 'Ajouté')) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{draft.id ? 'Modifier' : 'Nouvelle récurrence'}</DialogTitle></DialogHeader>
        <form id="recform" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="rn">Nom</Label><Input id="rn" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></div>
            <div className="grid gap-1.5"><Label htmlFor="rk">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as b.Recurring['kind'])}>
                <SelectTrigger id="rk" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{RECURRING_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ra">Montant (€)</Label><Input id="ra" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="rf">Fréquence</Label>
              <Select value={preset} onValueChange={(v) => { const p = PRESETS[v]; if (p) { setFreq(p[0]); setInterval(p[1]) } else if (interval === 1) setInterval(2) }}>
                <SelectTrigger id="rf" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{[...Object.keys(PRESETS), 'perso'].map((k) => <SelectItem key={k} value={k}>{k === 'perso' ? 'Personnalisée' : freqLabel(...PRESETS[k]!)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {preset === 'perso' && (
            <div className="flex items-center gap-2 text-sm">Tous les
              <Input aria-label="Intervalle" type="number" min={1} className="w-20" value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))} />
              <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
                <SelectTrigger aria-label="Unité" className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="week">semaines</SelectItem><SelectItem value="month">mois</SelectItem><SelectItem value="year">ans</SelectItem></SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="rs">Une échéance (fixe le jour)</Label><Input id="rs" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="re">Fin (optionnel)</Label><Input id="re" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="racc">Compte</Label><AccountSelect id="racc" value={accountId} onChange={setAccountId} allLabel="Tous les comptes" /></div>
            <div className="grid gap-1.5"><Label htmlFor="rc">Catégorie</Label><CategorySelect id="rc" value={categoryId} onChange={setCategoryId} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rp">Libellé bancaire contient</Label>
            <Input id="rp" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ex : NETFLIX" />
            <p className="text-xs text-muted-foreground">Sert à reconnaître les prélèvements : échéance payée, hausse de prix, paiement manquant.</p>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={active} onCheckedChange={(v) => setActive(v === true)} />Active</label>
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {draft.id ? <Button variant="destructive" onClick={() => { if (confirm(`Supprimer « ${draft.name} » ?`)) { mutate((d) => b.deleteRecurring(d, draft.id!)); onClose() } }}>Supprimer</Button> : <span />}
          <Button type="submit" form="recform">Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
