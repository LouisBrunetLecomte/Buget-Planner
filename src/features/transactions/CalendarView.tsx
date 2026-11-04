import { useMemo, useState } from 'react'
import { addDays, daysInMonth, monthOf, today } from '@/core/dates'
import { formatMoney } from '@/core/money'
import * as repo from '@/db/repo'
import { balanceHistory } from '@/db/analyticsRepo'
import { financialCalendar } from '@/db/planningRepo'
import { useDb } from '@/app/store'
import { MonthPicker } from '@/app/ui'
import { cn } from '@/lib/utils'

const DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const dayLong = (d: string) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** Calendrier du mois : entrées et sorties de chaque jour, et solde des comptes courants en fin de journée (prévu après aujourd'hui). */
export function CalendarView({ onEdit }: { onEdit: (t: repo.Tx) => void }) {
  const { db, version } = useDb()
  const now = today()
  const [month, setMonth] = useState(monthOf(now)), [picked, setPicked] = useState<string | null>(null)
  const data = useMemo(() => {
    const from = `${month}-01`, to = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
    const txs = repo.listTransactions(db, { from, to, limit: 10_000 })
    const flows = new Map<string, { in: number; out: number; txs: repo.Tx[] }>()
    for (const t of txs) {
      const f = flows.get(t.date) ?? { in: 0, out: 0, txs: [] }
      f.txs.push(t)
      if (!t.transferGroupId) { if (t.amountEur > 0) f.in += t.amountEur; else f.out -= t.amountEur }
      flows.set(t.date, f)
    }
    const bal = new Map<string, number>()
    if (from <= now) for (const p of balanceHistory(db, from, to < now ? to : now, true)) bal.set(p.date, p.balance)
    const future = new Map<string, { label: string; amount: number }[]>()
    if (to > now) {
      const days = Math.round((Date.parse(to) - Date.parse(now)) / 86_400_000) + 1
      for (const d of financialCalendar(db, now, days).days) {
        if (d.date > now) bal.set(d.date, d.balance)
        if (d.date > now && d.date >= from) future.set(d.date, d.events)
      }
    }
    return { from, to, flows, bal, future }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, month, now])

  const lead = (new Date(`${data.from}T00:00:00Z`).getUTCDay() + 6) % 7
  const cells: (string | null)[] = [...Array(lead).fill(null)]
  for (let d = data.from; d <= data.to; d = addDays(d, 1)) cells.push(d)
  const sel = picked && picked >= data.from && picked <= data.to ? picked : null
  const selFlow = sel ? data.flows.get(sel) : undefined

  return (
    <section aria-label="Calendrier des opérations">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="w-60"><MonthPicker label="Mois" value={month} onChange={(m) => { setMonth(m || monthOf(now)); setPicked(null) }} /></div>
        <p className="text-xs text-muted-foreground">Solde des comptes courants en fin de journée{month >= monthOf(now) ? ', prévu (en italique) après aujourd’hui' : ''}.</p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {DAYS.map((d) => <div key={d} className="pb-1 text-center text-muted-foreground">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`x${i}`} />
          const f = data.flows.get(d), b = data.bal.get(d), fut = d > now, ev = data.future.get(d) ?? []
          return (
            <button key={d} type="button" aria-pressed={sel === d} onClick={() => setPicked(sel === d ? null : d)}
              aria-label={`${dayLong(d)}${f ? `, sorties ${formatMoney(f.out)}, entrées ${formatMoney(f.in)}` : ''}${b !== undefined ? `, solde ${formatMoney(b)}` : ''}`}
              className={cn('flex min-h-20 flex-col items-stretch rounded-md border p-1 text-left tabular-nums hover:bg-secondary/60',
                d === now && 'border-primary', sel === d && 'bg-secondary', fut && 'bg-muted/30')}>
              <span className={cn('font-medium', d === now && 'text-primary')}>{Number(d.slice(8))}</span>
              {f && f.out > 0 && <span className="truncate">−{formatMoney(f.out)}</span>}
              {f && f.in > 0 && <span className="truncate text-emerald-700 dark:text-emerald-400">+{formatMoney(f.in)}</span>}
              {ev.length > 0 && <span className="truncate text-muted-foreground" title={ev.map((e) => e.label).join(', ')}>{ev.length} prévu{ev.length > 1 ? 's' : ''}</span>}
              {b !== undefined && <span className={cn('mt-auto truncate text-right text-muted-foreground', fut && 'italic', b < 0 && 'text-destructive')}>{formatMoney(b)}</span>}
            </button>
          )
        })}
      </div>
      {sel && (
        <div className="mt-3 rounded-lg border p-3 text-sm">
          <div className="mb-2 font-medium first-letter:uppercase">{dayLong(sel)}</div>
          {!selFlow && !(data.future.get(sel)?.length) && <p className="text-muted-foreground">Rien ce jour-là.</p>}
          <ul className="grid gap-1">
            {selFlow?.txs.map((t) => (
              <li key={t.id}><button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => onEdit(t)}>
                <span className="truncate">{t.label}</span><span className={cn('tabular-nums', t.amount > 0 && 'text-emerald-700 dark:text-emerald-400')}>{formatMoney(t.amount, t.currency)}</span>
              </button></li>
            ))}
            {data.future.get(sel)?.map((e, k) => (
              <li key={`e${k}`} className="flex justify-between gap-2 text-muted-foreground"><span className="truncate">{e.label} (prévu)</span><span className="tabular-nums">{formatMoney(e.amount)}</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
