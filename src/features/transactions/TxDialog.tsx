import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { evalAmount, formatMoney } from '@/core/money'
import { validateSplits } from '@/core/splits'
import * as repo from '@/db/repo'
import { mutate, useDb } from '@/app/store'
import { attempt, CategorySelect, useCategories } from '@/app/ui'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import * as x from '@/db/extrasRepo'
import { matchCategory, ollamaChat } from '@/core/assistant'
import { Attachments } from './Attachments'

type Part = { categoryId: string | null; amount: string }
const fmt = (c: number) => (c / 100).toFixed(2).replace('.', ',')

export function TxDialog({ tx, onClose }: { tx: repo.Tx; onClose: () => void }) {
  const { db } = useDb()
  const { label: catLabel } = useCategories()
  const [date, setDate] = useState(tx.date), [label, setLabel] = useState(tx.label), [amount, setAmount] = useState(fmt(tx.amount))
  const [categoryId, setCategoryId] = useState(tx.categoryId), [notes, setNotes] = useState(tx.notes ?? '')
  const [tags, setTags] = useState(() => repo.getTags(db, tx.id).join(', '))
  const [pro, setPro] = useState(tx.pro), [vatRate, setVatRate] = useState(tx.vatRate), [expenseReport, setExpenseReport] = useState(tx.expenseReport)
  const freelance = x.isFreelance(db), ai = x.assistantSettings(db)
  const { all: cats } = useCategories()
  const [thinking, setThinking] = useState(false)
  async function suggest() {
    setThinking(true)
    try {
      const names = cats.filter((c) => c.kind === (tx.amount > 0 ? 'revenu' : 'depense')).map((c) => c.name)
      const answer = await ollamaChat(ai, [{ role: 'user', content: `Opération bancaire : « ${label} », ${(tx.amount / 100).toFixed(2)} €.\nChoisis UNE catégorie dans cette liste et réponds seulement par son nom :\n${names.join('\n')}` }])
      const name = matchCategory(answer, names)
      const c = cats.find((k) => k.name === name)
      if (c) { setCategoryId(c.id); toast.success(`Suggestion : ${c.name}`) } else toast.info('Pas de suggestion exploitable.')
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setThinking(false) }
  }
  const [parts, setParts] = useState<Part[]>(() => repo.getSplits(db, tx.id).map((s) => ({ categoryId: s.categoryId, amount: fmt(s.amount) })))

  const cents = evalAmount(amount)
  const parsedParts = parts.map((p) => ({ categoryId: p.categoryId, amount: evalAmount(p.amount) ?? 0 }))
  const splitError = parts.length && cents !== null ? validateSplits(cents, parsedParts) : null
  const remaining = cents !== null ? cents - parsedParts.reduce((s, p) => s + p.amount, 0) : 0

  function save() {
    if (cents === null) return toast.error('Montant illisible')
    if (splitError) return toast.error(splitError)
    const ok = attempt(() => mutate((d) => {
      const { learned } = repo.updateTransaction(d, tx.id, { date, label, amount: cents, notes: notes.trim() || null, pro, vatRate: pro ? vatRate : null, expenseReport, ...(parts.length ? {} : { categoryId }) })
      repo.setSplits(d, tx.id, parts.length ? parsedParts.map((p) => ({ categoryId: p.categoryId!, amount: p.amount })) : [])
      repo.setTags(d, tx.id, tags.split(','))
      if (learned && categoryId) toast.info(`Règle apprise : « ${learned} » → ${catLabel(categoryId)}`)
      return true
    }, { label: `Modification : ${label}` }))
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Modifier l’opération</DialogTitle></DialogHeader>
        <form id="txform" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="d">Date</Label><Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="a">Montant ({tx.currency})</Label><Input id="a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={cents === null} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="l">Libellé</Label><Input id="l" value={label} onChange={(e) => setLabel(e.target.value)} required /></div>
          {tx.transferGroupId ? (
            <div className="flex items-center justify-between rounded-md bg-muted p-2 text-sm">
              Virement interne : exclu des revenus et dépenses.
              <Button type="button" size="sm" variant="outline" onClick={() => { mutate((d) => repo.unlinkTransfer(d, tx.transferGroupId!)); onClose() }}>Délier</Button>
            </div>
          ) : parts.length === 0 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="c">Catégorie</Label>
              <div className="flex gap-2">
                <CategorySelect id="c" value={categoryId} onChange={setCategoryId} />
                {ai.enabled && <Button type="button" variant="outline" size="icon" aria-label="Suggérer une catégorie (IA locale)" disabled={thinking} onClick={() => void suggest()}><Sparkles /></Button>}
                <Button type="button" variant="outline" onClick={() => setParts([{ categoryId, amount }, { categoryId: null, amount: '' }])}>Ventiler</Button>
              </div>
            </div>
          ) : (
            <fieldset className="grid gap-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Ventilation</legend>
              {parts.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <CategorySelect value={p.categoryId} allowNone={false} onChange={(v) => setParts(parts.map((x, j) => j === i ? { ...x, categoryId: v } : x))} />
                  <Input className="w-28" inputMode="decimal" aria-label="Montant de la part" value={p.amount} onChange={(e) => setParts(parts.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Retirer la part" onClick={() => setParts(parts.filter((_, j) => j !== i))}>×</Button>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm">
                <Button type="button" variant="outline" size="sm" onClick={() => setParts([...parts, { categoryId: null, amount: remaining ? fmt(remaining) : '' }])}>Ajouter une part</Button>
                <span className={remaining ? 'text-destructive' : 'text-muted-foreground'}>Reste : {formatMoney(remaining, tx.currency)}</span>
              </div>
            </fieldset>
          )}
          <div className="grid gap-1.5"><Label htmlFor="t">Tags (séparés par des virgules)</Label><Input id="t" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vacances, pro" /></div>
          <div className="grid gap-1.5"><Label htmlFor="n">Notes</Label><Textarea id="n" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          {freelance && (
            <div className="flex flex-wrap items-center gap-4 rounded-md border p-2 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={pro} onCheckedChange={(v) => setPro(v === true)} />Professionnel</label>
              {pro && (
                <Select value={String(vatRate ?? 0)} onValueChange={(v) => setVatRate(Number(v) || null)}>
                  <SelectTrigger aria-label="Taux de TVA" className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{[0, 20, 10, 5.5, 2.1].map((r) => <SelectItem key={r} value={String(r)}>{r ? `TVA ${String(r).replace('.', ',')} %` : 'Sans TVA'}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <label className="flex items-center gap-2"><Checkbox checked={expenseReport} onCheckedChange={(v) => setExpenseReport(v === true)} />Note de frais</label>
            </div>
          )}
          <Attachments txId={tx.id} onReceipt={(r) => { if (r.total) setAmount(fmt(tx.amount > 0 ? r.total : -r.total)); if (r.date) setDate(r.date) }} />
          {tx.currency !== 'EUR' && <p className="text-xs text-muted-foreground">≈ {formatMoney(tx.amountEur)} au taux {tx.fxRate}</p>}
        </form>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="destructive" onClick={() => { if (confirm('Supprimer cette opération ?')) { mutate((d) => repo.deleteTransactions(d, [tx.id]), { label: `Suppression : ${tx.label}` }); onClose() } }}>Supprimer</Button>
          <Button type="submit" form="txform">Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
