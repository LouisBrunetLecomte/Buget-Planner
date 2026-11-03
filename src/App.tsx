import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { ChevronDown, Eye, EyeOff, Lock, Undo2 } from 'lucide-react'
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
  accueil: ['Accueil', HomePage, 'main'],
  budget: ['Budget', BudgetPage, 'main'],
  operations: ['Opérations', TransactionsPage, 'main'],
  recurrences: ['Salaire et charges fixes', named(() => import('@/features/recurring/RecurringPage'), 'RecurringPage'), 'more'],
  comptes: ['Comptes', named(() => import('@/features/accounts/AccountsPage'), 'AccountsPage'), 'more'],
  analyses: ['Analyses', named(() => import('@/features/analyses/AnalysesPage'), 'AnalysesPage'), 'more'],
  patrimoine: ['Épargne et crédits', named(() => import('@/features/patrimoine/PatrimoinePage'), 'PatrimoinePage'), 'more'],
  simulations: ['Simulations', named(() => import('@/features/simulations/SimulationsPage'), 'SimulationsPage'), 'more'],
  import: ['Importer un relevé', named(() => import('@/features/import/ImportPage'), 'ImportPage'), 'more'],
  categories: ['Catégories et règles', named(() => import('@/features/categories/CategoriesPage'), 'CategoriesPage'), 'more'],
  rapports: ['Rapports et exports', named(() => import('@/features/reports/ReportsPage'), 'ReportsPage'), 'more'],
  assistant: ['Assistant', named(() => import('@/features/assistant/AssistantPage'), 'AssistantPage'), 'more'],
  reglages: ['Réglages', named(() => import('@/features/settings/SettingsPage'), 'SettingsPage'), 'more'],
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
  const link = (k: string, label: string) => (
    <a key={k} href={`#/${k}`} aria-current={route === k ? 'page' : undefined}
      className={cn('rounded-md px-2.5 py-1.5 text-sm hover:bg-muted', route === k && 'bg-muted font-medium')}>{label}</a>
  )
  return (
    <div className="min-h-dvh pb-16 lg:pb-0">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2">
          <a href="#/accueil" className="font-semibold">Buget</a>
          <nav aria-label="Navigation principale" className="hidden items-center gap-0.5 lg:flex">
            {entries.filter(([, [, , g]]) => g === 'main').map(([k, [label]]) => link(k, label))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className={cn(PAGES[route]?.[2] === 'more' && 'bg-muted font-medium')}>Plus <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {entries.filter(([, [, , g]]) => g === 'more').map(([k, [label]]) => <DropdownMenuItem key={k} asChild><a href={`#/${k}`}>{label}</a></DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {s.status === 'open' && s.saveError && <span role="alert" className="text-xs text-destructive">Échec de sauvegarde : {s.saveError}</span>}
            <Button variant="ghost" size="icon" aria-label={last ? `Annuler : ${last.label}` : 'Rien à annuler'} title={last ? `Annuler : ${last.label} (⌘Z)` : undefined} disabled={!last} onClick={doUndo}><Undo2 /></Button>
            <Button variant="ghost" size="icon" aria-label={hidden ? 'Afficher les montants' : 'Masquer les montants'} aria-pressed={hidden} onClick={togglePrivacy}>{hidden ? <EyeOff /> : <Eye />}</Button>
            <Button variant="ghost" size="icon" aria-label="Verrouiller" onClick={lock}><Lock /></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Chargement…</p>}><Page key={String(hidden)} /></Suspense>
        <Tutorial />
      </main>
      <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-background lg:hidden">
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
