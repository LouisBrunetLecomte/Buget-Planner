import { useState } from 'react'
import { ArrowLeft, ArrowRight, Fingerprint, Lock, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { daysInMonth, monthOf, today } from '@/core/dates'
import { formatMoney, parseAmount } from '@/core/money'
import { ACCOUNT_TYPES } from '@/db/schema'
import * as repo from '@/db/repo'
import { createRecurring } from '@/db/budgetRepo'
import { exportBackup, mutate, useDb } from './store'
import { hasTouchIdBridge } from './macAuth'
import { download } from './files'
import { attempt, dayLabel, DaySelect, useAccounts } from './ui'

const TYPE: Record<(typeof ACCOUNT_TYPES)[number], string> = { courant: 'Compte courant', epargne: 'Épargne (livret…)', carte: 'Carte (Revolut…)', especes: 'Espèces', credit: 'Crédit', investissement: 'Investissement' }

/** Tutoriel de première connexion : on fait les premiers pas ensemble, chacun pouvant être sauté. */
export function Tutorial() {
  const { db, version } = useDb()
  void version
  const accounts = useAccounts()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('Compte courant'), [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]>('courant'), [balance, setBalance] = useState('')
  const [income, setIncome] = useState(''), [payDay, setPayDay] = useState<number | null>(28), [rent, setRent] = useState(''), [rentDay, setRentDay] = useState<number | null>(5)
  const [then, setThen] = useState('#/accueil')
  if (repo.getSetting<boolean>(db, 'tutorialDone')) return null

  const finish = () => { mutate((d) => repo.putSetting(d, 'tutorialDone', true), { undoable: false }); location.hash = then }
  function addAccount() {
    const cents = balance.trim() ? parseAmount(balance) : 0
    if (!name.trim() || cents === null) return toast.error('Nom ou solde invalide')
    if (attempt(() => mutate((d) => repo.createAccount(d, { name: name.trim(), type, openingBalance: cents, balanceDate: today() }), { label: `Compte ${name.trim()}` }), `« ${name.trim()} » ajouté`)) { setName(''); setBalance('') }
  }
  /** Salaire et loyer deviennent des échéances datées : budget, calendrier, reste à vivre et alertes les utilisent tous. */
  function addDated(kind: 'revenu' | 'charge', label: string, catName: string, value: string, day: number | null) {
    const cents = parseAmount(value)
    const cat = repo.listCategories(db).find((c) => c.name === catName)
    if (!cents || cents <= 0) { toast.error('Montant invalide'); return false }
    if (!day) { toast.error('Choisis le jour'); return false }
    const m = monthOf(today())
    return !!attempt(() => mutate((d) => createRecurring(d, { name: label, kind, amount: kind === 'revenu' ? cents : -cents, freq: 'month', interval: 1,
      startDate: `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`, dayOfMonth: day, categoryId: cat?.id ?? null }), { label }), `${label} : ${formatMoney(cents)} ${dayLabel(day)} de chaque mois`)
  }
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: 'Bienvenue dans Buget 👋',
      body: (
        <ul className="grid gap-3 text-sm">
          <li className="flex gap-3"><Lock className="mt-0.5 size-5 shrink-0 text-primary" />Tes données restent sur cet appareil, chiffrées avec ton mot de passe. Rien n’est envoyé sur Internet.</li>
          {hasTouchIdBridge && <li className="flex gap-3"><Fingerprint className="mt-0.5 size-5 shrink-0 text-primary" />À la prochaine ouverture, ton empreinte (Touch ID) suffira.</li>}
          <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />En 5 petites étapes, on prépare ton budget. Chaque étape peut être passée et refaite plus tard.</li>
        </ul>
      ),
    },
    {
      title: '1. Tes comptes',
      body: (
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Ajoute chaque compte que tu veux suivre, avec son <strong>solde actuel</strong> (regarde ton appli bancaire).</p>
          {accounts.length > 0 && <ul className="grid gap-1 rounded-md bg-muted p-2">{accounts.map((a) => <li key={a.id} className="flex justify-between"><span>✓ {a.name}</span><span>{formatMoney(a.openingBalance)}</span></li>)}</ul>}
          <form className="grid gap-2 sm:grid-cols-[1fr_10rem]" onSubmit={(e) => { e.preventDefault(); addAccount() }}>
            <div className="grid gap-1"><Label htmlFor="tu-n">Nom</Label><Input id="tu-n" value={name} placeholder="ex : LCL, Revolut, Livret A" onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1"><Label htmlFor="tu-t">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger id="tu-t" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1"><Label htmlFor="tu-b">Solde actuel (€)</Label><Input id="tu-b" inputMode="decimal" placeholder="1 250,00" value={balance} onChange={(e) => setBalance(e.target.value)} /></div>
            <Button type="submit" variant="secondary" className="self-end">Ajouter ce compte</Button>
          </form>
        </div>
      ),
    },
    {
      title: '2. Tes opérations',
      body: (
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Deux façons de remplir Buget, que tu peux mélanger :</p>
          <button type="button" onClick={() => setThen('#/import')} className={`rounded-md border p-3 text-left ${then === '#/import' ? 'border-primary' : ''}`}>
            <span className="font-medium">Importer un relevé</span> (recommandé)<span className="block text-xs text-muted-foreground">Dans ton espace bancaire, exporte tes opérations en CSV, OFX ou PDF, puis Plus → Import. Les doublons sont ignorés : tu peux réimporter sans risque.</span>
          </button>
          <button type="button" onClick={() => setThen('#/operations')} className={`rounded-md border p-3 text-left ${then === '#/operations' ? 'border-primary' : ''}`}>
            <span className="font-medium">Saisir à la main</span><span className="block text-xs text-muted-foreground">Onglet Opérations : tape le montant, le libellé, Entrée. Raccourci : touche « n ». Un « + » devant le montant pour un revenu.</span>
          </button>
          <p className="text-xs text-muted-foreground">Clique sur une option : tu y seras emmené à la fin du tutoriel. Les catégories sont devinées automatiquement et apprennent de tes corrections.</p>
        </div>
      ),
    },
    {
      title: '3. Ton budget',
      body: (
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Dans l’onglet <strong>Budget</strong>, tu fixes un montant par catégorie ou par libellé (« Cadeaux », « Coiffeur »…), <strong>tous les mois à partir de la date que tu choisis</strong>, avec un jour précis si tu veux. Pour un mois particulier (vacances, Noël), crée une <strong>exception</strong>.</p>
          <form className="grid grid-cols-[1fr_11rem_auto] items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (addDated('revenu', 'Salaire', 'Salaire', income, payDay)) setIncome('') }}>
            <div className="grid gap-1"><Label htmlFor="tu-i">Ton salaire net (€)</Label><Input id="tu-i" inputMode="decimal" placeholder="2 100,00" value={income} onChange={(e) => setIncome(e.target.value)} /></div>
            <div className="grid gap-1"><Label htmlFor="tu-id">Il arrive</Label><DaySelect id="tu-id" value={payDay} onChange={setPayDay} /></div>
            <Button type="submit" variant="secondary">Enregistrer</Button>
          </form>
          <form className="grid grid-cols-[1fr_11rem_auto] items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (addDated('charge', 'Loyer', 'Loyer / crédit', rent, rentDay)) setRent('') }}>
            <div className="grid gap-1"><Label htmlFor="tu-r">Ton loyer ou crédit (€)</Label><Input id="tu-r" inputMode="decimal" placeholder="850,00" value={rent} onChange={(e) => setRent(e.target.value)} /></div>
            <div className="grid gap-1"><Label htmlFor="tu-rd">Prélevé</Label><DaySelect id="tu-rd" value={rentDay} onChange={setRentDay} /></div>
            <Button type="submit" variant="secondary">Enregistrer</Button>
          </form>
          <p className="text-xs text-muted-foreground">Ces montants sont saisis une seule fois : si ton loyer change, modifie-le n’importe où (Budget ou Récurrences) et tout suit.</p>
        </div>
      ),
    },
    {
      title: '4. Charges fixes et alertes',
      body: (
        <ul className="grid list-disc gap-2 pl-5 text-sm text-muted-foreground">
          <li>Après ton premier import, l’onglet <strong>Récurrences → Détection</strong> repère loyer, abonnements, salaire… Un clic sur « Suivre » et Buget te prévient avant chaque prélèvement.</li>
          <li>L’<strong>Accueil</strong> affiche ton reste à vivre par jour, les alertes (budget dépassé, solde bas, doublon…) et tes prochaines échéances.</li>
          <li>Les virements entre tes propres comptes sont repérés pour ne pas compter deux fois.</li>
        </ul>
      ),
    },
    {
      title: '5. Protège tes données',
      body: (
        <div className="grid gap-3 text-sm">
          <p>Ton mot de passe ne peut <strong>pas</strong> être récupéré. Si tu l’oublies ou changes d’ordinateur, seule une <strong>sauvegarde</strong> te permet de tout retrouver.</p>
          <p className="text-muted-foreground">Le fichier est chiffré avec ton mot de passe ; range-le dans iCloud Drive ou sur une clé USB. Buget te le rappellera tous les 30 jours.</p>
          <Button variant="secondary" className="justify-self-start" onClick={() => void exportBackup().then((bl) => { download(bl, `buget-${today()}.json`, 'application/json'); mutate((d) => repo.putSetting(d, 'lastBackup', today()), { undoable: false }); toast.success('Sauvegarde téléchargée') })}>Télécharger une sauvegarde maintenant</Button>
        </div>
      ),
    },
  ]
  const last = step === steps.length - 1
  return (
    <Dialog open onOpenChange={(o) => { if (!o) finish() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{steps[step]!.title}</DialogTitle>
          <DialogDescription>Étape {step + 1} sur {steps.length}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1" aria-hidden>{steps.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-muted'}`} />)}</div>
        {steps[step]!.body}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={finish}>Passer le tutoriel</Button>
          <div className="flex gap-2">
            {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}><ArrowLeft />Précédent</Button>}
            <Button onClick={() => (last ? finish() : setStep(step + 1))}>{last ? 'C’est parti !' : <>Suivant<ArrowRight /></>}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
