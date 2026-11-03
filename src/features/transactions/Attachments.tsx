import { useMemo, useRef, useState } from 'react'
import { Paperclip, ScanText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { parseReceipt } from '@/core/receipt'
import { formatMoney } from '@/core/money'
import * as x from '@/db/extrasRepo'
import { mutate, useDb } from '@/app/store'
import { prepareFile } from '@/app/files'
import { attempt } from '@/app/ui'

export function Attachments({ txId, onReceipt }: { txId: string; onReceipt: (r: ReturnType<typeof parseReceipt>) => void }) {
  const { db, version } = useDb()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => x.listAttachments(db, txId), [db, version, txId])
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)

  function open(id: string) {
    const a = x.getAttachment(db, id)
    if (!a) return
    const url = URL.createObjectURL(new Blob([a.data as BlobPart], { type: a.mime }))
    window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  async function ocr(id: string) {
    const a = x.getAttachment(db, id)
    if (!a) return
    setBusy(id)
    try {
      const { ocrImage } = await import('@/app/ocr')
      const text = await ocrImage(a.data)
      mutate((d) => x.setOcrText(d, id, text))
      const r = parseReceipt(text)
      if (r.total || r.date) { onReceipt(r); toast.success(`Ticket lu${r.total ? ` : ${formatMoney(r.total)}` : ''}${r.date ? ` le ${r.date}` : ''}. Vérifie avant d’enregistrer.`) }
      else toast.info('Texte extrait, mais ni montant ni date reconnus.')
    } catch (e) { toast.error(`OCR impossible : ${e instanceof Error ? e.message : e}`) } finally { setBusy(null) }
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">Pièces jointes</span>
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <button type="button" className="flex-1 truncate text-left underline-offset-2 hover:underline" onClick={() => open(a.id)}>{a.name}</button>
          {a.mime.startsWith('image/') && <Button type="button" size="xs" variant="outline" disabled={busy === a.id} onClick={() => void ocr(a.id)}><ScanText />{busy === a.id ? 'Lecture…' : 'Lire le ticket'}</Button>}
          <Button type="button" size="icon-xs" variant="ghost" aria-label={`Supprimer ${a.name}`} onClick={() => mutate((d) => x.deleteAttachment(d, a.id))}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => input.current?.click()}><Paperclip />Ajouter (photo, PDF)</Button>
      <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = ''
        if (!f) return
        try { const p = await prepareFile(f); attempt(() => mutate((d) => x.addAttachment(d, txId, p.name, p.mime, p.data)), 'Pièce jointe ajoutée') }
        catch (err) { toast.error(String(err)) }
      }} />
      <p className="text-xs text-muted-foreground">Stockées chiffrées dans ta base. La lecture du ticket (OCR) se fait sur l’appareil.</p>
    </div>
  )
}
