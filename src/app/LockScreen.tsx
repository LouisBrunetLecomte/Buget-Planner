import { syncEnabled } from './sync'
import { useEffect, useRef, useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createVault, localBackupText, MIN_PASSWORD, resolveConflict, restoreBackup, syncConflict, unlock } from './store'
import { download } from './files'
import { enrollIfPossible, hasTouchIdBridge, touchIdDisable, touchIdStatus, touchIdUnlock } from './macAuth'

export function LockScreen({ mode }: { mode: 'new' | 'locked' }) {
  // démo réservée aux tests et à l'essai (?demo dans l'adresse) : une vraie base démarre vide
  const demoAllowed = new URLSearchParams(location.search).has('demo')
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [demo, setDemo] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  // Mac avec Touch ID activé : l'empreinte est la porte d'entrée, le mot de passe un secours
  const [bio, setBio] = useState(false), [showPassword, setShowPassword] = useState(!hasTouchIdBridge)
  const fileRef = useRef<HTMLInputElement>(null)
  const asked = useRef(false)

  async function withPassword(fn: () => Promise<void>, password: string) {
    await fn()
    if (await enrollIfPossible(password)) toast.success('Touch ID activé : la prochaine fois, ton empreinte suffit.')
  }
  async function go(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const fingerprint = () => go(async () => {
    const secret = await touchIdUnlock()
    if (!secret) { setShowPassword(true); return } // annulé ou « Utiliser le mot de passe » (null ou undefined selon WebKit)
    try { await unlock(secret) }
    catch { await touchIdDisable(); setBio(false); setShowPassword(true); throw new Error('Le mot de passe a changé depuis l’activation de Touch ID : saisis-le pour réactiver l’empreinte.') }
  })

  useEffect(() => {
    if (mode !== 'locked' || !hasTouchIdBridge || asked.current) return
    asked.current = true
    void touchIdStatus().then((s) => {
      if (s.enrolled && s.available) { setBio(true); void fingerprint() } else setShowPassword(true)
    }).catch(() => setShowPassword(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const submit = () => go(async () => {
    if (mode === 'locked') return withPassword(() => unlock(pw), pw)
    if (pw !== pw2) throw new Error('Les deux mots de passe diffèrent.')
    await withPassword(() => createVault(pw, demo), pw)
  })

  if (mode === 'locked' && syncConflict()) return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Deux bases Budget</CardTitle>
          <CardDescription>
            Ton compte Quansi a déjà une base Budget, venant d’un autre appareil. Cet appareil a aussi la sienne, jamais synchronisée.
            Laquelle garder ? L’autre sera remplacée sur tous tes appareils.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button disabled={busy} onClick={() => void go(() => resolveConflict('compte'))}>Garder celle du compte</Button>
          <Button variant="outline" disabled={busy} onClick={() => void go(() => resolveConflict('appareil'))}>Garder celle de cet appareil</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void go(async () => {
            const t = await localBackupText()
            if (t) download(t, `budget-cet-appareil-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
          })}>Télécharger d’abord une sauvegarde de cet appareil</Button>
          <p className="text-xs text-muted-foreground">Avec la base du compte, déverrouille ensuite avec le mot de passe choisi sur l’autre appareil.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </main>
  )

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{mode === 'new' ? 'Bienvenue' : 'Déverrouiller'}</CardTitle>
          <CardDescription>
            {mode === 'new'
              ? `${syncEnabled() ? 'Tes données sont chiffrées avec ce mot de passe, puis synchronisées sur ton compte Quansi pour tes autres appareils (illisibles pour quiconque sans lui).' : 'Tes données restent sur cet appareil, chiffrées avec ce mot de passe.'} Il est impossible de le récupérer : note-le bien.${hasTouchIdBridge ? ' Ensuite, ton empreinte suffira pour ouvrir Budget.' : ''}`
              : bio && !showPassword ? 'Pose ton doigt sur Touch ID.' : 'Saisis ton mot de passe pour ouvrir ta base.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {mode === 'locked' && bio && (
            <Button type="button" size="lg" onClick={() => void fingerprint()} disabled={busy} autoFocus={!showPassword}>
              <Fingerprint />Déverrouiller avec Touch ID
            </Button>
          )}
          {mode === 'locked' && bio && !showPassword && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPassword(true)}>Utiliser le mot de passe</Button>
          )}
          {(showPassword || mode === 'new') && (
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
              <div className="grid gap-1.5">
                <Label htmlFor="pw">Mot de passe</Label>
                <Input id="pw" type="password" autoFocus autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
                  value={pw} onChange={(e) => setPw(e.target.value)} minLength={mode === 'new' ? MIN_PASSWORD : undefined} required />
              </div>
              {mode === 'new' && <>
                <div className="grid gap-1.5">
                  <Label htmlFor="pw2">Confirmation</Label>
                  <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
                </div>
                {demoAllowed && <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={demo} onCheckedChange={(v) => setDemo(v === true)} /> Charger des données de démonstration
                </label>}
              </>}
              <Button type="submit" disabled={busy} variant={bio ? 'outline' : 'default'}>{busy ? 'Un instant…' : mode === 'new' ? 'Créer ma base' : 'Déverrouiller'}</Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                Restaurer une sauvegarde…
              </Button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (f) void go(() => { if (!pw) throw new Error('Saisis d’abord le mot de passe de la sauvegarde.'); return withPassword(() => restoreBackup(f, pw), pw) })
              }} />
            </form>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </main>
  )
}
