import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS_TICK, colorAt, compact, shortDate, type Series } from './chartTheme'
import { ChartLegend, ChartTooltip } from './ChartTooltip'

/**
 * Lines, bars, areas or a mix over a shared x axis (usually days). Stacks by `stack` id,
 * puts `right` series on a second axis, and can draw a target line (e.g. an SLA goal).
 */
export function TimeSeriesChart<T extends Record<string, unknown>>({
  data,
  x = 'date',
  series,
  height = 220,
  target,
  xFormat = shortDate,
  yFormat = compact,
  rightFormat,
  label,
}: {
  data: T[]
  x?: string
  series: Series[]
  height?: number
  target?: { value: number; label: string; right?: boolean }
  xFormat?: (v: string) => string
  yFormat?: (v: number) => string
  rightFormat?: (v: number) => string
  /** Read out to screen readers in place of the drawing. */
  label: string
}) {
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? colorAt(i) }))
  const hasRight = colored.some((s) => s.right)
  return (
    <figure className="space-y-2">
      <div role="img" aria-label={label} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 0 : 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey={x} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => xFormat(String(v))} minTickGap={16} />
            <YAxis yAxisId="l" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={yFormat} width={48} allowDecimals={false} />
            {hasRight && <YAxis yAxisId="r" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={rightFormat ?? yFormat} width={44} />}
            <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<ChartTooltip series={colored} labelFormat={xFormat} />} />
            {target && <ReferenceLine yAxisId={target.right ? 'r' : 'l'} y={target.value} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: target.label, position: 'insideTopRight', ...AXIS_TICK }} />}
            {colored.map((s) => {
              const axis = s.right ? 'r' : 'l'
              if (s.kind === 'line')
                return <Line key={s.key} yAxisId={axis} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
              if (s.kind === 'area')
                return <Area key={s.key} yAxisId={axis} type="monotone" dataKey={s.key} stackId={s.stack} stroke={s.color} fill={s.color} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
              return <Bar key={s.key} yAxisId={axis} dataKey={s.key} stackId={s.stack} fill={s.color} radius={s.stack ? 0 : [3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        <ChartLegend series={colored} />
      </figcaption>
    </figure>
  )
}
