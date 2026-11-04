import type { Db } from './client'
import { category, rule } from './schema'

type Kind = 'depense' | 'revenu' | 'transfert'
// 50/30/20 : besoins essentiels vs envies (les sous-catégories héritent, sauf exceptions ci-dessous)
const BESOIN = new Set(['Logement', 'Alimentation', 'Transport', 'Santé', 'Impôts & taxes', 'Frais bancaires'])
const ENVIE = new Set(['Loisirs', 'Abonnements', 'Shopping', 'Dons', 'Divers', 'Restaurants', 'Livraison'])
const bucketOf = (n: string) => (ENVIE.has(n) ? 'envie' : BESOIN.has(n) ? 'besoin' : null)
const TREE: [Kind, string, string, string[]][] = [
  ['revenu', 'Revenus', '#16a34a', ['Salaire', 'Primes', 'Freelance', 'CAF / aides', 'Loyers perçus', 'Remboursements', 'Autres revenus']],
  ['depense', 'Logement', '#2563eb', ['Loyer / crédit', 'Énergie', 'Internet / mobile', 'Assurance habitation', 'Charges']],
  ['depense', 'Alimentation', '#ea580c', ['Courses', 'Restaurants', 'Livraison']],
  ['depense', 'Transport', '#0891b2', ['Carburant', 'Transports en commun', 'Entretien véhicule', 'Assurance auto', 'Péages / parking']],
  ['depense', 'Santé', '#db2777', ['Médecin', 'Pharmacie', 'Mutuelle']],
  ['depense', 'Loisirs', '#9333ea', ['Sorties', 'Voyages', 'Sport', 'Culture']],
  ['depense', 'Abonnements', '#7c3aed', []],
  ['depense', 'Shopping', '#ca8a04', ['Vêtements', 'Maison', 'High-tech']],
  ['depense', 'Impôts & taxes', '#475569', []],
  ['depense', 'Frais bancaires', '#dc2626', []],
  ['depense', 'Dons', '#059669', []],
  ['depense', 'Remboursements / dettes', '#b45309', []],
  ['depense', 'Divers', '#6b7280', []],
  ['transfert', 'Virements internes', '#64748b', []],
]

// Enseignes françaises courantes → sous-catégorie. Règles modifiables par l'utilisateur.
const RULES: [string, string][] = [
  ['CARREFOUR', 'Courses'], ['AUCHAN', 'Courses'], ['LECLERC', 'Courses'], ['LIDL', 'Courses'], ['INTERMARCHE', 'Courses'],
  ['MONOPRIX', 'Courses'], ['FRANPRIX', 'Courses'], ['SUPER U', 'Courses'], ['ALDI', 'Courses'], ['PICARD', 'Courses'],
  ['UBER EATS', 'Livraison'], ['DELIVEROO', 'Livraison'], ['MCDONALD', 'Restaurants'],
  ['SNCF', 'Transports en commun'], ['RATP', 'Transports en commun'], ['NAVIGO', 'Transports en commun'],
  ['TOTAL', 'Carburant'], ['ESSO', 'Carburant'], ['SHELL', 'Carburant'], ['VINCI AUTOROUTES', 'Péages / parking'],
  ['EDF', 'Énergie'], ['ENGIE', 'Énergie'], ['TOTALENERGIES', 'Énergie'],
  ['FREE MOBILE', 'Internet / mobile'], ['FREE TELECOM', 'Internet / mobile'], ['ORANGE', 'Internet / mobile'], ['SFR', 'Internet / mobile'], ['BOUYGUES', 'Internet / mobile'],
  ['NETFLIX', 'Abonnements'], ['SPOTIFY', 'Abonnements'], ['DEEZER', 'Abonnements'], ['DISNEY PLUS', 'Abonnements'], ['CANAL', 'Abonnements'],
  ['PHARMACIE', 'Pharmacie'], ['DOCTOLIB', 'Médecin'], ['AMAZON', 'Shopping'], ['FNAC', 'High-tech'], ['IKEA', 'Maison'],
  ['DGFIP', 'Impôts & taxes'], ['IMPOT', 'Impôts & taxes'], ['COTISATION', 'Frais bancaires'], ['COMMISSION', 'Frais bancaires'],
  ['CAF', 'CAF / aides'], ['BOULANGERIE', 'Courses'], ['KEBAB', 'Restaurants'], ['SOIREE', 'Sorties'],
]

export function seedDefaults(db: Db) {
  const byName = new Map<string, string>()
  for (const [kind, name, color, children] of TREE) {
    const parent = db.insert(category).values({ name, kind, color, bucket: bucketOf(name), fiscal: name === 'Dons' ? 'don' : null }).returning().get()
    byName.set(name, parent.id)
    for (const c of children) byName.set(c, db.insert(category).values({ name: c, kind, color, parentId: parent.id, bucket: ENVIE.has(c) ? 'envie' : null }).returning().get().id)
  }
  for (const [pattern, cat] of RULES) db.insert(rule).values({ pattern, categoryId: byName.get(cat)! }).run()
  return byName
}
