import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from '@/components/ui/sonner'
import './app/theme'
import './index.css'
import App from './App.tsx'
import { setupPwa } from './app/pwa'

// dans l'app Mac (fenêtre native), pas de service worker : l'app est déjà locale et toujours à jour
if (import.meta.env.PROD && !navigator.userAgent.includes('BugetMac')) setupPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster richColors position="top-center" />
  </StrictMode>,
)
