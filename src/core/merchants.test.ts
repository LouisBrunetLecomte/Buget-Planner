import { describe, expect, it } from 'vitest'
import { guessCategories } from './merchants'
import { normalizeLabel } from './labels'

const g = (label: string, amount = -1000) => guessCategories(normalizeLabel(label), amount)[0] ?? null

describe('classement par établissement', () => {
  it.each([
    ['CB CARREFOUR MARKET 12/10 PARIS', 'Courses'], ['CB BOULANGERIE DU MARCHE 03/11', 'Courses'], ['CARTE X1234 LA MIE CALINE BOULANGERIE', 'Courses'],
    ['CB BOULANGER LYON', 'High-tech'], ['CB MCDONALDS PARIS 15', 'Restaurants'], ['CB PIZZERIA DA MARCO', 'Restaurants'], ['CB CAFE DE FLORE', 'Restaurants'],
    ['CB UBER EATS HELP.UBER.COM', 'Livraison'], ['CB UBER TRIP', 'Transports en commun'], ['CB TOTAL ACCESS 0123', 'Carburant'],
    ['CB PARKING INDIGO GARE', 'Péages / parking'], ['CB STATIONNEMENT VILLE DE LYON', 'Péages / parking'], ['PRLV SEPA SNCF VOYAGEURS', 'Transports en commun'],
    ['CB PHARMACIE DES ARCADES', 'Pharmacie'], ['CB DR MARTIN CABINET', 'Médecin'], ['CB DECATHLON', 'Sport'], ['CB CINEMA PATHE BELLECOUR', 'Culture'],
    ['CB AIRBNB * HMXYZ', 'Voyages'], ['PRLV NETFLIX.COM', 'Abonnements'], ['PRLV FREE MOBILE', 'Internet / mobile'], ['PRLV EDF CLIENTS PARTICULIERS', 'Énergie'],
    ['CB ZARA FRANCE', 'Vêtements'], ['CB LEROY MERLIN', 'Maison'], ['CB AMAZON PAYMENTS', 'Shopping'], ['PRLV AMAZON PRIME FR', 'Abonnements'],
    ['PRLV DGFIP IMPOT 2026', 'Impôts & taxes'], ['FRAIS TENUE DE COMPTE', 'Frais bancaires'], ['CB GARAGE DU CENTRE', 'Entretien véhicule'],
  ])('%s → %s', (label, cat) => expect(g(label)).toBe(cat))

  it('le sens compte : un café n’est pas une aide de la CAF, la CAF verse un revenu', () => {
    expect(g('CB CAFE DU COIN')).toBe('Restaurants')
    expect(g('VIR CAF DU RHONE', 25000)).toBe('CAF / aides')
    expect(g('VIR SEPA SALAIRE OCTOBRE', 210000)).toBe('Salaire')
    expect(g('VIR CPAM REMBOURSEMENT', 2500)).toBe('Remboursements')
  })
  it('inconnu → rien plutôt qu’une erreur', () => {
    expect(g('VIR M DUPONT JEAN')).toBeNull()
    expect(g('CB XJ7 SAS 4471')).toBeNull()
  })
  it('donne la catégorie parente en secours', () => expect(guessCategories('LIDL', -500)).toEqual(['Courses', 'Alimentation']))
})
