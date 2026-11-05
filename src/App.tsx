import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { ChevronDown, Eye, EyeOff, Lock, Settings, Undo2 } from 'lucide-react'
import '@/app/theme'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { boot, getHistory, lock, undo, useStore } from '@/app/store'
import { togglePrivacy, usePrivacy } from '@/app/privacy'
import { toast } from 'sonner'
import { LockScreen } from '@/app/LockScreen'
import { useRoute } from '@/app/ui'
import { useAlertNotifications } from '@/app/notify'
import { Tutorial } from '@/app/Tutorial'
import { TransactionsPage } from '@/features/transactions/TransactionsPage'
import { HomePage } from '@/features/home/HomePage'
import { BudgetPage } from '@/features/budget/BudgetPage'

// pages chargées à la demande : graphiques, PDF, OCR ne pèsent pas sur le démarrage
const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })))
const PAGES: Record<string, [string, ComponentType, 'main' | 'more']> = {
  accueil: ['Aperçu', HomePage, 'main'],
  budget: ['Budget', BudgetPage, 'main'],
  bilan: ['Bilan', named(() => import('@/features/bilan/BilanPage'), 'BilanPage'), 'main'],
  operations: ['Journal', TransactionsPage, 'main'],
  comptes: ['Comptes', named(() => import('@/features/accounts/AccountsPage'), 'AccountsPage'), 'main'],
  recurrences: ['Salaire, charges et abonnements', named(() => import('@/features/recurring/RecurringPage'), 'RecurringPage'), 'more'],
  analyses: ['Analyses', named(() => import('@/features/analyses/AnalysesPage'), 'AnalysesPage'), 'more'],
  patrimoine: ['Épargne et crédits', named(() => import('@/features/patrimoine/PatrimoinePage'), 'PatrimoinePage'), 'more'],
  simulations: ['Simulations', named(() => import('@/features/simulations/SimulationsPage'), 'SimulationsPage'), 'more'],
  import: ['Importer un relevé', named(() => import('@/features/import/ImportPage'), 'ImportPage'), 'more'],
  categories: ['Catégories et règles', named(() => import('@/features/categories/CategoriesPage'), 'CategoriesPage'), 'more'],
  rapports: ['Rapports et exports', named(() => import('@/features/reports/ReportsPage'), 'ReportsPage'), 'more'],
  assistant: ['Assistant', named(() => import('@/features/assistant/AssistantPage'), 'AssistantPage'), 'more'],
  reglages: ['Paramètres', named(() => import('@/features/settings/SettingsPage'), 'SettingsPage'), 'more'],
}

const AUTO_LOCK_MS = 15 * 60_000

function useAutoLock() {
  useEffect(() => {
    let t = setTimeout(lock, AUTO_LOCK_MS)
    const reset = () => { clearTimeout(t); t = setTimeout(lock, AUTO_LOCK_MS) }
    const evs = ['pointerdown', 'keydown', 'scroll'] as const
    evs.forEach((e) => addEventListener(e, reset, { passive: true }))
    return () => { clearTimeout(t); evs.forEach((e) => removeEventListener(e, reset)) }
  }, [])
}

function Shell() {
  const route = useRoute()
  const s = useStore()
  useAutoLock()
  useAlertNotifications()
  const hidden = usePrivacy()
  const last = getHistory().at(-1)
  const doUndo = () => { if (last) void undo().then(() => toast.success(`Annulé : ${last.label}`)) }
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) { e.preventDefault(); doUndo() }
    }
    addEventListener('keydown', f); return () => removeEventListener('keydown', f)
  })
  const [, Page] = PAGES[route] ?? PAGES.accueil!
  const entries = Object.entries(PAGES)
  return (
    <div className="min-h-dvh pb-16 lg:pb-0">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/72 backdrop-blur-xl backdrop-saturate-180">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-6 px-5">
          <a href="#/accueil" className="text-[15px] font-semibold tracking-tight">Budget</a>
          <nav aria-label="Navigation principale" className="hidden flex-1 items-center justify-center gap-7 text-[13px] lg:flex">
            {entries.filter(([, [, , g]]) => g === 'main').map(([k, [label]]) => (
              <a key={k} href={`#/${k}`} aria-current={route === k ? 'page' : undefined} className={cn('transition-colors hover:text-foreground', route === k ? 'text-foreground' : 'text-muted-foreground')}>{label}</a>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn('flex items-center gap-0.5 transition-colors hover:text-foreground', PAGES[route]?.[2] === 'more' ? 'text-foreground' : 'text-muted-foreground')}>Plus <ChevronDown className="size-3.5" /></DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                {entries.filter(([, [, , g]]) => g === 'more').map(([k, [label]]) => <DropdownMenuItem key={k} asChild><a href={`#/${k}`}>{label}</a></DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
          <div className="ml-auto flex items-center gap-0.5 lg:ml-0">
            {s.status === 'open' && s.saveError && <span role="alert" className="text-xs text-destructive">Échec de sauvegarde : {s.saveError}</span>}
            <Button variant="ghost" size="icon-sm" aria-label={last ? `Annuler : ${last.label}` : 'Rien à annuler'} title={last ? `Annuler : ${last.label} (⌘Z)` : undefined} disabled={!last} onClick={doUndo}><Undo2 /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={hidden ? 'Afficher les montants' : 'Masquer les montants'} aria-pressed={hidden} onClick={togglePrivacy}>{hidden ? <EyeOff /> : <Eye />}</Button>
            <Button variant="ghost" size="icon-sm" aria-label="Paramètres" title="Paramètres" aria-current={route === 'reglages' ? 'page' : undefined} onClick={() => { location.hash = '#/reglages' }}><Settings /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Verrouiller" onClick={lock}><Lock /></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}><Page key={String(hidden)} /></Suspense>
        <Tutorial />
      </main>
      <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-border/60 bg-background/80 backdrop-blur-xl lg:hidden">
        {entries.filter(([, [, , g]]) => g === 'main').map(([k, [label]]) => (
          <a key={k} href={`#/${k}`} aria-current={route === k ? 'page' : undefined} className={cn('py-3 text-center text-xs', route === k ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{label}</a>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger className={cn('py-3 text-center text-xs', PAGES[route]?.[2] === 'more' ? 'font-semibold text-foreground' : 'text-muted-foreground')}>Plus</DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {entries.filter(([, [, , g]]) => g === 'more').map(([k, [label]]) => <DropdownMenuItem key={k} asChild><a href={`#/${k}`}>{label}</a></DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </div>
  )
}

export default function App() {
  const s = useStore()
  useEffect(() => { void boot() }, [])
  if (s.status === 'loading') return <div className="grid min-h-dvh place-items-center text-muted-foreground">Chargement…</div>
  if (s.status === 'error') return (
    <div role="alert" className="grid min-h-dvh place-items-center p-4 text-center">
      <div><p className="mb-2 font-medium">Impossible de lire le stockage du navigateur.</p><p className="mb-4 text-sm text-muted-foreground">{s.message}</p>
        <Button onClick={() => location.reload()}>Recharger</Button></div>
    </div>
  )
  if (s.status !== 'open') return <LockScreen mode={s.status} />
  return <Shell />
}
