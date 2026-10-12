import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import type * as React from 'react'
import { Link } from 'react-router'
import { cn } from '@/app/lib/utils'
import { Sparkline } from '@/app/components/charts/Sparkline'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'

/**
 * One headline number: label, value, change against the previous period and an optional trend.
 * `better` says which way is good, so a falling first-reply time shows green. Rates change in
 * points (`unit="pts"`: 62% → 65% is +3 pts, not +5%). `to` makes the tile open what's behind it.
 */
export function KpiTile({
  label,
  value,
  sub,
  change,
  better = 'up',
  trend,
  help,
  className,
  unit = '%',
  to,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  /** Fractional change against the previous period (0.12 = +12%); null hides it. */
  change?: number | null
  better?: 'up' | 'down' | 'none'
  trend?: (number | null)[]
  help?: string
  className?: string
  unit?: '%' | 'pts'
  /** Where clicking the tile goes (e.g. the matching ticket list). */
  to?: string
}) {
  const shown = change != null && Number.isFinite(change)
  const up = shown && change > 0
  const good = !shown || change === 0 || better === 'none' ? null : up === (better === 'up')
  const body = (
    <>
      <span className="flex items-center gap-1 text-meta text-muted-foreground">
        {label}
        {help && <InfoTooltip text={help} />}
        {to && <ChevronRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-title font-semibold tabular-nums">{value}</span>
        {shown && (
          <span
            className={cn(
              'inline-flex items-center text-meta font-medium tabular-nums',
              good === null ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive',
            )}
            title="Against the previous period of the same length"
          >
            {change > 0 ? <ArrowUpRight className="size-3.5" /> : change < 0 ? <ArrowDownRight className="size-3.5" /> : null}
            {Math.abs(Math.round(change * 100))}
            {unit === '%' ? '%' : Math.abs(Math.round(change * 100)) === 1 ? ' pt' : ' pts'}
          </span>
        )}
      </span>
      {sub && <span className="text-meta text-muted-foreground">{sub}</span>}
      {trend && trend.length > 1 && <Sparkline values={trend} className={good === false ? 'stroke-destructive' : 'stroke-primary'} />}
    </>
  )
  const box = 'flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4'
  return to ? (
    <Link to={to} className={cn(box, 'group transition-colors hover:border-border-strong', className)}>
      {body}
    </Link>
  ) : (
    <div className={cn(box, className)}>{body}</div>
  )
}
