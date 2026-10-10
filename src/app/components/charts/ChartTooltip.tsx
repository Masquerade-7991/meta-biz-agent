import type { Series } from './chartTheme'
import { compact } from './chartTheme'

interface Item {
  dataKey?: string | number
  value?: number | string
  color?: string
}

/** Tooltip body drawn with the console's tokens instead of Recharts' default box. */
export function ChartTooltip({ active, payload, label, series, labelFormat }: { active?: boolean; payload?: Item[]; label?: string | number; series: Series[]; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-36 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label != null && <p className="mb-1 font-medium">{labelFormat ? labelFormat(String(label)) : label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => {
          const s = series.find((x) => x.key === p.dataKey)
          const v = typeof p.value === 'number' ? (s?.format ?? compact)(p.value) : String(p.value ?? '—')
          return (
            <li key={String(p.dataKey)} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-sm" style={{ background: p.color }} />
              <span className="text-muted-foreground">{s?.label ?? p.dataKey}</span>
              <span className="ml-auto font-medium tabular-nums">{v}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Legend as plain chips, so it reads the same under every chart. */
export function ChartLegend({ series }: { series: { label: string; color?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}
