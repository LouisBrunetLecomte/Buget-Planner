import type { ReactNode } from 'react'
import { formatMoney, privacy } from '@/core/money'

/** Axe : nombres ronds, compacts au-delà de 10 000. Les données des graphiques sont en euros. */
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })
export const axisEuro = (v: number) => (privacy.hidden ? '•••' : Math.abs(v) >= 10_000 ? compact.format(v) : String(Math.round(v)))
export const axisProps = { stroke: 'var(--viz-axis)', tick: { fill: 'var(--viz-muted)', fontSize: 11 }, tickLine: false } as const
export const gridProps = { stroke: 'var(--viz-grid)', vertical: false } as const

interface TipPayload { name?: string; value?: number; color?: string; dataKey?: string | number }
/** Info-bulle : la valeur en premier (forte), le nom ensuite, une courte ligne de la couleur de la série. */
export function ChartTooltip({ active, payload, label, labelFormat }: { active?: boolean; payload?: TipPayload[]; label?: string | number; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {label !== undefined && <div className="mb-1 text-muted-foreground">{labelFormat ? labelFormat(String(label)) : label}</div>}
      {payload.filter((p) => p.value !== undefined && p.value !== null).map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} aria-hidden />
          <span className="font-semibold tabular-nums">{formatMoney(Math.round((p.value ?? 0) * 100))}</span>
          <span className="text-muted-foreground">{p.name}</span>
        </div>
      ))}
    </div>
  )
}

export function LegendItem({ color, label, line, dashed }: { color: string; label: string; line?: boolean; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {line
        ? <svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} /></svg>
        : <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} aria-hidden />}
      {label}
    </span>
  )
}

/** Vue tableau : toute valeur d'un graphique reste lisible sans survol ni couleur. */
export function TableView({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">Voir les données en tableau</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full tabular-nums">
          <thead className="text-left text-muted-foreground"><tr>{head.map((h, i) => <th key={h} className={i ? 'p-1 text-right' : 'p-1'}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className={j ? 'p-1 text-right' : 'p-1'}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  )
}

export const monthShort = (m: string) => new Date(`${m}-15`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
