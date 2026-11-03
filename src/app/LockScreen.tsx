import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createVault, MIN_PASSWORD, restoreBackup, unlock } from './store'

export function LockScreen({ mode }: { mode: 'new' | 'locked' }) {
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [demo, setDemo] = useState(true)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function go(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const submit = () => go(async () => {
    if (mode === 'locked') return unlock(pw)
    if (pw !== pw2) throw new Error('Les deux mots de passe diffèrent.')
    await createVault(pw, demo)
  })

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{mode === 'new' ? 'Bienvenue' : 'Déverrouiller'}</CardTitle>
          <CardDescription>
            {mode === 'new'
              ? 'Tes données restent sur cet appareil, chiffrées avec ce mot de passe. Il est impossible de le récupérer : note-le bien.'
              : 'Saisis ton mot de passe pour ouvrir ta base.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={demo} onCheckedChange={(v) => setDemo(v === true)} /> Charger des données de démonstration
              </label>
            </>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? 'Un instant…' : mode === 'new' ? 'Créer ma base' : 'Déverrouiller'}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              Restaurer une sauvegarde…
            </Button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (f) void go(() => { if (!pw) throw new Error('Saisis d’abord le mot de passe de la sauvegarde.'); return restoreBackup(f, pw) })
            }} />
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
