import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addMonths, monthOf, today } from '@/core/dates'
import { formatMoney } from '@/core/money'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listAccounts, listCategories, type Category } from '@/db/repo'
import { cap, monthLong } from './periods'
import { useDb } from './store'

export function Money({ cents, currency = 'EUR', className, colored = true }: { cents: number; currency?: string; className?: string; colored?: boolean }) {
  return <span className={cn('tabular-nums whitespace-nowrap', colored && cents > 0 && 'text-emerald-700 dark:text-emerald-400', className)}>{formatMoney(cents, currency)}</span>
}

/** Exécute une action et affiche l'erreur en toast plutôt que de planter l'écran. */
export function attempt<T>(fn: () => T, success?: string): T | undefined {
  try { const r = fn(); if (success) toast.success(success); return r }
  catch (e) { toast.error(e instanceof Error ? e.message : String(e)); return undefined }
}

export function useCategories() {
  const { db, version } = useDb()
  return useMemo(() => {
    const all = listCategories(db)
    const byId = new Map(all.map((c) => [c.id, c]))
    const label = (id: string | null | undefined) => {
      const c = id ? byId.get(id) : undefined
      if (!c) return null
      const p = c.parentId ? byId.get(c.parentId) : undefined
      return p ? `${p.name} › ${c.name}` : c.name
    }
    return { all, byId, label }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
}

export function useAccounts() {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listAccounts(db), [db, version])
}

const NONE = '__none__'
const KIND_LABEL = { depense: 'Dépenses', revenu: 'Revenus', transfert: 'Transferts' } as const

export function CategorySelect({ value, onChange, id, placeholder = 'Catégorie', allowNone = true, className }:
  { value: string | null; onChange: (v: string | null) => void; id?: string; placeholder?: string; allowNone?: boolean; className?: string }) {
  const { all } = useCategories()
  const groups = (['depense', 'revenu', 'transfert'] as const).map((k) => {
    const roots = all.filter((c) => c.kind === k && !c.parentId)
    return { k, items: roots.flatMap((r) => [r, ...all.filter((c) => c.parentId === r.id)]) as Category[] }
  })
  return (
    <Select value={value ?? (allowNone ? NONE : '')} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} aria-label={id ? undefined : placeholder} className={cn('w-full', className)}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>Non catégorisé</SelectItem>}
        {groups.map((g) => g.items.length > 0 && (
          <SelectGroup key={g.k}>
            <SelectLabel>{KIND_LABEL[g.k]}</SelectLabel>
            {g.items.map((c) => <SelectItem key={c.id} value={c.id} className={c.parentId ? 'pl-6' : 'font-medium'}>{c.name}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export function AccountSelect({ value, onChange, id, allLabel, className }:
  { value: string | null; onChange: (v: string | null) => void; id?: string; allLabel?: string; className?: string }) {
  const accounts = useAccounts().filter((a) => !a.archived)
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} aria-label={id ? undefined : 'Compte'} className={cn('w-full', className)}><SelectValue placeholder="Compte" /></SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={NONE}>{allLabel}</SelectItem>}
        {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{a.currency !== 'EUR' ? ` (${a.currency})` : ''}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-[40px] md:leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>
}

/** Navigation par hash (#/operations) : fonctionne sur GitHub Pages sans configuration serveur. */
export function useRoute(): string {
  const [r, setR] = useState(() => location.hash.slice(2).split('?')[0] || 'accueil')
  useEffect(() => {
    const f = () => setR(location.hash.slice(2).split('?')[0] || 'accueil')
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return r
}

/** Jour du mois (1 à 31) ; 31 = « dernier jour du mois », ramené à 30, 29 ou 28 selon le mois. */
export function DaySelect({ value, onChange, id, allowNone, className }: { value: number | null; onChange: (d: number | null) => void; id?: string; allowNone?: boolean; className?: string }) {
  return (
    <Select value={value ? String(value) : NONE} onValueChange={(v) => onChange(v === NONE ? null : Number(v))}>
      <SelectTrigger id={id} aria-label={id ? undefined : 'Jour du mois'} className={cn('w-full', className)}><SelectValue placeholder="Jour" /></SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>Pas de date précise</SelectItem>}
        {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <SelectItem key={d} value={String(d)}>le {d === 1 ? '1er' : d}</SelectItem>)}
        <SelectItem value="31">le dernier jour du mois</SelectItem>
      </SelectContent>
    </Select>
  )
}
export const dayLabel = (d: number) => (d >= 31 ? 'le dernier jour' : d === 1 ? 'le 1er' : `le ${d}`)

/** Choix d'un mois en français : pas à pas ‹ › et liste (remplace <input type="month">, affiché en anglais). */
export function MonthPicker({ value, onChange, label, format = monthLong, allLabel, id }:
  { value: string; onChange: (m: string) => void; label: string; format?: (m: string) => string; allLabel?: string; id?: string }) {
  const base = value || monthOf(today())
  const opts = Array.from({ length: 49 }, (_, i) => addMonths(base, i - 24))
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-full bg-secondary p-0.5">
      <Button type="button" size="icon-xs" variant="ghost" aria-label={`${label}, précédent`} onClick={() => onChange(addMonths(base, -1))}><ChevronLeft /></Button>
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
        <SelectTrigger id={id} aria-label={id ? undefined : label} size="sm" className="min-w-0 flex-1 justify-center border-0 bg-transparent shadow-none dark:bg-transparent"><SelectValue /></SelectTrigger>
        <SelectContent>
          {allLabel && <SelectItem value={NONE}>{allLabel}</SelectItem>}
          {opts.map((m) => <SelectItem key={m} value={m}>{cap(format(m))}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" size="icon-xs" variant="ghost" aria-label={`${label}, suivant`} onClick={() => onChange(addMonths(base, 1))}><ChevronRight /></Button>
    </div>
  )
}
