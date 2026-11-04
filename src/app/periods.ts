import { useMemo } from 'react'
import { toast } from 'sonner'
import { today } from '@/core/dates'
import { periodTitle } from '@/core/period'
import { periodDay, tickOccurrence } from '@/db/budgetRepo'
import { mutate, useDb } from './store'
import { attempt } from './ui'

export const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
/** « Novembre 2026 » pour un mois calendaire 'YYYY-MM'. */
export const monthLong = (m: string) => cap(new Date(`${m}-15T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }))

/** Nom affiché d'une période (clé interne 'YYYY-MM') : « Novembre 2026 » ou « nov. 26 », selon le jour de paie. */
export function usePeriodTitle() {
  const { db, version } = useDb()
  return useMemo(() => {
    const day = periodDay(db)
    return (key: string, style: 'long' | 'short' = 'long') => (style === 'long' ? cap(periodTitle(key, day)) : periodTitle(key, day, 'short'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version])
}

/** Coche une échéance « payé / reçu » ; si le Journal l'a déjà, rien n'est créé (pas de double compte). */
export function tickDue(id: string, name: string, date: string, verb: string) {
  const r = attempt(() => mutate((d) => tickOccurrence(d, id, date, today()), { label: `${name} ${verb}` }))
  if (r === 'deja') toast.info('Déjà enregistré dans ton Journal')
  else if (r) toast.success(`${name} : ${verb}`)
}
