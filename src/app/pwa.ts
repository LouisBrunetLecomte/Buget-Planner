import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'
import { flush } from './store'

/** Nouvelle version : on propose, on sauvegarde, puis on recharge. */
export function setupPwa() {
  const update = registerSW({
    onNeedRefresh() {
      toast('Nouvelle version disponible', { duration: Infinity, action: { label: 'Mettre à jour', onClick: () => void flush().then(() => update(true)) } })
    },
  })
}
