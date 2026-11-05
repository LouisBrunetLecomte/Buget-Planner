import { syncEnabled } from './sync'
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
  const [other, setOther] = useState(''), [otherDay, setOtherDay] = useState<number | null>(5)
  const [saved, setSaved] = useState<Record<string, boolean>>({}) // les champs gardent leur valeur, avec « ✓ Enregistré »
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
    const ok = !!attempt(() => mutate((d) => createRecurring(d, { name: label, kind, amount: kind === 'revenu' ? cents : -cents, freq: 'month', interval: 1,
      startDate: `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`, dayOfMonth: day, categoryId: cat?.id ?? null }), { label }), `${label} : ${formatMoney(cents)} ${dayLabel(day)} de chaque mois`)
    if (ok) setSaved({ ...saved, [label]: true })
    return ok
  }
  const datedForm = (kind: 'revenu' | 'charge', label: string, catName: string, id: string, title: string, dayTitle: string, value: string, set: (v: string) => void, day: number | null, setDay: (d: number | null) => void, placeholder: string) => (
    <form className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_11rem_auto]" onSubmit={(e) => { e.preventDefault(); addDated(kind, label, catName, value, day) }}>
      <div className="grid gap-1"><Label htmlFor={id}>{title}</Label><Input id={id} inputMode="decimal" placeholder={placeholder} value={value} disabled={saved[label]} onChange={(e) => set(e.target.value)} /></div>
      <div className="grid gap-1"><Label htmlFor={`${id}d`}>{dayTitle}</Label><DaySelect id={`${id}d`} value={day} onChange={setDay} /></div>
      {saved[label] ? <span role="status" className="pb-2 text-sm text-emerald-700 dark:text-emerald-400">✓ Enregistré</span> : <Button type="submit" variant="secondary">Enregistrer</Button>}
    </form>
  )
  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: 'Bienvenue dans Budget 👋',
      body: (
        <ul className="grid gap-3 text-sm">
          <li className="flex gap-3"><Lock className="mt-0.5 size-5 shrink-0 text-primary" />{syncEnabled() ? 'Tes données sont chiffrées avec ton mot de passe avant d’être synchronisées sur ton compte Quansi : personne d’autre ne peut les lire.' : 'Tes données restent sur cet appareil, chiffrées avec ton mot de passe. Rien n’est envoyé sur Internet.'}</li>
          {hasTouchIdBridge && <li className="flex gap-3"><Fingerprint className="mt-0.5 size-5 shrink-0 text-primary" />À la prochaine ouverture, ton empreinte (Touch ID) suffira.</li>}
          <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />En quelques petites étapes, on prépare ton budget. Chaque étape peut être passée et refaite plus tard.</li>
        </ul>
      ),
    },
    {
      title: '1. Tes comptes',
      body: (
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Ajoute chaque compte que tu veux suivre, avec son <strong>solde actuel</strong> (regarde ton appli bancaire).</p>
          {accounts.length > 0 && <ul className="grid gap-1 rounded-md bg-muted p-2">{accounts.map((a) => <li key={a.id} className="flex justify-between"><span>✓ {a.name}</span><span>{formatMoney(a.openingBalance)}</span></li>)}</ul>}
          <form className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]" onSubmit={(e) => { e.preventDefault(); addAccount() }}>
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
      title: '2. Ton Journal',
      body: (
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Deux façons de remplir Budget, que tu peux mélanger :</p>
          <button type="button" onClick={() => setThen('#/import')} className={`rounded-md border p-3 text-left ${then === '#/import' ? 'border-primary' : ''}`}>
            <span className="font-medium">Importer un relevé</span> (recommandé)<span className="block text-xs text-muted-foreground">Dans ton espace bancaire, exporte tes opérations en CSV, OFX ou PDF, puis Plus → Import. Les doublons sont ignorés : tu peux réimporter sans risque.</span>
          </button>
          <button type="button" onClick={() => setThen('#/operations')} className={`rounded-md border p-3 text-left ${then === '#/operations' ? 'border-primary' : ''}`}>
            <span className="font-medium">Saisir à la main</span><span className="block text-xs text-muted-foreground">Onglet Journal : tape le montant, le libellé, Entrée. Raccourci : touche « n ». Un « + » devant le montant pour un revenu.</span>
          </button>
          <p className="text-xs text-muted-foreground">Clique sur une option : tu y seras emmené à la fin du tutoriel. Les catégories sont devinées automatiquement et apprennent de tes corrections.</p>
        </div>
      ),
    },
    {
      title: '3. Salaire et charges fixes',
      body: (
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">Ce qui arrive et part à date fixe. Dans l’onglet <strong>Budget</strong>, tu pourras ensuite ajouter le reste (« Courses », « Cadeaux »…) : chaque mois, une seule fois ou chaque année.</p>
          {datedForm('revenu', 'Salaire', 'Salaire', 'tu-i', 'Ton salaire net (€)', 'Il arrive', income, setIncome, payDay, setPayDay, '2 100,00')}
          {datedForm('charge', 'Loyer', 'Loyer / crédit', 'tu-r', 'Ton loyer ou crédit (€)', 'Prélevé', rent, setRent, rentDay, setRentDay, '850,00')}
          {datedForm('revenu', 'CAF / aide', 'CAF / aides', 'tu-o', 'Autre revenu (CAF, aide…) (€)', 'Il arrive', other, setOther, otherDay, setOtherDay, '180,00')}
          <p className="text-xs text-muted-foreground">Ces montants sont saisis une seule fois : s’ils changent, modifie-les dans Budget ou dans Salaire, charges et abonnements, et tout suit.</p>
        </div>
      ),
    },
    {
      title: '4. Ce que Budget surveille pour toi',
      body: (
        <ul className="grid list-disc gap-2 pl-5 text-sm text-muted-foreground">
          <li>Après ton premier import, la page <strong>Salaire, charges et abonnements</strong> (menu Plus) repère loyer, abonnements, salaire… Un clic sur « Suivre » et Budget te prévient avant chaque prélèvement.</li>
          <li>L’<strong>Aperçu</strong> affiche ce qu’il te reste à vivre jusqu’à ta paie, par jour, les alertes (budget dépassé, solde bas, doublon…) et tes prochaines échéances.</li>
          <li>Les virements entre tes propres comptes sont repérés pour ne pas compter deux fois.</li>
        </ul>
      ),
    },
    {
      title: '5. Protège tes données',
      body: (
        <div className="grid gap-3 text-sm">
          <p>Ton mot de passe ne peut <strong>pas</strong> être récupéré. Si tu l’oublies ou changes d’ordinateur, seule une <strong>sauvegarde</strong> te permet de tout retrouver.</p>
          <p className="text-muted-foreground">Le fichier est chiffré avec ton mot de passe ; range-le dans iCloud Drive ou sur une clé USB. Budget te le rappellera tous les 30 jours.</p>
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
          <DialogDescription>{step === 0 ? `${steps.length - 1} étapes, environ 2 minutes` : `Étape ${step} sur ${steps.length - 1}`}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1" aria-hidden>{steps.slice(1).map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-primary' : 'bg-muted'}`} />)}</div>
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
