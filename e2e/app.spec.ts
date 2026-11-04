import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PW = 'mot-de-passe-e2e'

async function createVault(page: Page, demo = true) {
  await page.goto(demo ? '/?demo' : '/')
  await page.getByLabel('Mot de passe', { exact: true }).fill(PW)
  await page.getByLabel('Confirmation').fill(PW)
  if (demo) await page.getByRole('checkbox', { name: /démonstration/ }).click()
  await page.getByRole('button', { name: 'Créer ma base' }).click()
  // base vierge : le tutoriel s'ouvre par-dessus l'accueil
  await expect(demo ? page.getByRole('heading', { name: 'Aperçu' }) : page.getByRole('dialog').getByText('Bienvenue dans Buget')).toBeVisible({ timeout: 20_000 })
}
const nav = (page: Page, route: string) => page.evaluate((r) => { location.hash = `/${r}` }, route) // sans rechargement (sinon l'app se reverrouille)

test('création, verrouillage, mauvais mot de passe, persistance', async ({ page }) => {
  await createVault(page)
  await expect(page.getByText(/Libre à dépenser|Il te manque/)).toBeVisible()
  await page.getByRole('button', { name: 'Verrouiller' }).click()
  await page.getByLabel('Mot de passe').fill('pas-le-bon')
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('alert')).toHaveText('Mot de passe incorrect.')
  await page.reload()
  await page.getByLabel('Mot de passe').fill(PW)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('heading', { name: 'Aperçu' })).toBeVisible({ timeout: 20_000 })
})

test('saisie rapide en moins de 3 secondes, puis annulation', async ({ page }) => {
  await createVault(page)
  await nav(page, 'operations')
  const t0 = Date.now()
  await page.getByLabel(/^Montant/).fill('4,20')
  await page.getByLabel('Libellé', { exact: true }).fill('Boulangerie e2e')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('row', { name: /Boulangerie e2e/ })).toBeVisible()
  expect(Date.now() - t0).toBeLessThan(3000)
  await expect(page.getByRole('row', { name: /Boulangerie e2e/ })).toContainText(/4,20\s€/) // colonne Débit
  await page.getByRole('button', { name: /^Annuler : Ajout/ }).click()
  await expect(page.getByRole('row', { name: /Boulangerie e2e/ })).toHaveCount(0)
})

test('import CSV puis réimport sans doublons', async ({ page }) => {
  await createVault(page)
  await nav(page, 'import')
  const csv = { name: 'releve.csv', mimeType: 'text/csv', buffer: Buffer.from('Date;Libellé;Montant\n02/10/2026;CB TEST E2E;-12,34\n03/10/2026;VIR TEST E2E;100,00\n') }
  await page.locator('#ifile').setInputFiles(csv)
  await page.getByRole('button', { name: 'Importer 2 opération(s)' }).click()
  await expect(page.getByText('2 opération(s) importée(s)')).toBeVisible()
  await page.locator('#ifile').setInputFiles(csv)
  await expect(page.getByText(/0 nouvelle\(s\) · 2 doublon\(s\)/)).toBeVisible()
})

test('budget : exception « ce mois seulement » puis annulation en un clic', async ({ page }) => {
  await createVault(page)
  await nav(page, 'budget')
  await page.getByRole('button', { name: 'Alimentation', exact: true }).click()
  await page.getByLabel('Budget (€)').fill('900')
  await page.getByRole('radio', { name: /seulement/ }).check()
  await page.getByLabel('Motif de l’exception').fill('Invités')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Exception : Invités')).toBeVisible()
  await page.getByRole('button', { name: 'Mois suivant' }).click()
  await expect(page.getByText('Exception : Invités')).toHaveCount(0)
  await page.getByRole('button', { name: 'Mois précédent' }).click()
  await page.getByRole('button', { name: 'Annuler l’exception' }).click()
  await expect(page.getByText('Exception : Invités')).toHaveCount(0)
})

