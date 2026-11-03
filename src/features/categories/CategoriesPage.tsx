import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CATEGORY_KINDS } from '@/db/schema'
import * as repo from '@/db/repo'
import { mutate, useDb } from '@/app/store'
import { attempt, CategorySelect, PageHeader, useCategories } from '@/app/ui'

const KIND = { depense: 'Dépense', revenu: 'Revenu', transfert: 'Transfert' } as const

function Categories() {
  const { all } = useCategories()
  const [name, setName] = useState(''), [kind, setKind] = useState<repo.Category['kind']>('depense'), [parentId, setParentId] = useState<string | null>(null)
  const roots = all.filter((c) => !c.parentId)
  function add() {
    const parent = all.find((c) => c.id === parentId)
    attempt(() => mutate((d) => repo.createCategory(d, { name: name.trim(), kind: parent?.kind ?? kind, parentId, color: parent?.color ?? null })), 'Catégorie créée')
    setName('')
  }
  return (
    <>
      <form className="mb-4 grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-[1fr_10rem_14rem_auto]" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add() }}>
        <Input aria-label="Nom de la catégorie" placeholder="Nouvelle catégorie" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={kind} onValueChange={(v) => setKind(v as repo.Category['kind'])} disabled={!!parentId}>
          <SelectTrigger aria-label="Type" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{CATEGORY_KINDS.map((k) => <SelectItem key={k} value={k}>{KIND[k]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={parentId ?? '-'} onValueChange={(v) => setParentId(v === '-' ? null : v)}>
          <SelectTrigger aria-label="Catégorie parente" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="-">Catégorie principale</SelectItem>{roots.map((r) => <SelectItem key={r.id} value={r.id}>Sous-catégorie de {r.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="submit">Ajouter</Button>
      </form>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roots.map((r) => (
          <li key={r.id} className="rounded-lg border p-3">
            <CatRow c={r} strong />
            <ul className="mt-1 ml-3 grid gap-0.5">{all.filter((c) => c.parentId === r.id).map((c) => <li key={c.id}><CatRow c={c} /></li>)}</ul>
          </li>
        ))}
      </ul>
    </>
  )
}

function CatRow({ c, strong }: { c: repo.Category; strong?: boolean }) {
  return (
    <div className="group flex items-center justify-between gap-2 text-sm">
      <span className={strong ? 'font-medium' : ''}>
        {strong && <span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: c.color ?? '#999' }} aria-hidden />}
        {c.name} {strong && <Badge variant="outline" className="ml-1 text-[10px]">{KIND[c.kind]}</Badge>}
      </span>
      <span className="flex gap-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
        <Button size="xs" variant="ghost" onClick={() => { const n = prompt('Nouveau nom', c.name); if (n?.trim()) mutate((d) => repo.renameCategory(d, c.id, n.trim())) }}>Renommer</Button>
        <Button size="xs" variant="ghost" onClick={() => { if (confirm(`Supprimer « ${c.name} » ? Ses opérations deviendront non catégorisées.`)) mutate((d) => repo.deleteCategory(d, c.id)) }}>Supprimer</Button>
      </span>
    </div>
  )
}

function Rules() {
  const { db, version } = useDb()
  const { label } = useCategories()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => repo.listRules(db), [db, version])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const txs = useMemo(() => repo.listTransactions(db, { limit: 100_000 }), [db, version])
  const [pattern, setPattern] = useState(''), [isRegex, setIsRegex] = useState(false), [categoryId, setCategoryId] = useState<string | null>(null)
  function add() {
    if (!categoryId) return toast.error('Choisis une catégorie')
    if (isRegex) try { new RegExp(pattern) } catch { return toast.error('Expression régulière invalide') }
    mutate((d) => repo.createRule(d, { pattern: pattern.trim(), isRegex, categoryId, priority: 2 }))
    setPattern('')
  }
  return (
    <>
      <form className="mb-3 grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-[1fr_auto_16rem_auto]" onSubmit={(e) => { e.preventDefault(); if (pattern.trim()) add() }}>
        <div className="grid gap-1"><Label htmlFor="rp" className="sr-only">Si le libellé contient</Label><Input id="rp" placeholder="Si le libellé contient… (ex : BOULANGERIE)" value={pattern} onChange={(e) => setPattern(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={isRegex} onCheckedChange={(v) => setIsRegex(v === true)} />Regex</label>
        <CategorySelect value={categoryId} onChange={setCategoryId} allowNone={false} placeholder="alors catégorie…" />
        <Button type="submit">Ajouter la règle</Button>
      </form>
      <div className="mb-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Les règles s’appliquent à l’import et à la saisie. Une correction manuelle crée une règle « apprise ».</span>
        <Button size="sm" variant="outline" onClick={() => { const n = mutate((d) => repo.applyRulesToUncategorized(d)); toast.success(`${n} opération(s) catégorisée(s)`) }}>Appliquer aux non catégorisées</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Motif</th><th className="p-2">Catégorie</th><th className="p-2 text-right">Opérations</th><th className="p-2" /></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2 font-mono text-xs">{r.pattern} {r.isRegex && <Badge variant="outline">regex</Badge>} {r.learned && <Badge variant="secondary">apprise</Badge>}</td>
              <td className="p-2">{label(r.categoryId)}</td>
              <td className="p-2 text-right tabular-nums">{repo.ruleHits(r, txs)}</td>
              <td className="p-2 text-right"><Button size="xs" variant="ghost" onClick={() => mutate((d) => repo.deleteRule(d, r.id))}>Supprimer</Button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}

export function CategoriesPage() {
  return (
    <>
      <PageHeader title="Catégories et règles" />
      <Tabs defaultValue="cats">
        <TabsList className="mb-3"><TabsTrigger value="cats">Catégories</TabsTrigger><TabsTrigger value="rules">Règles automatiques</TabsTrigger></TabsList>
        <TabsContent value="cats"><Categories /></TabsContent>
        <TabsContent value="rules"><Rules /></TabsContent>
      </Tabs>
    </>
  )
}
