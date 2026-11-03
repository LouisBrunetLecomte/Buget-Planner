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
  await expect(demo ? page.getByRole('heading', { name: 'Accueil' }) : page.getByRole('dialog').getByText('Bienvenue dans Buget')).toBeVisible({ timeout: 20_000 })
}
const nav = (page: Page, route: string) => page.evaluate((r) => { location.hash = `/${r}` }, route) // sans rechargement (sinon l'app se reverrouille)

test('création, verrouillage, mauvais mot de passe, persistance', async ({ page }) => {
  await createVault(page)
  await expect(page.getByText('Après tes charges et ton budget')).toBeVisible()
  await page.getByRole('button', { name: 'Verrouiller' }).click()
  await page.getByLabel('Mot de passe').fill('pas-le-bon')
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('alert')).toHaveText('Mot de passe incorrect.')
  await page.reload()
  await page.getByLabel('Mot de passe').fill(PW)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible({ timeout: 20_000 })
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
  for (const route of ['accueil', 'operations', 'budget', 'recurrences', 'analyses', 'patrimoine', 'simulations', 'import', 'reglages']) {
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
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Nom').fill('Mon compte LCL')
  await dlg.getByLabel('Solde actuel (€)').fill('1 250')
  await dlg.getByRole('button', { name: 'Ajouter ce compte' }).click()
  await expect(dlg.getByText('✓ Mon compte LCL')).toBeVisible()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByRole('button', { name: 'Suivant' }).click()
  await dlg.getByLabel('Ton salaire net (€)').fill('2100')
  await dlg.getByRole('button', { name: 'Enregistrer' }).first().click()
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
    await form.getByLabel('Nouveau libellé').fill(l!)
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
  await dlg.getByLabel('Il arrive').click()
  await page.getByRole('option', { name: 'le 12', exact: true }).click()
  await dlg.getByRole('button', { name: 'Enregistrer' }).first().click()
  await dlg.getByRole('button', { name: 'Passer le tutoriel' }).click()
  await nav(page, 'budget')
  await expect(page.getByText(/12 \S+ → 11 \S+ \d{4}/).first()).toBeVisible()
  await nav(page, 'accueil')
  await expect(page.getByText(/jusqu’au \S+ 12 /)).toBeVisible()
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
