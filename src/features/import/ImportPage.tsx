import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DATE_FORMATS, type DateFormat } from '@/core/dates'
import { decodeFile, detectKind, parseCsv, parseOfx, parseQif, readCsvGrid, suggestMapping, type CsvMapping, type ParseResult } from '@/core/parsers'
import { fetchRatesToEur } from '@/core/fx'
import * as repo from '@/db/repo'
import { mutate, useDb } from '@/app/store'
import { AccountSelect, attempt, Empty, Money, PageHeader, useAccounts, useCategories } from '@/app/ui'

type Loaded =
  | { kind: 'csv'; name: string; grid: string[][]; signature: string; mapping: CsvMapping }
  | { kind: 'ofx' | 'qif' | 'pdf'; name: string; result: ParseResult & { currency?: string } }

const NONE = '-1'
function ColSelect({ label, headers, value, onChange, optional }: { label: string; headers: string[]; value: number | undefined; onChange: (v: number | undefined) => void; optional?: boolean }) {
  const id = `col-${label}`
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={String(value ?? NONE)} onValueChange={(v) => onChange(v === NONE ? undefined : Number(v))}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={NONE}>—</SelectItem>}
          {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h || `Colonne ${i + 1}`}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function MappingEditor({ grid, m, set }: { grid: string[][]; m: CsvMapping; set: (m: CsvMapping) => void }) {
  const width = Math.max(...grid.slice(0, 50).map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => (m.hasHeader ? grid[m.skipRows]?.[i] : undefined) || `Colonne ${i + 1}`)
  const signed = m.amount !== undefined
  return (
    <fieldset className="mb-4 grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Correspondance des colonnes (mémorisée pour ce format de fichier)</legend>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="grid gap-1.5"><Label htmlFor="skip">Lignes à ignorer avant l’en-tête</Label><Input id="skip" type="number" min={0} value={m.skipRows} onChange={(e) => set({ ...m, skipRows: Math.max(0, Number(e.target.value) || 0) })} /></div>
        <ColSelect label="Date" headers={headers} value={m.date} onChange={(v) => set({ ...m, date: v ?? 0 })} />
        <div className="grid gap-1.5"><Label htmlFor="df">Format de date</Label>
          <Select value={m.dateFormat} onValueChange={(v) => set({ ...m, dateFormat: v as DateFormat })}>
            <SelectTrigger id="df" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{DATE_FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm"><Checkbox checked={m.hasHeader} onCheckedChange={(v) => set({ ...m, hasHeader: v === true })} />Ligne d’en-tête</label>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Libellé (une ou plusieurs colonnes)</span>
        <div className="flex flex-wrap gap-3">
          {headers.map((h, i) => (
            <label key={i} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={m.label.includes(i)} onCheckedChange={(v) => set({ ...m, label: v === true ? [...m.label, i].sort((a, b) => a - b) : m.label.filter((x) => x !== i) })} />{h}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="grid gap-1.5"><Label htmlFor="mode">Montants</Label>
          <Select value={signed ? 's' : 'dc'} onValueChange={(v) => set(v === 's' ? { ...m, amount: m.debit ?? 0, debit: undefined, credit: undefined } : { ...m, amount: undefined, debit: m.amount ?? 0, credit: (m.amount ?? 0) + 1 })}>
            <SelectTrigger id="mode" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="s">Une colonne signée</SelectItem><SelectItem value="dc">Débit et crédit séparés</SelectItem></SelectContent>
          </Select>
        </div>
        {signed
          ? <ColSelect label="Montant" headers={headers} value={m.amount} onChange={(v) => set({ ...m, amount: v ?? 0 })} />
          : <><ColSelect label="Débit" headers={headers} value={m.debit} onChange={(v) => set({ ...m, debit: v })} optional /><ColSelect label="Crédit" headers={headers} value={m.credit} onChange={(v) => set({ ...m, credit: v })} optional /></>}
        <ColSelect label="Devise (optionnel)" headers={headers} value={m.currency} onChange={(v) => set({ ...m, currency: v })} optional />
      </div>
    </fieldset>
  )
}

export function ImportPage() {
  const { db, version } = useDb()
  const accounts = useAccounts()
  const { label: catLabel } = useCategories()
  const [accountId, setAccountId] = useState<string | null>(accounts.find((a) => !a.archived)?.id ?? null)
  const [file, setFile] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false), [manualRate, setManualRate] = useState('')
  const acc = accounts.find((a) => a.id === accountId)

  async function load(f: File) {
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      const [{ pdfItems }, { parseStatementItems }] = await Promise.all([import('@/app/pdf'), import('@/core/pdfStatement')])
      const rows = parseStatementItems(await pdfItems(await f.arrayBuffer()))
      if (!rows.length) toast.error('Aucune opération reconnue dans ce PDF. Préfère l’export CSV ou OFX de ta banque.')
      return setFile({ kind: 'pdf', name: f.name, result: { rows, errors: [] } })
    }
    const text = decodeFile(await f.arrayBuffer())
    const kind = detectKind(f.name, text)
    if (kind === 'csv') {
      const grid = readCsvGrid(text)
      const guess = suggestMapping(grid)
      const signature = (grid[guess.skipRows] ?? []).join('|')
      setFile({ kind, name: f.name, grid, signature, mapping: repo.findProfile(db, signature) ?? guess })
    } else setFile({ kind, name: f.name, result: kind === 'ofx' ? parseOfx(text) : parseQif(text) })
  }

  const parsed = useMemo(() => !file ? null : file.kind === 'csv' ? parseCsv(file.grid, file.mapping) : file.result, [file])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => parsed && acc ? repo.previewImport(db, acc.id, parsed.rows) : null, [db, version, parsed, acc])
  const fresh = preview?.rows.filter((r) => !r.duplicate) ?? []
  const currencyMismatch = file?.kind === 'ofx' && file.result.currency && acc && file.result.currency !== acc.currency

  async function doImport() {
    if (!acc || !file || !parsed) return
    setBusy(true)
    try {
      if (acc.currency !== 'EUR' && fresh.length) {
        const dates = fresh.map((r) => r.date).sort()
        const manual = Number(manualRate.replace(',', '.'))
        if (manualRate && !(manual > 0)) throw new Error('Taux manuel invalide')
        if (manual > 0) mutate((d) => repo.saveRates(d, acc.currency, { [dates[0]!]: manual }, true))
        else {
          try { const rates = await fetchRatesToEur(acc.currency, dates[0]!, dates.at(-1)!); mutate((d) => repo.saveRates(d, acc.currency, rates)) }
          catch { if (!repo.cachedRates(db, acc.currency).length) throw new Error(`Taux ${acc.currency} indisponible hors ligne : saisis un taux manuel.`) }
        }
      }
      const res = attempt(() => mutate((d) => {
        if (file.kind === 'csv') repo.saveProfile(d, file.name, file.signature, file.mapping)
        return repo.importRows(d, acc.id, file.name, parsed.rows)
      }, { label: `Import de ${file.name}` }))
      if (res) {
        toast.success(`${res.imported} opération(s) importée(s), ${res.skipped} doublon(s) ignoré(s)`)
        if (repo.transferSuggestions(db).length) toast.info('Des virements internes probables sont à confirmer dans Opérations.')
        setFile(null)
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => repo.listImports(db), [db, version])
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?'

  if (!accounts.length) return <><PageHeader title="Importer un relevé" /><Empty>Crée d’abord un compte dans <a className="underline" href="#/comptes">Comptes</a>.</Empty></>

  return (
    <>
      <PageHeader title="Importer un relevé" />
      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="iacc">Compte de destination</Label><AccountSelect id="iacc" value={accountId} onChange={setAccountId} /></div>
        <div className="grid gap-1.5"><Label htmlFor="ifile">Fichier CSV, OFX, QIF ou relevé PDF de ta banque</Label>
          <Input id="ifile" type="file" accept=".csv,.txt,.ofx,.qfx,.qif,.pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void load(f).catch((err) => toast.error(String(err))) }} />
        </div>
      </div>

      {file && parsed && preview && acc && <>
        {file.kind === 'csv' && <MappingEditor grid={file.grid} m={file.mapping} set={(mapping) => setFile({ ...file, mapping })} />}
        {file.kind === 'pdf' && <p className="mb-3 rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/40">Lecture d’un relevé PDF : vérifie bien les montants et leur sens (débit/crédit) dans l’aperçu. Les mises en page varient selon les banques.</p>}
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <span><strong>{fresh.length}</strong> nouvelle(s) · {preview.rows.length - fresh.length} doublon(s) · {parsed.errors.length} ligne(s) illisible(s)</span>
          {acc.currency !== 'EUR' && <Input className="w-56" inputMode="decimal" placeholder={`Taux manuel 1 ${acc.currency} = ? EUR`} aria-label="Taux manuel" value={manualRate} onChange={(e) => setManualRate(e.target.value)} />}
          <Button onClick={() => void doImport()} disabled={busy || !fresh.length || !!currencyMismatch}>{busy ? 'Import…' : `Importer ${fresh.length} opération(s)`}</Button>
          <Button variant="ghost" onClick={() => setFile(null)}>Annuler</Button>
        </div>
        {currencyMismatch && <p role="alert" className="mb-2 text-sm text-destructive">Ce fichier est en {file.result.currency} mais le compte est en {acc.currency}.</p>}
        {parsed.errors.length > 0 && (
          <details className="mb-2 text-sm text-destructive"><summary>Lignes ignorées</summary>
            <ul className="ml-4 list-disc">{parsed.errors.slice(0, 20).map((e) => <li key={e.line}>Ligne {e.line} : {e.reason}</li>)}</ul>
          </details>
        )}
        <div className="mb-6 max-h-96 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs"><tr><th className="p-2">Date</th><th className="p-2">Libellé</th><th className="p-2">Catégorie proposée</th><th className="p-2 text-right">Montant</th></tr></thead>
            <tbody>{preview.rows.slice(0, 200).map((r) => (
              <tr key={r.importKey} className={`border-t ${r.duplicate ? 'text-muted-foreground line-through' : ''}`}>
                <td className="whitespace-nowrap p-2">{r.date}</td><td className="p-2">{r.label}</td><td className="p-2">{catLabel(r.categoryId) ?? '—'}</td>
                <td className="p-2 text-right"><Money cents={r.amount} currency={acc.currency} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>}

      <h2 className="mb-2 font-medium">Imports précédents</h2>
      {history.length === 0 ? <Empty>Aucun import pour l’instant.</Empty> : (
        <ul className="grid gap-1 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
              <span>{new Date(h.createdAt + 'Z').toLocaleString('fr-FR')} · {h.fileName} → {accName(h.accountId)} · {h.imported} importée(s), {h.skipped} doublon(s)</span>
              <Button size="sm" variant="outline" onClick={() => { if (confirm(`Annuler cet import et supprimer ses ${h.imported} opération(s) ?`)) mutate((d) => repo.undoImport(d, h.id), { label: `Annulation de l’import ${h.fileName}` }) }}>Annuler l’import</Button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
