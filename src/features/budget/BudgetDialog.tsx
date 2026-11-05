import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Row, Scope } from '@/core/budget'
import { evalAmount } from '@/core/money'
import * as b from '@/db/budgetRepo'
import { mutate, useDb } from '@/app/store'
import { attempt, DaySelect, MonthPicker, useCategories } from '@/app/ui'
import { usePeriodTitle } from '@/app/periods'

export function BudgetDialog({ categoryId, month, row, onClose }: { categoryId: string; month: string; row: Row | null; onClose: () => void }) {
  const { byId, label } = useCategories()
  const { db } = useDb()
  const title = usePeriodTitle()
  const plabel = title(month) // « Novembre 2026 » : le nom de la période, d'après le jour de paie
  const cat = byId.get(categoryId)!
  // le type se corrige ici (abonnement saisi en revenu…) : la ligne change de section partout
  const [kind, setKind] = useState<'depense' | 'revenu'>(cat.kind === 'revenu' ? 'revenu' : 'depense')
  const sign = kind === 'revenu' ? 1 : -1
  const [amount, setAmount] = useState(row ? (row.planned / 100).toFixed(2).replace('.', ',') : '')
  // par défaut : « tous les mois à partir de » (mois réglable) ; l'exception d'un seul mois reste possible
  const [scope, setScope] = useState<Scope>('from'), [reason, setReason] = useState(row?.exception?.reason ?? '')
  const [fromMonth, setFromMonth] = useState(month)
  const [rollover, setRollover] = useState(cat.rollover), [bucket, setBucket] = useState(cat.bucket ?? 'none')

  // ligne calculée depuis des échéances datées : on modifie les échéances elles-mêmes (une seule source)
  const fromItems = row?.source === 'echeances' ? [...new Map(row.items.map((i) => [i.id, i])).values()] : []
  const ends = new Map(b.listRecurring(db).map((x) => [x.id, x.endDate ?? '']))
  const [itemEdits, setItemEdits] = useState(() => fromItems.map((i) => ({ id: i.id, name: i.name, amount: (Math.abs(i.amount) / 100).toFixed(2).replace('.', ','), day: Number(i.date.slice(8, 10)), end: ends.get(i.id) ?? '' })))
  const sourceMode = fromItems.length > 0 && scope !== 'month'

  const kindChanged = kind !== (cat.kind === 'revenu' ? 'revenu' : 'depense')
  function save() {
    if (sourceMode) {
      const ok = attempt(() => mutate((d) => {
        const id = kindChanged ? b.changeLineKind(d, categoryId, kind) : categoryId // passe aussi les échéances au bon signe
        for (const e of itemEdits) {
          const c = evalAmount(e.amount)
          if (c === null || c < 0) throw new Error(`Montant invalide pour ${e.name}`)
          const orig = fromItems.find((i) => i.id === e.id)!
          if (c !== Math.abs(orig.amount) || e.day !== Number(orig.date.slice(8, 10)))
            b.updateRecurringFrom(d, e.id, scope === 'all' ? '0000-01' : fromMonth, { amount: c * sign, day: e.day })
          if (e.end !== (ends.get(e.id) ?? '')) b.updateRecurring(d, e.id, { endDate: e.end || null })
        }
        b.setCategoryOptions(d, id, { rollover, bucket: bucket === 'none' ? null : bucket as 'besoin' | 'envie' })
        return true
      }, { label: `Échéances : ${label(categoryId)}` }), 'Mis à jour partout (récurrences, calendrier, prévisions)')
      if (ok) onClose()
      return
    }
    const cents = evalAmount(amount)
    if (cents === null || cents < 0) return attempt(() => { throw new Error('Montant invalide') })
    const ok = attempt(() => mutate((d) => {
      const id = kindChanged ? b.changeLineKind(d, categoryId, kind) : categoryId
      b.setBudget(d, id, scope === 'from' ? fromMonth : month, cents, scope, reason)
      b.setCategoryOptions(d, id, { rollover, bucket: bucket === 'none' ? null : bucket as 'besoin' | 'envie' })
      return true
    }, { label: `Budget : ${label(categoryId)}` }))
    if (ok) onClose()
  }
  const scopes: [Scope, string, string][] = [
    ['from', 'Chaque mois à partir de…', 'Les mois précédents gardent leur montant.'],
    ['month', `${plabel} seulement`, 'Une exception (vacances, cadeaux…) : le reste du budget ne change pas.'],
    ['all', 'Chaque mois, passé compris', 'Remplace le montant partout.'],
  ]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{label(categoryId)}</DialogTitle>
          <DialogDescription>{plabel} · {b.periodBounds(db, month).label}{row?.base != null && row.exception ? ` · modèle : ${(row.base / 100).toFixed(2)} €` : ''}</DialogDescription>
        </DialogHeader>
        <form id="bform" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="grid gap-1.5"><Label htmlFor="bk">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger id="bk" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="depense">Dépense</SelectItem><SelectItem value="revenu">Revenu</SelectItem></SelectContent>
            </Select>
          </div>
          {sourceMode ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Échéances de cette ligne</legend>
              {itemEdits.map((e, k) => (
                <div key={e.id} className="grid grid-cols-2 items-center gap-2 text-sm sm:grid-cols-[1fr_6rem_9rem_9rem]">
                  <span className="col-span-2 truncate sm:col-span-1">{e.name}</span>
                  <Input aria-label={`Montant de ${e.name}`} inputMode="decimal" value={e.amount} onChange={(ev) => setItemEdits(itemEdits.map((x, j) => (j === k ? { ...x, amount: ev.target.value } : x)))} />
                  <DaySelect value={e.day} onChange={(dd) => dd && setItemEdits(itemEdits.map((x, j) => (j === k ? { ...x, day: dd } : x)))} />
                  <Input aria-label={`Fin de ${e.name} (facultatif)`} title="Dernière échéance (facultatif)" type="date" value={e.end} onChange={(ev) => setItemEdits(itemEdits.map((x, j) => (j === k ? { ...x, end: ev.target.value } : x)))} />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Montant, jour et date de fin facultative. Ces échéances viennent de Salaire, charges et abonnements : les changer ici les change partout (calendrier, Aperçu, prévisions).</p>
            </fieldset>
          ) : (
            <div className="grid gap-1.5"><Label htmlFor="ba">{kind === 'revenu' ? 'Revenu prévu (€)' : 'Budget (€)'}</Label><Input id="ba" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required /></div>
          )}
          {fromItems.length > 0 && scope === 'month' && <p className="-mt-1 text-xs text-muted-foreground">Exception : seul le total de ce mois change, tes échéances restent identiques.</p>}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Appliquer à</legend>
            {scopes.map(([v, t, d]) => (
              <label key={v} className="flex cursor-pointer gap-2 rounded-md border p-2 text-sm has-checked:border-primary">
                <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} className="mt-0.5 accent-current" />
                <span className="grid gap-1"><span className="font-medium">{t}</span><span className="block text-xs text-muted-foreground">{d}</span>
                  {v === 'from' && scope === 'from' && <span className="flex flex-wrap items-center gap-2"><span className="w-56"><MonthPicker label="À partir de la période" value={fromMonth} onChange={(m) => m && setFromMonth(m)} format={(m) => title(m)} /></span><span className="text-xs text-muted-foreground">{b.periodBounds(db, fromMonth).label}</span></span>}
                </span>
              </label>
            ))}
          </fieldset>
          {scope === 'month' && <div className="grid gap-1.5"><Label htmlFor="br">Motif de l’exception</Label><Input id="br" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacances, cadeaux, prime…" /></div>}
          {kind === 'depense' && (
            <div className="grid grid-cols-2 items-end gap-3">
              <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox checked={rollover} onCheckedChange={(v) => setRollover(v === true)} />Reporter le reste sur le mois suivant</label>
              <div className="grid gap-1.5"><Label htmlFor="bb" title="Règle 50/30/20 : 50 % pour les besoins, 30 % pour les envies, 20 % d’épargne">Besoin ou envie</Label>
                <Select value={bucket} onValueChange={setBucket}>
                  <SelectTrigger id="bb" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Hérité / non classé</SelectItem><SelectItem value="besoin">Besoin (50 %)</SelectItem><SelectItem value="envie">Envie (30 %)</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          )}
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {row && row.source === 'ligne' ? <Button variant="destructive" onClick={() => { if (confirm('Retirer cette catégorie du budget, sur tous les mois ?')) { mutate((d) => b.removeBudget(d, categoryId)); onClose() } }}>Retirer du budget</Button> : <span />}
          <Button type="submit" form="bform">Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
