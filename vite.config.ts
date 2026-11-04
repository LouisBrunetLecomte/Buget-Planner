import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import type { Plugin } from 'vite'

// Politique de sécurité du contenu (build seulement : le serveur de dev a besoin de scripts en ligne).
// Réseau autorisé : l'app elle-même, les taux BCE, et Ollama en local / réseau local (port 11434).
const CSP = [
  "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self' https://api.frankfurter.dev http://localhost:11434 http://127.0.0.1:11434 http://*:11434",
  "object-src 'none'", "base-uri 'self'", "form-action 'none'",
].join('; ')
// Version Odoo (npm run build:odoo) : un seul fichier HTML, tout en ligne, chargé dans un cadre sur le site Odoo.
const CSP_ODOO = CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline' blob: data:").replace("worker-src 'self' blob:", "worker-src 'self' blob: data:").replace("connect-src 'self'", "connect-src 'self' data: blob:")
const csp = (odoo: boolean): Plugin => ({ name: 'csp', apply: 'build', transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${odoo ? CSP_ODOO : CSP}" />\n    <meta name="referrer" content="no-referrer" />`) })

export default defineConfig(({ mode }) => ({
  base: './', // fonctionne aussi sous un sous-dossier (GitHub Pages)
  ...(mode === 'odoo' ? { build: { outDir: 'dist-odoo', assetsInlineLimit: () => true, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } } } : {}),
  plugins: [
    react(),
    tailwindcss(),
    csp(mode === 'odoo'),
    VitePWA({
      disable: mode === 'odoo', // pas de service worker dans un cadre Odoo
      registerType: 'prompt', // jamais de rechargement surprise : l'utilisateur choisit quand mettre à jour
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Budget', short_name: 'Budget', lang: 'fr', description: 'Budget personnel local et chiffré',
        start_url: '.', scope: '.', display: 'standalone', theme_color: '#1c1c1c', background_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,woff2,svg,png}'],
        globIgnores: ['ocr/**'], // OCR (~12 Mo) : mis en cache au premier usage seulement
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [{ urlPattern: /\/ocr\//, handler: 'CacheFirst', options: { cacheName: 'ocr' } }],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}))
