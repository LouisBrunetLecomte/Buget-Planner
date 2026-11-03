import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const PW = 'mot-de-passe-e2e'

async function createVault(page: Page, demo = true) {
  await page.goto('/')
  await page.getByLabel('Mot de passe', { exact: true }).fill(PW)
  await page.getByLabel('Confirmation').fill(PW)
  if (!demo) await page.getByRole('checkbox', { name: /démonstration/ }).click()
  await page.getByRole('button', { name: 'Créer ma base' }).click()
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible({ timeout: 20_000 })
}
const nav = (page: Page, route: string) => page.goto(`/#/${route}`)

test('création, verrouillage, mauvais mot de passe, persistance', async ({ page }) => {
  await createVault(page)
  await expect(page.getByText('Solde total')).toBeVisible()
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
  await expect(page.getByRole('row', { name: /Boulangerie e2e/ })).toContainText('-4,20')
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
