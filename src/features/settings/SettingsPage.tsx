import { useRef, useState } from 'react'
import { useTheme } from '@/app/theme'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { today } from '@/core/dates'
import * as repo from '@/db/repo'
import { changePassword, exportBackup, getHistory, mutate, undoTo, wipeAll, MIN_PASSWORD } from '@/app/store'
import { putSetting } from '@/db/repo'
import { PageHeader, useAccounts } from '@/app/ui'
import { Checkbox } from '@/components/ui/checkbox'
import { alertSettings, saveAlertSettings } from '@/db/analyticsRepo'
import { useDb } from '@/app/store'
import type { AlertSettings, AlertType } from '@/core/analytics'
import { assistantSettings, isFreelance, saveAssistantSettings, setFreelance } from '@/db/extrasRepo'
import { ollamaChat } from '@/core/assistant'
import { parseAmount } from '@/core/money'

const TYPES: [AlertType, string][] = [
  ['budget', 'Budget presque atteint ou dépassé'], ['solde', 'Solde bas'], ['decouvert', 'Découvert probable'],
  ['echeance', 'Prélèvement à venir'], ['revenu', 'Revenu attendu non reçu'], ['anomalie', 'Anomalies (doublons, montants inhabituels, frais)'],
]

function SecurityCard() {
  const [cur, setCur] = useState(''), [next, setNext] = useState(''), [busy, setBusy] = useState(false)
  return (
    <Card>
      <CardHeader><CardTitle>Changer le mot de passe</CardTitle><CardDescription>Les sauvegardes déjà téléchargées gardent l’ancien mot de passe.</CardDescription></CardHeader>
      <CardContent>
        <form className="grid gap-2" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true)
          try { await changePassword(cur, next); toast.success('Mot de passe changé'); setCur(''); setNext('') }
          catch (err) { toast.error(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
        }}>
          <Input type="password" aria-label="Mot de passe actuel" placeholder="Mot de passe actuel" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          <Input type="password" aria-label="Nouveau mot de passe" placeholder={`Nouveau (${MIN_PASSWORD} caractères min.)`} autoComplete="new-password" minLength={MIN_PASSWORD} value={next} onChange={(e) => setNext(e.target.value)} required />
          <Button type="submit" disabled={busy} className="justify-self-start">{busy ? 'Un instant…' : 'Changer'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function HistoryCard() {
  const { version } = useDb()
  void version
  const h = getHistory()
  return (
    <Card>
      <CardHeader><CardTitle>Historique des modifications</CardTitle><CardDescription>Depuis le déverrouillage. Revenir à un point annule cette modification et toutes les suivantes (⌘Z / Ctrl+Z pour la dernière).</CardDescription></CardHeader>
      <CardContent>
        {!h.length ? <p className="text-sm text-muted-foreground">Aucune modification pour l’instant.</p> : (
          <ol className="grid max-h-64 gap-1 overflow-auto text-sm">
            {[...h.entries()].reverse().map(([i, e]) => (
              <li key={e.at + i} className="flex items-center justify-between gap-2">
                <span className="truncate"><span className="text-muted-foreground tabular-nums">{new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span> {e.label}</span>
                <Button size="xs" variant="outline" onClick={() => { if (confirm(`Annuler « ${e.label} » et les ${h.length - 1 - i} modification(s) suivante(s) ?`)) void undoTo(i).then(() => toast.success('Annulé')) }}>Annuler jusqu’ici</Button>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function ModulesCard() {
  const { db, version } = useDb()
  void version
  const a = assistantSettings(db)
  const [url, setUrl] = useState(a.url), [model, setModel] = useState(a.model)
  return (
    <Card>
      <CardHeader><CardTitle>Modules optionnels</CardTitle></CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <label className="flex items-start gap-2"><Checkbox checked={isFreelance(db)} onCheckedChange={(v) => mutate((d) => setFreelance(d, v === true))} />
          <span><span className="font-medium">Mode freelance</span><span className="block text-xs text-muted-foreground">Opérations pro/perso, TVA, notes de frais, export comptable (dans Rapports).</span></span></label>
        <div className="grid gap-2">
          <label className="flex items-start gap-2"><Checkbox checked={a.enabled} onCheckedChange={(v) => mutate((d) => saveAssistantSettings(d, { ...a, enabled: v === true }))} />
            <span><span className="font-medium">Assistant IA local (Ollama)</span><span className="block text-xs text-muted-foreground">Questions en langage naturel et suggestions de catégorie. Nécessite Ollama installé sur cet ordinateur (voir README). Rien ne part sur Internet.</span></span></label>
          {a.enabled && (
            <div className="grid grid-cols-[1fr_9rem_auto] gap-2">
              <Input aria-label="Adresse d’Ollama" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => mutate((d) => saveAssistantSettings(d, { ...a, url: url.trim() }))} />
              <Input aria-label="Modèle" value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => mutate((d) => saveAssistantSettings(d, { ...a, model: model.trim() }))} />
              <Button size="sm" variant="outline" onClick={() => void ollamaChat({ ...a, url, model }, [{ role: 'user', content: 'Réponds juste OK.' }]).then(() => toast.success('Ollama répond.')).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}>Tester</Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AlertsCard() {
  const { db, version } = useDb()
  void version
  const s = alertSettings(db)
  const save = (v: Partial<AlertSettings>) => mutate((d) => saveAlertSettings(d, { ...s, ...v }))
  const notifState = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle>Alertes</CardTitle><CardDescription>Affichées sur l’accueil. Les seuils s’appliquent immédiatement.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Types d’alertes</legend>
          {TYPES.map(([t, l]) => (
            <label key={t} className="flex items-center gap-2 text-sm"><Checkbox checked={s.enabled[t]} onCheckedChange={(v) => save({ enabled: { ...s.enabled, [t]: v === true } })} />{l}</label>
          ))}
        </fieldset>
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-[1fr_7rem] items-center gap-2 text-sm">
            <Label htmlFor="al-b">Alerter à partir de (% du budget)</Label>
            <Input id="al-b" type="number" min={10} max={100} defaultValue={s.budgetWarnPct} onBlur={(e) => { const v = Number(e.target.value); if (v >= 10 && v <= 100) save({ budgetWarnPct: v }) }} />
            <Label htmlFor="al-s">Seuil de solde bas (€)</Label>
            <Input id="al-s" inputMode="decimal" defaultValue={(s.lowBalance / 100).toString()} onBlur={(e) => { const v = parseAmount(e.target.value); if (v !== null) save({ lowBalance: v }) }} />
            <Label htmlFor="al-d">Prévenir avant un prélèvement (jours)</Label>
            <Input id="al-d" type="number" min={0} max={30} defaultValue={s.daysBefore} onBlur={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 30) save({ daysBefore: v }) }} />
          </div>
          <div className="rounded-md border p-2 text-sm">
            <div className="mb-1 font-medium">Notifications de l’appareil</div>
            {notifState === 'unsupported' ? <p className="text-muted-foreground">Non disponibles dans ce navigateur.</p>
              : notifState === 'denied' ? <p className="text-muted-foreground">Bloquées dans les réglages du navigateur.</p>
              : (
                <label className="flex items-center gap-2">
                  <Checkbox checked={s.notifications && notifState === 'granted'} onCheckedChange={async (v) => {
                    if (v === true && Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return toast.error('Notifications refusées')
                    save({ notifications: v === true })
                  }} />Recevoir une notification pour chaque nouvelle alerte
                </label>
              )}
            <p className="mt-1 text-xs text-muted-foreground">Le titre et le montant de l’alerte s’affichent dans le centre de notifications. Pour l’instant, elles partent seulement quand l’app est ouverte.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const accounts = useAccounts()
  const foreign = [...new Set(accounts.map((a) => a.currency).filter((c) => c !== 'EUR'))]
  const [cur, setCur] = useState(foreign[0] ?? 'USD'), [rate, setRate] = useState(''), [date, setDate] = useState(today())
  const wipeRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <PageHeader title="Réglages" />
      <div className="grid gap-4 lg:grid-cols-2">
        <AlertsCard />
        <ModulesCard />
        <HistoryCard />
        <SecurityCard />
        <Card>
          <CardHeader><CardTitle>Apparence</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => <Button key={t} variant={theme === t ? 'default' : 'outline'} onClick={() => setTheme(t)}>{{ light: 'Clair', dark: 'Sombre', system: 'Système' }[t]}</Button>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Sauvegarde</CardTitle><CardDescription>Fichier chiffré avec ton mot de passe. Pour le restaurer (ou l’ouvrir sur ton téléphone), utilise « Restaurer une sauvegarde » à l’écran de déverrouillage.</CardDescription></CardHeader>
          <CardContent><Button onClick={() => void exportBackup().then((b) => { download(b, `budget-${today()}.json`); mutate((d) => putSetting(d, 'lastBackup', today()), { undoable: false }) }).catch((e) => toast.error(String(e)))}>Télécharger une sauvegarde</Button></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Taux de change manuel</CardTitle><CardDescription>Les taux BCE sont récupérés automatiquement à l’import. Saisis-en un ici si tu es hors ligne.</CardDescription></CardHeader>
          <CardContent>
            <form className="grid grid-cols-[5rem_1fr_1fr_auto] items-end gap-2" onSubmit={(e) => {
              e.preventDefault()
              const r = Number(rate.replace(',', '.')), c = cur.trim().toUpperCase()
              if (!/^[A-Z]{3}$/.test(c) || !(r > 0)) return toast.error('Devise ou taux invalide')
              mutate((d) => repo.saveRates(d, c, { [date]: r }, true)); toast.success(`1 ${c} = ${r} EUR au ${date}`); setRate('')
            }}>
              <div className="grid gap-1.5"><Label htmlFor="fc">Devise</Label><Input id="fc" maxLength={3} value={cur} onChange={(e) => setCur(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="fr">1 devise = ? EUR</Label><Input id="fr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="fd">Date</Label><Input id="fd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <Button type="submit">Enregistrer</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader><CardTitle>Supprimer toutes mes données</CardTitle><CardDescription>Efface définitivement la base de cet appareil. Tape SUPPRIMER pour confirmer.</CardDescription></CardHeader>
          <CardContent className="flex gap-2">
            <Input ref={wipeRef} aria-label="Confirmation de suppression" placeholder="SUPPRIMER" />
            <Button variant="destructive" onClick={() => { if (wipeRef.current?.value === 'SUPPRIMER') void wipeAll(); else toast.error('Tape SUPPRIMER pour confirmer') }}>Tout effacer</Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
