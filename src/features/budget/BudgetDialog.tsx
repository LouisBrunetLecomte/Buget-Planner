import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Row, Scope } from '@/core/budget'
import { parseAmount } from '@/core/money'
import * as b from '@/db/budgetRepo'
import { mutate } from '@/app/store'
import { attempt, useCategories } from '@/app/ui'

export const monthName = (m: string) => new Date(`${m}-15`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

export function BudgetDialog({ categoryId, month, row, onClose }: { categoryId: string; month: string; row: Row | null; onClose: () => void }) {
  const { byId, label } = useCategories()
  const cat = byId.get(categoryId)!
  const [amount, setAmount] = useState(row ? (row.planned / 100).toFixed(2).replace('.', ',') : '')
  const [scope, setScope] = useState<Scope>(row ? 'month' : 'from'), [reason, setReason] = useState(row?.exception?.reason ?? '')
  const [rollover, setRollover] = useState(cat.rollover), [bucket, setBucket] = useState(cat.bucket ?? 'none')

  function save() {
    const cents = parseAmount(amount)
    if (cents === null || cents < 0) return attempt(() => { throw new Error('Montant invalide') })
    const ok = attempt(() => mutate((d) => {
      b.setBudget(d, categoryId, month, cents, scope, reason)
      b.setCategoryOptions(d, categoryId, { rollover, bucket: bucket === 'none' ? null : bucket as 'besoin' | 'envie' })
      return true
    }, { label: `Budget : ${label(categoryId)}` }))
    if (ok) onClose()
  }
  const scopes: [Scope, string, string][] = [
    ['month', 'Ce mois seulement', `Exception pour ${monthName(month)}, le modèle ne change pas.`],
    ['from', 'À partir de ce mois', 'Les mois précédents gardent l’ancien montant.'],
    ['all', 'Tous les mois', 'Remplace le montant partout, passé compris.'],
  ]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label(categoryId)}</DialogTitle>
          <DialogDescription>{monthName(month)}{row?.base != null && row.exception ? ` · modèle : ${(row.base / 100).toFixed(2)} €` : ''}</DialogDescription>
        </DialogHeader>
        <form id="bform" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="grid gap-1.5"><Label htmlFor="ba">{cat.kind === 'revenu' ? 'Revenu prévu (€)' : 'Budget (€)'}</Label><Input id="ba" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required /></div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Appliquer à</legend>
            {scopes.map(([v, t, d]) => (
              <label key={v} className="flex cursor-pointer gap-2 rounded-md border p-2 text-sm has-checked:border-primary">
                <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} className="mt-0.5 accent-current" />
                <span><span className="font-medium">{t}</span><span className="block text-xs text-muted-foreground">{d}</span></span>
              </label>
            ))}
          </fieldset>
          {scope === 'month' && <div className="grid gap-1.5"><Label htmlFor="br">Motif de l’exception</Label><Input id="br" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacances, cadeaux, prime…" /></div>}
          {cat.kind === 'depense' && (
            <div className="grid grid-cols-2 items-end gap-3">
              <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox checked={rollover} onCheckedChange={(v) => setRollover(v === true)} />Reporter le reste sur le mois suivant</label>
              <div className="grid gap-1.5"><Label htmlFor="bb">50/30/20</Label>
                <Select value={bucket} onValueChange={setBucket}>
                  <SelectTrigger id="bb" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Hérité / non classé</SelectItem><SelectItem value="besoin">Besoin (50 %)</SelectItem><SelectItem value="envie">Envie (30 %)</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          )}
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          {row ? <Button variant="destructive" onClick={() => { if (confirm('Retirer cette catégorie du budget, sur tous les mois ?')) { mutate((d) => b.removeBudget(d, categoryId)); onClose() } }}>Retirer du budget</Button> : <span />}
          <Button type="submit" form="bform">Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
