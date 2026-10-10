import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { colorAt, compact, type Series } from './chartTheme'
import { ChartTooltip } from './ChartTooltip'

export interface Slice {
  label: string
  value: number
  color?: string
}

/** Share of a whole, with the total in the middle and a legend that carries the numbers. */
export function Donut({ slices, total, totalLabel = 'Total', format = compact, label, size = 168 }: { slices: Slice[]; total?: string; totalLabel?: string; format?: (v: number) => string; label: string; size?: number }) {
  const sum = slices.reduce((a, s) => a + s.value, 0)
  const colored = slices.map((s, i) => ({ ...s, key: s.label, color: s.color ?? colorAt(i) }))
  const series: Series[] = colored.map((s) => ({ key: s.key, label: s.label, color: s.color, format }))
  return (
    <figure className="flex flex-wrap items-center gap-6">
      <div role="img" aria-label={label} className="relative shrink-0" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip series={series} />} />
            <Pie data={colored} dataKey="value" nameKey="key" innerRadius="64%" outerRadius="100%" paddingAngle={sum ? 1.5 : 0} stroke="none" isAnimationActive={false}>
              {colored.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-section font-semibold tabular-nums">{total ?? format(sum)}</span>
          <span className="text-meta text-muted-foreground">{totalLabel}</span>
        </div>
      </div>
      <figcaption className="min-w-40 flex-1">
        <ul className="space-y-1.5 text-sm">
          {colored.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto font-medium tabular-nums">{format(s.value)}</span>
              <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{sum ? Math.round((s.value / sum) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
