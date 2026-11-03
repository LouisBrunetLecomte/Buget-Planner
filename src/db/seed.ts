import type { Db } from './client'
import { seedDefaults } from './defaults'
import { addTransaction, createAccount, linkTransfer, putSetting, saveRates } from './repo'
import { createRecurring, setBudget, setCategoryOptions, suggestBudget } from './budgetRepo'
import { addMonths } from '@/core/dates'
import { paymentFor } from '@/core/debt'
import { addContribution, createAsset, createDebt, createGoal, createSavingsRule, saveScenario, setAssetValue } from './planningRepo'

/** Générateur pseudo-aléatoire déterministe : la démo est identique à chaque chargement. */
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Démo : 6 mois d'un salarié parisien, un livret, un compte Revolut EUR et un en USD. */
export function seedDemo(db: Db, end = new Date()) {
  const cat = seedDefaults(db)
  const r = rng(42)
  const courant = createAccount(db, { name: 'Compte courant', type: 'courant', bank: 'Ma banque', openingBalance: 185_000 })
  const livret = createAccount(db, { name: 'Livret A', type: 'epargne', bank: 'Ma banque', openingBalance: 640_000 })
  const revolut = createAccount(db, { name: 'Revolut', type: 'courant', bank: 'Revolut', openingBalance: 12_000 })
  const usd = createAccount(db, { name: 'Revolut USD', type: 'courant', bank: 'Revolut', currency: 'USD', openingBalance: 0 })

  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1))
  // taux USD fictifs mais plausibles, pour que la démo marche hors ligne
  const rates: Record<string, number> = {}
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) rates[iso(d)] = 0.86 + r() * 0.04
  saveRates(db, 'USD', rates)

  const add = (accountId: string, date: Date, amount: number, label: string, c?: string) =>
    date <= end ? addTransaction(db, { accountId, date: iso(date), amount, label, ...(c ? { categoryId: cat.get(c)! } : {}) }) : null

  for (let m = 0; m < 6; m++) {
    const y = start.getUTCFullYear(), mo = start.getUTCMonth() + m
    const day = (d: number) => new Date(Date.UTC(y, mo, d))
    add(courant.id, day(28), 265_000, 'VIR SEPA SALAIRE ACME SAS', 'Salaire')
    add(courant.id, day(5), -92_000, 'PRLV SEPA SCI LES TILLEULS LOYER', 'Loyer / crédit')
    add(courant.id, day(8), -6_420, 'PRLV SEPA EDF CLIENTS PARTICULIERS')
    add(courant.id, day(10), -2_999, 'PRLV SEPA FREE TELECOM')
    add(courant.id, day(12), -1_999, 'PRLV SEPA FREE MOBILE')
    add(courant.id, day(15), m >= 4 ? -1_499 : -1_349, 'CB NETFLIX.COM') // hausse de prix détectable
    add(courant.id, day(3), -8_640, 'PRLV SEPA NAVIGO ANNUEL')
    add(courant.id, day(6), -3_200, 'PRLV SEPA MUTUELLE HARMONIE', 'Mutuelle')
    add(courant.id, day(2), -800, 'COTISATION CARTE VISA')
    if (m % 3 === 1) add(courant.id, day(15), -24_500, 'PRLV SEPA DGFIP IMPOT')
    if (m === 2) add(courant.id, day(20), 45_000, 'VIR PRIME EXCEPTIONNELLE ACME', 'Primes')
    // épargne mensuelle : virement interne courant → livret
    const a = add(courant.id, day(29), -30_000, 'VIR LIVRET A EPARGNE'), b = add(livret.id, day(29), 30_000, 'VIR DEPUIS COMPTE COURANT')
    if (a && b) linkTransfer(db, [a.id, b.id])
    // recharge Revolut (virement interne non lié : servira de suggestion dans l'appli)
    add(courant.id, day(14), -20_000, 'VIR REVOLUT TOP UP')
    add(revolut.id, day(15), 20_000, 'Top-up by *1234')
    for (let k = 0; k < 9; k++) {
      const shop = ['CB CARREFOUR MARKET', 'CB MONOPRIX', 'CB LIDL', 'CB PICARD'][k % 4]!
      add(courant.id, day(1 + Math.floor(r() * 27)), -Math.round(1500 + r() * 7000), `${shop} ${String(k + 10).padStart(2, '0')}/${String(mo % 12 + 1).padStart(2, '0')}`)
    }
    for (let k = 0; k < 6; k++) {
      const what = ['UBER EATS', 'Le Petit Bistrot', 'SNCF CONNECT', 'Pharmacie du Centre', 'AMAZON EU', 'Cinéma UGC'][Math.floor(r() * 6)]!
      add(revolut.id, day(1 + Math.floor(r() * 27)), -Math.round(800 + r() * 5000), what, what === 'Cinéma UGC' ? 'Culture' : what === 'Le Petit Bistrot' ? 'Restaurants' : undefined)
    }
    add(courant.id, day(18), -Math.round(3000 + r() * 4000), 'CB TOTAL ACCESS 92')
    if (m === 4) { add(usd.id, day(10), 50_000, 'Exchanged to USD'); add(usd.id, day(12), -18_900, 'Hotel NYC'); add(usd.id, day(13), -4_250, 'Joe’s Diner', 'Restaurants') }
  }

  // récurrences suivies + une charge annuelle à provisionner
  const ym = (offset: number, d: number) => `${addMonths(iso(start).slice(0, 7), offset)}-${String(d).padStart(2, '0')}`
  const rec = (name: string, kind: 'revenu' | 'charge' | 'abonnement', amount: number, d: number, pattern: string, c?: string, freq: 'month' | 'year' = 'month', offset = 0) =>
    createRecurring(db, { name, kind, amount, freq, interval: freq === 'month' && pattern === 'DGFIP' ? 3 : 1, startDate: ym(offset, d), pattern, accountId: courant.id, categoryId: c ? cat.get(c)! : null })
  rec('Salaire', 'revenu', 265_000, 28, 'SALAIRE ACME', 'Salaire')
  rec('Loyer', 'charge', -92_000, 5, 'SCI LES TILLEULS', 'Loyer / crédit')
  rec('EDF', 'charge', -6_420, 8, 'EDF', 'Énergie')
  rec('Box internet', 'abonnement', -2_999, 10, 'FREE TELECOM', 'Internet / mobile')
  rec('Forfait mobile', 'abonnement', -1_999, 12, 'FREE MOBILE', 'Internet / mobile')
  rec('Netflix', 'abonnement', -1_349, 15, 'NETFLIX', 'Abonnements')
  rec('Mutuelle', 'charge', -3_200, 6, 'MUTUELLE HARMONIE', 'Mutuelle')
  rec('Impôt sur le revenu', 'charge', -24_500, 15, 'DGFIP', 'Impôts & taxes', 'month', 1)
  rec('Assurance habitation', 'charge', -18_000, 20, 'ASSURANCE HABITATION', 'Assurance habitation', 'year', 7)

  // budget proposé à partir de l'historique, une exception "Vacances" le mois prochain, report sur les loisirs
  const month = iso(end).slice(0, 7)
  for (const s of suggestBudget(db, month)) setBudget(db, s.categoryId, addMonths(month, -5), s.amount, 'all')
  setBudget(db, cat.get('Loisirs')!, addMonths(month, 1), 60_000, 'month', 'Vacances')
  setCategoryOptions(db, cat.get('Loisirs')!, { rollover: true })

  // objectifs, règle d'arrondi, prêt auto, assurance-vie, un scénario
  const japon = createGoal(db, { name: 'Voyage au Japon', target: 400_000, deadline: `${addMonths(month, 10)}-30` })
  for (let k = 5; k >= 1; k--) addContribution(db, japon.id, `${addMonths(month, -k)}-28`, 25_000)
  createGoal(db, { name: 'Épargne de précaution', target: 1_000_000, accountId: livret.id })
  createSavingsRule(db, { kind: 'arrondi', value: 100, goalId: japon.id })
  createDebt(db, { name: 'Prêt auto', principal: 1_200_000, rate: 3.9, payment: paymentFor(1_200_000, 3.9, 48), startMonth: addMonths(month, -14) })
  const av = createAsset(db, 'Assurance-vie', 'investissement', 1_500_000, `${addMonths(month, -11)}-01`)
  for (let k = 10; k >= 0; k--) setAssetValue(db, av.id, `${addMonths(month, -k)}-01`, 1_500_000 + (11 - k) * 18_000)
  saveScenario(db, { name: 'Perte d’emploi 3 mois', changes: [{ type: 'mensuel', label: 'Salaire remplacé par l’ARE', amount: -95_000, from: addMonths(month, 2), to: addMonths(month, 4) }] })
  putSetting(db, 'tutorialDone', true) // la démo est déjà remplie : pas de tutoriel
  putSetting(db, 'periodStartDay', 1) // démo en mois calendaires (tests stables)
  return { accounts: [courant, livret, revolut, usd] }
}
