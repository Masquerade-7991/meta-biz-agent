import { compact } from './chartTheme'

export interface BarRow {
  label: string
  value: number
  hint?: string
}

/** Ranked horizontal bars (top questions, tools, teams). Divs, so long labels wrap instead of clipping.
 *  `sorted={false}` keeps the rows' own order (levels, steps). */
export function BarList({ rows, format = compact, empty = 'Nothing to show for this period.', max: limit = 8, sorted = true }: { rows: BarRow[]; format?: (v: number) => string; empty?: string; max?: number; sorted?: boolean }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  const top = (sorted ? [...rows].sort((a, b) => b.value - a.value) : rows).slice(0, limit)
  const max = Math.max(1, ...top.map((r) => r.value))
  return (
    <ul className="space-y-2">
      {top.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate" title={r.label}>
              {r.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {format(r.value)}
              {r.hint && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.hint}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