test('accessibilité (axe, WCAG AA) : aucune violation grave', async ({ page }) => {
  await createVault(page)
  for (const route of ['accueil', 'bilan', 'operations', 'budget', 'recurrences', 'analyses', 'patrimoine', 'simulations', 'import', 'reglages']) {
    await nav(page, route)
    await expect(page.locator('main h1')).toBeVisible()
    await page.waitForTimeout(800) // animations des graphiques
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(bad.map((v) => `${route}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
  }
})

test('base vierge : aucune donnée, tutoriel de première connexion', async ({ page }) => {
  await createVault(page, false)
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText('Bienvenue dans Buget')).toBeVisible()
  await expect(dlg.getByText('5 étapes, environ 2 minutes')).toBeVisible()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await expect(dlg.getByText('Étape 1 sur 5')).toBeVisible() // même nombre que l'annonce
  await dlg.getByLabel('Nom').fill('Mon compte LCL')
  await dlg.getByLabel('Solde actuel (€)').fill('1 250')
  await dlg.getByRole('button', { name: 'Ajouter ce compte' }).click()
  await expect(dlg.getByText('✓ Mon compte LCL')).toBeVisible()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  const salary = dlg.getByLabel('Ton salaire net (€)')
  expect((await salary.boundingBox())!.width).toBeGreaterThanOrEqual(120) // lisible sur mobile (« 2 100 », pas « 21 »)
  await salary.fill('2100')
  await dlg.getByRole('button', { name: 'Enregistrer' }).first().click()
  await expect(dlg.getByText('✓ Enregistré')).toBeVisible()
  await expect(salary).toHaveValue('2100') // le champ garde sa valeur
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByRole('button', { name: 'C’est parti !' }).click()
  await expect(dlg).toHaveCount(0)
  await nav(page, 'operations')
  await expect(page.getByText('Aucune opération')).toBeVisible() // vraiment vide
  await nav(page, 'comptes')
  await expect(page.getByText('Mon compte LCL').first()).toBeVisible()
  await page.reload()
  await page.getByLabel('Mot de passe').fill(PW)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('heading', { name: 'Comptes' })).toBeVisible({ timeout: 20_000 }) // on revient où on était
  await expect(page.getByRole('dialog')).toHaveCount(0) // le tutoriel ne revient pas
})

test('budget : nouveaux libellés « tous les mois depuis », triés du plus gros au plus petit', async ({ page }) => {
  await createVault(page, false)
  await page.getByRole('button', { name: 'Passer le tutoriel' }).click()
  await nav(page, 'budget')
  await page.getByRole('button', { name: 'Ajouter une ligne' }).click()
  const form = page.getByRole('form', { name: 'Nouvelle ligne de budget' })
  for (const [l, a] of [['Coiffeur', '30'], ['Courses maison', '450'], ['Cadeaux', '80']]) {
    await form.getByLabel('Catégorie', { exact: true }).fill(l!)
    await form.getByLabel('Montant (€)').fill(a!)
    await form.getByRole('button', { name: 'Ajouter' }).click()
    await expect(page.getByRole('button', { name: l, exact: true })).toBeVisible()
  }
  const order = await page.locator('tbody:has(th:has-text("Dépenses variables")) td > button.text-left').allTextContents()
  expect(order).toEqual(['Courses maison', 'Cadeaux', 'Coiffeur'])
  await page.getByRole('button', { name: 'Mois suivant' }).click()
  await expect(page.getByRole('button', { name: 'Coiffeur', exact: true })).toBeVisible() // valable les mois suivants
})

test('le loyer saisi une fois, modifié dans le Budget, change partout', async ({ page }) => {
  await createVault(page, false)
  const dlg = page.getByRole('dialog')
  for (let i = 0; i < 3; i++) await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Ton loyer ou crédit (€)').fill('850')
  await dlg.getByRole('button', { name: 'Enregistrer' }).nth(1).click()
  await dlg.getByRole('button', { name: 'Passer le tutoriel' }).click()
  await nav(page, 'budget')
  const row = page.getByRole('row', { name: /^Loyer/ })
  await expect(row).toContainText('850,00 €')
  await row.getByRole('button', { name: 'Loyer', exact: true }).click()
  await page.getByLabel('Montant de Loyer').fill('900')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(row).toContainText('900,00 €')
  await nav(page, 'recurrences')
  await expect(page.getByText('-900,00 €').first()).toBeVisible()
  await expect(page.getByText(/Mensuel, le 5/)).toBeVisible()
})

test('salaire le 12 : le budget va du 12 au 11 du mois suivant', async ({ page }) => {
  await createVault(page, false)
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Nom').fill('LCL')
  await dlg.getByLabel('Solde actuel (€)').fill('1000')
  await dlg.getByRole('button', { name: 'Ajouter ce compte' }).click()
  for (let i = 0; i < 2; i++) await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Ton salaire net (€)').fill('2100')
  await dlg.locator('#tu-id').click()
  await page.getByRole('option', { name: 'le 12', exact: true }).click()
  await dlg.getByRole('button', { name: 'Enregistrer' }).first().click()
  await dlg.getByRole('button', { name: 'Passer le tutoriel' }).click()
  await nav(page, 'budget')
  await expect(page.getByText(/12 \S+ → 11 \S+ · en cours/)).toBeVisible()
  await nav(page, 'accueil')
  await expect(page.getByText(/ta paie du 12 /).first()).toBeVisible()
})

test('cocher « reçu » / « payé » fait avancer le budget et le solde', async ({ page }) => {
  await createVault(page, false)
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Nom').fill('LCL')
  await dlg.getByLabel('Solde actuel (€)').fill('100')
  await dlg.getByRole('button', { name: 'Ajouter ce compte' }).click()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Ton loyer ou crédit (€)').fill('850')
  await dlg.getByRole('button', { name: 'Enregistrer' }).nth(1).click()
  await dlg.getByRole('button', { name: 'Passer le tutoriel' }).click()
  await nav(page, 'budget')
  const tick = page.getByRole('checkbox', { name: 'Loyer payé' })
  await tick.check()
  await expect(page.getByRole('row', { name: /^Loyer/ })).toContainText(/850,00\s€.*850,00\s€/)
  await nav(page, 'comptes')
  await expect(page.getByText('-750,00 €').first()).toBeVisible() // 100 € − 850 € de loyer payé
  await nav(page, 'budget')
  await page.getByRole('checkbox', { name: 'Loyer payé' }).uncheck()
  await nav(page, 'comptes')
  await expect(page.getByText('100,00 €').first()).toBeVisible()
})

test('accueil : le solde se corrige avec le montant de la banque, sans double compte', async ({ page }) => {
  await createVault(page, false)
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Nom').fill('LCL')
  await dlg.getByLabel('Solde actuel (€)').fill('1000')
  await dlg.getByRole('button', { name: 'Ajouter ce compte' }).click()
  await dlg.getByRole('button', { name: 'Passer le tutoriel' }).click()
  await page.getByRole('button', { name: '1 000,00 €' }).click()
  await page.getByLabel(/LCL : ce qu’affiche ta banque/).fill('612,34')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('button', { name: '612,34 €' })).toBeVisible()
  await expect(page.getByText(/Confirmé le/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prévisions' })).toBeVisible()
})

// ---------- critères d'acceptation de la spec du 3 novembre (date simulée : 3/11/2026) ----------

/** Base vierge le 3/11/2026 : compte, salaire (et CAF) par le tutoriel, puis tutoriel fermé. */
async function setup(page: Page, o: { balance: string; salary: string; payDay: string; caf?: string }) {
  await page.clock.setFixedTime(new Date('2026-11-03T10:00:00'))
  await createVault(page, false)
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Nom').fill('LCL')
  await dlg.getByLabel('Solde actuel (€)').fill(o.balance)
  await dlg.getByRole('button', { name: 'Ajouter ce compte' }).click()
  await expect(dlg.getByText('✓ LCL')).toBeVisible()
  for (let i = 0; i < 2; i++) await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Ton salaire net (€)').fill(o.salary)
  await dlg.locator('#tu-id').click()
  await page.getByRole('option', { name: o.payDay, exact: true }).click()
  await dlg.locator('form').filter({ has: page.locator('#tu-i') }).getByRole('button', { name: 'Enregistrer' }).click()
  if (o.caf) {
    await dlg.getByLabel(/Autre revenu/).fill(o.caf)
    await dlg.locator('form').filter({ has: page.locator('#tu-o') }).getByRole('button', { name: 'Enregistrer' }).click()
  }
  await expect(dlg.getByText('✓ Enregistré').first()).toBeVisible()
  await dlg.getByRole('button', { name: 'Passer le tutoriel' }).click()
  await expect(dlg).toHaveCount(0)
}

async function quickAdd(page: Page, amount: string, label: string, date?: string) {
  const form = page.getByRole('form', { name: 'Saisie rapide' })
  await form.getByLabel(/^Montant/).fill(amount)
  await form.getByLabel('Libellé', { exact: true }).fill(label)
  if (date) await form.getByLabel('Date').fill(date)
  await form.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByRole('row', { name: new RegExp(label) }).first()).toBeVisible()
}

test('CAF saisie au Journal : elle disparaît de « À payer et à recevoir » (pas de double compte)', async ({ page }) => {
  await setup(page, { balance: '312,80', salary: '980', payDay: 'le 12', caf: '180' })
  const due = page.locator('section').filter({ has: page.getByRole('heading', { name: 'À payer et à recevoir' }) })
  await expect(due.getByText('CAF / aide')).toBeVisible()
  await nav(page, 'operations')
  await quickAdd(page, '+180', 'CAF')
  await nav(page, 'accueil')
  await expect(page.getByRole('heading', { name: 'Aperçu' })).toBeVisible()
  await expect(page.getByText('CAF / aide')).toHaveCount(0)
})

test('paie le 28 : Budget « Novembre 2026 », Analyses « nov. 26 », ponctuel de décembre', async ({ page }) => {
  await setup(page, { balance: '640', salary: '1450', payDay: 'le 28' })
  await nav(page, 'budget')
  await expect(page.getByRole('heading', { name: 'Novembre 2026', level: 1 })).toBeVisible()
  await expect(page.getByText('28 oct. → 27 nov. · en cours')).toBeVisible()
  // ponctuel « une seule fois » en décembre : présent en décembre seulement
  await page.getByRole('button', { name: 'Ajouter une ligne' }).click()
  const form = page.getByRole('form', { name: 'Nouvelle ligne de budget' })
  await form.getByLabel('Catégorie', { exact: true }).fill('Week-end Annecy')
  await form.getByLabel('Montant (€)').fill('220')
  await form.getByLabel('Répéter').click()
  await page.getByRole('option', { name: 'Une seule fois' }).click()
  await form.getByRole('button', { name: 'Période, suivant' }).click()
  await expect(form.getByRole('combobox', { name: 'Période' })).toHaveText('Décembre 2026')
  await form.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(page.getByText(/« Week-end Annecy » ajouté : Décembre 2026/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Week-end Annecy', exact: true })).toHaveCount(0) // pas en novembre
  await page.getByRole('button', { name: 'Mois suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Décembre 2026', level: 1 })).toBeVisible()
  await expect(page.getByRole('row', { name: /Week-end Annecy/ })).toContainText('220,00')
  await expect(page.getByTestId('gap-Revenus')).toHaveText('—') // salaire pas encore reçu : pas d'écart affiché
  await page.getByRole('button', { name: 'Mois suivant' }).click()
  await expect(page.getByRole('heading', { name: 'Janvier 2027', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Week-end Annecy', exact: true })).toHaveCount(0) // une seule fois
  await nav(page, 'analyses')
  await expect(page.getByText(/nov\. 26/).first()).toBeVisible()
})

test('ajouter une ligne : catégories proposées, type remis à « Dépense » après chaque ajout', async ({ page }) => {
  await setup(page, { balance: '500', salary: '1500', payDay: 'le 1er' })
  await nav(page, 'budget')
  await page.getByRole('button', { name: 'Ajouter une ligne' }).click()
  const form = page.getByRole('form', { name: 'Nouvelle ligne de budget' })
  const cat = form.getByLabel('Catégorie', { exact: true })
  await cat.fill('caf')
  await expect(form.getByRole('button', { name: /Revenus › CAF \/ aides/ })).toBeVisible()
  await form.getByRole('button', { name: /Revenus › CAF \/ aides/ }).click()
  await expect(form.getByLabel('Type')).toHaveText('Revenu') // la catégorie choisie fixe le type
  await form.getByLabel('Montant (€)').fill('100')
  await form.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(form.getByLabel('Type')).toHaveText('Dépense') // remis à zéro
  await cat.fill('Netflix')
  await form.getByLabel('Montant (€)').fill('13')
  await form.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(page.locator('tbody').filter({ hasText: 'Dépenses variables' }).getByRole('button', { name: 'Netflix' })).toBeVisible()
  await expect(page.locator('tbody').filter({ hasText: 'Revenus' }).getByRole('button', { name: 'CAF / aides' })).toBeVisible()
})

test('une seule prévision : Aperçu, Budget et Jour par jour donnent le même chiffre', async ({ page }) => {
  await setup(page, { balance: '640', salary: '1450', payDay: 'le 28' })
  await nav(page, 'operations')
  for (const [d, a] of [['2026-10-30', '20'], ['2026-11-01', '25'], ['2026-11-02', '15']] as const) await quickAdd(page, a, `Boulangerie ${d}`, d)
  await nav(page, 'accueil')
  const sentence = page.getByTestId('forecast-end')
  await expect(sentence).toBeVisible()
  const amount = (await sentence.textContent())!.match(/≈ (-?[\d\s\u202f]+,\d\d\s€)/)![1]!
  await expect(page.getByTestId('forecast-case').first()).toContainText(amount)
  await nav(page, 'budget')
  await expect(page.getByTestId('budget-reste')).toContainText(amount)
  await nav(page, 'simulations')
  await page.getByRole('tab', { name: 'Jour par jour' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: /^27 nov\..*veille de paie/ })).toContainText(amount)
})

test('Journal : changer la catégorie d’une opération la garde et apprend la règle', async ({ page }) => {
  await setup(page, { balance: '1000', salary: '2380', payDay: 'le dernier jour du mois' })
  await nav(page, 'operations')
  await quickAdd(page, '60', 'TOTALENERGIES')
  await page.getByRole('button', { name: 'TOTALENERGIES', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Catégorie').click()
  await page.getByRole('option', { name: 'Carburant' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText(/Règle apprise/)).toBeVisible()
  await page.getByRole('button', { name: 'TOTALENERGIES', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Catégorie')).toHaveText('Carburant')
})
