import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/app/lib/utils'
import { Sparkline } from '@/app/components/charts/Sparkline'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'

/**
 * One headline number: label, value, change against the previous period and an optional trend.
 * `better` says which way is good, so a falling first-reply time shows green.
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
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  /** Fractional change against the previous period (0.12 = +12%); null hides it. */
  change?: number | null
  better?: 'up' | 'down' | 'none'
  trend?: number[]
  help?: string
  className?: string
}) {
  const shown = change != null && Number.isFinite(change)
  const up = shown && change > 0
  const good = !shown || change === 0 || better === 'none' ? null : up === (better === 'up')
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4', className)}>
      <span className="flex items-center gap-1 text-meta text-muted-foreground">
        {label}
        {help && <InfoTooltip text={help} />}
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
            {Math.abs(Math.round(change * 100))}%
          </span>
        )}
      </span>
      {sub && <span className="text-meta text-muted-foreground">{sub}</span>}
      {trend && trend.length > 1 && <Sparkline values={trend} className={good === false ? 'stroke-destructive' : 'stroke-primary'} />}
    </div>
  )
}
