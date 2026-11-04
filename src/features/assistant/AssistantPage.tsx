import { useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { addMonths, today } from '@/core/dates'
import { ollamaChat, SYSTEM_PROMPT, type ChatMessage } from '@/core/assistant'
import { formatMoney } from '@/core/money'
import type { Db } from '@/db/client'
import { currentPeriod, getBudget, listRecurring, periodBounds, totalBalance, liquidBalance } from '@/db/budgetRepo'
import { spendingByRoot } from '@/db/analyticsRepo'
import { goalsStatus } from '@/db/planningRepo'
import { listCategories } from '@/db/repo'
import { assistantSettings } from '@/db/extrasRepo'
import { useDb } from '@/app/store'
import { Empty, PageHeader } from '@/app/ui'

/** Résumé chiffré envoyé au modèle local : agrégats seulement, pas la liste brute des opérations. */
function context(db: Db): string {
  const cur = currentPeriod(db, today()), cats = listCategories(db), name = (id: string) => cats.find((c) => c.id === id)?.name ?? 'Non catégorisé'
  const lines = [`Date du jour : ${today()}. Solde total : ${formatMoney(totalBalance(db))}. Comptes courants : ${formatMoney(liquidBalance(db))}.`]
  for (const m of getBudget(db, addMonths(cur, -3), cur)) {
    const sp = spendingByRoot(db, m.month).rows.slice(0, 8).map((r) => `${name(r.id)} ${formatMoney(r.amount)}`).join(', ')
    lines.push(`${periodBounds(db, m.month).label}${m.month === cur ? ' (en cours)' : ''} : revenus ${formatMoney(m.actualIncome)}, dépenses ${formatMoney(m.actualExpense)}, budget prévu ${formatMoney(m.plannedExpense)}. Principales dépenses : ${sp}.`)
  }
  const rec = listRecurring(db).filter((r) => r.active).map((r) => `${r.name} ${formatMoney(r.amount)}`).join(', ')
  if (rec) lines.push(`Charges et revenus récurrents : ${rec}.`)
  const goals = goalsStatus(db, today()).map((g) => `${g.g.name} ${formatMoney(g.current)}/${formatMoney(g.g.target)}`).join(', ')
  if (goals) lines.push(`Objectifs : ${goals}.`)
  return lines.join('\n')
}

export function AssistantPage() {
  const { db } = useDb()
  const s = assistantSettings(db)
  const [msgs, setMsgs] = useState<ChatMessage[]>([]), [q, setQ] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  if (!s.enabled) return <><PageHeader title="Assistant" /><Empty>L’assistant est désactivé. Il fonctionne avec un modèle d’IA installé sur ton ordinateur (Ollama, gratuit) : rien ne part sur Internet. Active-le dans <a className="underline" href="#/reglages">Paramètres</a>.</Empty></>

  async function ask() {
    const question = q.trim()
    if (!question) return
    const next: ChatMessage[] = [...msgs, { role: 'user', content: question }]
    setMsgs(next); setQ(''); setBusy(true); setErr(null)
    abort.current = new AbortController()
    try {
      const answer = await ollamaChat(s, [{ role: 'system', content: `${SYSTEM_PROMPT}\n\nDonnées :\n${context(db)}` }, ...next], abort.current.signal)
      setMsgs([...next, { role: 'assistant', content: answer }])
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <PageHeader title="Assistant (IA locale)" />
      <Card><CardContent className="grid gap-3 pt-4">
        {!msgs.length && <p className="text-sm text-muted-foreground">Exemples : « Combien ai-je dépensé en restaurants ce mois-ci ? », « Où puis-je économiser 100 € par mois ? », « Vais-je tenir mon budget ? »</p>}
        <ol className="grid gap-2" aria-live="polite">
          {msgs.map((m, i) => <li key={i} className={m.role === 'user' ? 'justify-self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground' : 'whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm'}>{m.content}</li>)}
          {busy && <li className="text-sm text-muted-foreground">Réflexion… <Button size="xs" variant="ghost" onClick={() => abort.current?.abort()}>Arrêter</Button></li>}
        </ol>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask() }}>
          <Textarea aria-label="Question" rows={2} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask() } }} placeholder="Pose ta question…" />
          <Button type="submit" size="icon" aria-label="Envoyer" disabled={busy}><Send /></Button>
        </form>
        <p className="text-xs text-muted-foreground">Modèle {s.model} sur {s.url}. Seul un résumé chiffré (totaux, catégories, échéances, objectifs) est transmis au modèle local. Les réponses peuvent être fausses : vérifie les chiffres.</p>
      </CardContent></Card>
    </>
  )
}
