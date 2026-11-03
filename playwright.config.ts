import { defineConfig, devices } from '@playwright/test'

// Tests de bout en bout sur la version de production (CSP et service worker compris)
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  use: { baseURL: 'http://localhost:4173', locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 120_000 },
})
