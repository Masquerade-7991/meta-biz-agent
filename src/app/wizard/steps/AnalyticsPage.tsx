import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import {
  getConnectorHealth,
  getConversationTrend,
  getEventBreakdown,
  getHandoffTrend,
  getKpis,
  getToolBreakdown,
  type AnalyticsRange,
  type HandoffPoint,
  type TrendPoint,
} from '@/app/api/analytics'
import { Button } from '@/app/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { useWizard } from '@/app/wizard/WizardContext'
import { cn } from '@/app/lib/utils'

// ---------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------

const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const compact = (n: number) => (n < 1000 ? String(Math.round(n)) : compactFmt.format(n))
const pct = (r: number) => `${Math.round(r * 100)}%`
const ms = (v: number) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`)

/** 'YYYY-MM-DD' as a local calendar day (not UTC midnight), e.g. "Sep 28". */
function dayLabel(date: string, withWeekday = false) {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {}),
  })
}

const TNUM = { fontVariantNumeric: 'tabular-nums' } as const

// ---------------------------------------------------------------------------------
// Per-section loading: each card fetches, fails and retries on its own.
// ---------------------------------------------------------------------------------

type Load<T> = { status: 'loading' } | { status: 'ok'; data: T; at: Date } | { status: 'error'; at: Date }

function useLoad<T>(fn: () => Promise<T>, key: string): [Load<T>, () => void] {
  const [nonce, setNonce] = useState(0)
  const fullKey = `${key}#${nonce}`
  const [state, setState] = useState<{ key: string; load: Load<T> } | null>(null)
  useEffect(() => {
    let live = true
    fn().then(
      (data) => live && setState({ key: fullKey, load: { status: 'ok', data, at: new Date() } }),
      () => live && setState({ key: fullKey, load: { status: 'error', at: new Date() } }),
    )
    return () => {
      live = false
    }
    // fn is rebuilt every render; fullKey captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])
  const load: Load<T> = state?.key === fullKey ? state.load : { status: 'loading' }
  return [load, () => setNonce((n) => n + 1)]
}

// ---------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------

export function AnalyticsPage() {
  const { state, setSection } = useWizard()
  const [range, setRange] = useState<AnalyticsRange>(7)
  const [tick, setTick] = useState(0)
  const key = `${range}:${tick}`

  const connections = state.connections.connections
  const connKey = `${tick}:${connections.map((c) => `${c.id}=${c.metaId ?? ''}`).join(',')}`

  const [kpis, reloadKpis] = useLoad(() => getKpis(range), key)
  const [trend, reloadTrend] = useLoad(() => getConversationTrend(range), key)
  const [handoffs, reloadHandoffs] = useLoad(() => getHandoffTrend(range), key)
  const [tools, reloadTools] = useLoad(() => getToolBreakdown(range), key)
  const [events, reloadEvents] = useLoad(() => getEventBreakdown(range), key)
  const [health, reloadHealth] = useLoad(
    () => getConnectorHealth(connections.map((c) => ({ id: c.id, name: c.name, metaId: c.metaId }))),
    connKey,
  )

  const k = kpis.status === 'ok' ? kpis.data : null
  const kLoading = kpis.status === 'loading'
  const updatedAt = kpis.status === 'loading' ? null : kpis.at

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={String(range)} onValueChange={(v) => setRange(Number(v) as AnalyticsRange)}>
            <TabsList variant="segmented" aria-label="Date range">
              <TabsTrigger value="7">7 days</TabsTrigger>
              <TabsTrigger value="14">14 days</TabsTrigger>
              <TabsTrigger value="30">30 days</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => setTick((t) => t + 1)} disabled={kLoading}>
            <RefreshCw className={cn('size-3.5', kLoading && 'animate-spin')} /> Refresh
          </Button>
          {updatedAt && (
            <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)', ...TNUM }}>
              Updated {updatedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          Days follow your local time zone, and today&rsquo;s numbers may still be coming in. No message text is shown here.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="AI conversations" loading={kLoading} value={k?.aiThreads} format={compact} />
        <Kpi
          label="Handed to a person"
          note="Right now"
          loading={kLoading}
          value={k?.openHandoffs}
          format={compact}
        />
        <Kpi
          label="Tool success"
          note={k?.toolCalls != null ? `${compact(k.toolCalls)} calls` : undefined}
          loading={kLoading}
          value={k?.toolSuccessRate}
          format={pct}
        />
        <Kpi label="Avg tool latency" loading={kLoading} value={k?.avgToolLatencyMs} format={ms} />
        <Kpi
          label="Events processed"
          note={k?.eventsReceived != null ? `of ${compact(k.eventsReceived)} received` : undefined}
          loading={kLoading}
          value={k?.eventsProcessed}
          format={compact}
        />
      </section>
      {kpis.status === 'error' && <InlineError message="Couldn't load the summary from Meta." onRetry={reloadKpis} />}

      <Section title="Conversations per day" info="Conversations the AI agent handled each day, in your local time.">
        <Loaded load={trend} onRetry={reloadTrend} what="conversations" skeleton="h-48">
          {(points) => (points.length === 0 ? <Empty>No conversations in this period.</Empty> : <TrendChart points={points} />)}
        </Loaded>
      </Section>

      {/* Only the server's database keeps handoff history; without one (null) the section is left out. */}
      {!(handoffs.status === 'ok' && handoffs.data === null) && (
        <Section title="Handoffs over time" info="Conversations waiting on a person, as the server sampled them over time.">
          <Loaded load={handoffs} onRetry={reloadHandoffs} what="handoff history" skeleton="h-40">
            {(points) =>
              !points || points.length < 2 ? (
                <Empty>Handoff history starts once the server has been running for a while.</Empty>
              ) : (
                <HandoffChart points={points} range={range} />
              )
            }
          </Loaded>
        </Section>
      )}

      <Section title="Tools" info="How often each tool ran and how those calls ended.">
        <Loaded load={tools} onRetry={reloadTools} what="tool calls" skeleton="h-32">
          {(rows) => (rows.length === 0 ? <Empty>No tool calls in this period.</Empty> : <ToolTable rows={rows} />)}
        </Loaded>
      </Section>

      <Section title="Business events" info="Events your systems sent to the agent, and how many it processed.">
        <Loaded load={events} onRetry={reloadEvents} what="business events" skeleton="h-32">
          {(data) =>
            data.rows.length === 0 ? <Empty>No business events in this period.</Empty> : <EventTable {...data} />
          }
        </Loaded>
      </Section>

      <Section title="Connector health" info="Calls to your connections over the last 7 days, whatever range is picked above.">
        {connections.length === 0 ? (
          <Empty>
            This agent has no connections set up.{' '}
            <button type="button" onClick={() => setSection('connections')} className="text-primary underline underline-offset-2">
              Set one up
            </button>
          </Empty>
        ) : (
          <Loaded load={health} onRetry={reloadHealth} what="connector health" skeleton="h-40">
            {(rows) =>
              rows.length === 0 ? (
                <Empty>None of your connections are saved to Meta yet, so there&rsquo;s nothing to report.</Empty>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {rows.map((row) => (
                    <ConnectorCard key={row.id} row={row} onViewLogs={() => setSection('activity')} />
                  ))}
                </div>
              )
            }
          </Loaded>
        )}
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------------

function Section({ title, info, children }: { title: string; info: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <span className="flex items-center gap-1.5">
        <h3>{title}</h3>
        <InfoTooltip text={info} />
      </span>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
      {children}
    </p>
  )
}

function Loaded<T>({
  load,
  onRetry,
  what,
  skeleton,
  children,
}: {
  load: Load<T>
  onRetry: () => void
  what: string
  skeleton: string
  children: (data: T) => ReactNode
}) {
  if (load.status === 'loading') return <div className={cn('animate-pulse rounded-lg bg-muted', skeleton)} aria-label={`Loading ${what}`} />
  if (load.status === 'error')
    return (
      <div className="rounded-lg border border-border px-4 py-6">
        <InlineError message={`Couldn't load ${what} from Meta.`} onRetry={onRetry} />
      </div>
    )
  return <>{children(load.data)}</>
}

function Kpi({
  label,
  note,
  loading,
  value,
  format,
}: {
  label: string
  note?: string
  loading: boolean
  value: number | null | undefined
  format: (n: number) => string
}) {
  return (
    <div className="rounded-lg bg-muted p-4">
      <p className="text-muted-foreground" style={{ fontSize: '0.8125rem' }}>
        {label}
      </p>
      {loading ? (
        <div className="my-1.5 h-6 w-14 animate-pulse rounded bg-foreground/10" aria-label="Loading" />
      ) : value == null ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <p tabIndex={0} className="w-fit cursor-help text-muted-foreground" style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-medium)' }}>
              &mdash;
            </p>
          </TooltipTrigger>
          <TooltipContent side="top">Couldn&rsquo;t load from Meta</TooltipContent>
        </Tooltip>
      ) : (
        <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-medium)' }}>{format(value)}</p>
      )}
      {note && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          {note}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------
// Conversations per day: single-series column chart. One hue (primary), so no legend;
// today is hatched because it is still counting; failed days get a small gap marker, not zero.
// ---------------------------------------------------------------------------------

const W = 640
const H = 200
const PAD = { top: 10, right: 8, bottom: 24, left: 36 }

function niceStep(max: number) {
  const raw = Math.max(max, 1) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  return Math.max(1, step)
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const values = points.map((p) => p.aiThreads ?? 0)
  const step = niceStep(Math.max(...values))
  const yMax = step * Math.max(1, Math.ceil(Math.max(...values) / step))
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const band = plotW / points.length
  const barW = Math.min(24, band * 0.7)
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH
  const labelEvery = Math.ceil(points.length / 7)

  const known = points.filter((p) => p.aiThreads != null)
  const total = known.reduce((n, p) => n + (p.aiThreads ?? 0), 0)
  const peak = known.reduce<TrendPoint | null>((best, p) => (best && (best.aiThreads ?? 0) >= (p.aiThreads ?? 0) ? best : p), null)
  const summary =
    `Column chart of AI conversations per day, ${dayLabel(points[0].date)} to ${dayLabel(points[points.length - 1].date)}. ` +
    `${total} in total` +
    (peak ? `, busiest day ${dayLabel(peak.date)} with ${peak.aiThreads}.` : '.') +
    (known.length < points.length ? ` ${points.length - known.length} days couldn't be loaded.` : '')

  const hp = hover != null ? points[hover] : null

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
          <defs>
            <pattern id="analytics-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--primary)" fillOpacity="0.18" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--primary)" strokeWidth="2.5" />
            </pattern>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted-foreground)" style={TNUM}>
                {compact(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const cx = PAD.left + band * i + band / 2
            const base = y(0)
            const active = hover === i
            const showLabel = (points.length - 1 - i) % labelEvery === 0
            let mark: ReactNode
            if (p.aiThreads == null) {
              mark = <line x1={cx - 3} x2={cx + 3} y1={base - 4} y2={base - 4} stroke="var(--muted-foreground)" strokeWidth="2" strokeLinecap="round" />
            } else if (p.aiThreads > 0) {
              const top = y(p.aiThreads)
              const h = base - top
              const r = Math.min(4, h, barW / 2)
              const x0 = cx - barW / 2
              const x1 = cx + barW / 2
              mark = (
                <path
                  d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${base} Z`}
                  fill={p.partial ? 'url(#analytics-hatch)' : 'var(--primary)'}
                  opacity={hover == null || active ? 1 : 0.55}
                />
              )
            }
            return (
              <g key={p.date}>
                {active && <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="var(--muted)" />}
                {mark}
                {showLabel && (
                  <text x={cx} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                    {dayLabel(p.date)}
                  </text>
                )}
                <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH + 4} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            )
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeOpacity="0.5" strokeWidth="1" />
        </svg>

        {hp && hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-popover-foreground shadow-md"
            style={{ left: `${((PAD.left + band * hover + band / 2) / W) * 100}%`, fontSize: 'var(--text-xs)' }}
          >
            <p className="whitespace-nowrap text-muted-foreground">
              {dayLabel(hp.date, true)}
              {hp.partial && ' · so far'}
            </p>
            <p className="whitespace-nowrap" style={{ fontWeight: 'var(--font-weight-medium)', ...TNUM }}>
              {hp.aiThreads == null ? "Couldn't load this day" : `${hp.aiThreads.toLocaleString()} conversation${hp.aiThreads === 1 ? '' : 's'}`}
            </p>
          </div>
        )}
      </div>
      {points.some((p) => p.partial) && (
        <p className="mt-2 flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          <svg width="12" height="12" aria-hidden="true">
            <rect width="12" height="12" rx="2" fill="url(#analytics-hatch)" />
          </svg>
          Striped bar: today, still counting
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------
// Handoffs over time: single-series step line. Each sample is a snapshot of open handoffs that holds
// until the next one, hence steps. Gaps much longer than the usual sampling interval (server down)
// break the line instead of bridging it. Same frame, grid and tooltip as the column chart above.
// ---------------------------------------------------------------------------------

const HH = 160

function HandoffChart({ points, range }: { points: HandoffPoint[]; range: AnalyticsRange }) {
  const [hover, setHover] = useState<number | null>(null)
  const plotW = W - PAD.left - PAD.right
  const plotH = HH - PAD.top - PAD.bottom
  const end = Date.now()
  const start = new Date(new Date().setHours(0, 0, 0, 0)).getTime() - (range - 1) * 86400000
  const x = (t: number) => PAD.left + ((Math.min(Math.max(t, start), end) - start) / (end - start)) * plotW
  const maxV = Math.max(...points.map((p) => p.count))
  const step = niceStep(maxV)
  const yMax = step * Math.max(1, Math.ceil(maxV / step))
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH

  const gaps = points.slice(1).map((p, i) => p.at - points[i].at).sort((a, b) => a - b)
  const breakAfter = 3 * (gaps[Math.floor(gaps.length / 2)] ?? Infinity)
  let d = ''
  points.forEach((p, i) => {
    const prev = points[i - 1]
    if (!prev || p.at - prev.at > breakAfter) d += `M${x(p.at)},${y(p.count)}`
    else d += `H${x(p.at)}V${y(p.count)}`
  })

  const labelEvery = Math.ceil(range / 7)
  const days = Array.from({ length: range }, (_, i) => start + i * 86400000).filter((_, i) => (range - 1 - i) % labelEvery === 0)

  const latest = points[points.length - 1]
  const peak = points.reduce((a, b) => (b.count > a.count ? b : a))
  const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const summary = `Step chart of open handoffs over the last ${range} days. Now ${latest.count}, peak ${peak.count} at ${when(peak.at)}.`

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(x(p.at) - px) < Math.abs(x(points[best].at) - px)) best = i
    })
    setHover(best)
  }

  const hp = hover != null ? points[hover] : null
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${HH}`} className="block h-auto w-full" role="img" aria-label={summary} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted-foreground)" style={TNUM}>
                {compact(t)}
              </text>
            </g>
          ))}
          {days.map((t) => (
            <text key={t} x={x(t)} y={HH - 6} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
              {new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeOpacity="0.5" strokeWidth="1" />
          <path d={d} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hp && (
            <>
              <line x1={x(hp.at)} x2={x(hp.at)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted-foreground)" strokeOpacity="0.5" strokeWidth="1" />
              <circle cx={x(hp.at)} cy={y(hp.count)} r="4" fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />
            </>
          )}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-popover-foreground shadow-md"
            style={{ left: `${(x(hp.at) / W) * 100}%`, fontSize: 'var(--text-xs)' }}
          >
            <p className="whitespace-nowrap text-muted-foreground">{when(hp.at)}</p>
            <p className="whitespace-nowrap" style={{ fontWeight: 'var(--font-weight-medium)', ...TNUM }}>
              {hp.count.toLocaleString()} waiting on a person
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------
// Tools: 100% stacked bar per tool. Status colours, because the colour *means* good/bad.
// ---------------------------------------------------------------------------------

const OUTCOMES = [
  { key: 'successRate', label: 'Succeeded', className: 'bg-success' },
  { key: 'errorRate', label: 'Error', className: 'bg-destructive' },
  { key: 'timeoutRate', label: 'Timed out', className: 'bg-warning' },
] as const

type ToolRow = Awaited<ReturnType<typeof getToolBreakdown>>[number]

function Legend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={cn('size-2.5 rounded-sm', it.className)} aria-hidden="true" />
          {it.label}
        </span>
      ))}
    </div>
  )
}

const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(8rem,12rem)_4.5rem_minmax(0,1fr)_4.5rem]'

function ToolTable({ rows }: { rows: ToolRow[] }) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <Legend items={[...OUTCOMES]} />
      <div className={cn(ROW_GRID, 'hidden text-muted-foreground sm:grid')} style={{ fontSize: 'var(--text-xs)' }}>
        <span>Tool</span>
        <span className="text-right">Threads</span>
        <span>Outcome</span>
        <span className="text-right">Avg time</span>
      </div>
      <ul className="space-y-3 sm:space-y-2">
        {rows.map((row) => (
          <li key={row.tool} className={ROW_GRID} style={{ fontSize: 'var(--text-sm)' }}>
            <span className="truncate" title={row.tool}>
              {row.tool}
            </span>
            <span className="text-right" style={TNUM}>
              {compact(row.threads)}
              <span className="text-muted-foreground sm:hidden"> threads</span>
            </span>
            <OutcomeBar row={row} />
            <span className="text-right text-muted-foreground" style={TNUM}>
              {row.avgLatencyMs == null ? '—' : ms(row.avgLatencyMs)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OutcomeBar({ row }: { row: ToolRow }) {
  const parts = OUTCOMES.map((o) => ({ ...o, value: row[o.key] ?? 0 })).filter((p) => p.value > 0)
  const total = parts.reduce((n, p) => n + p.value, 0)
  const text = OUTCOMES.map((o) => `${o.label} ${row[o.key] == null ? '—' : pct(row[o.key] ?? 0)}`).join(', ')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} role="img" aria-label={`${row.tool}: ${text}`} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {total > 0 &&
            parts.map((p) => <span key={p.key} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />)}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <ul style={TNUM}>
          {OUTCOMES.map((o) => (
            <li key={o.key} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-sm', o.className)} aria-hidden="true" />
              {o.label} {row[o.key] == null ? '—' : pct(row[o.key] ?? 0)}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------------
// Business events: received as a pale track, processed as the solid bar laid over it —
// the gap between them is what didn't get processed.
// ---------------------------------------------------------------------------------

type EventData = Awaited<ReturnType<typeof getEventBreakdown>>

function EventTable({ rows, avgLatencyMs }: EventData) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.received, r.processed)))
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={[
            { label: 'Received', className: 'bg-primary/25' },
            { label: 'Processed', className: 'bg-primary' },
          ]}
        />
        {avgLatencyMs != null && (
          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)', ...TNUM }}>
            Avg processing time {ms(avgLatencyMs)}
          </span>
        )}
      </div>
      <div className={cn(ROW_GRID, 'hidden text-muted-foreground sm:grid')} style={{ fontSize: 'var(--text-xs)' }}>
        <span>Event</span>
        <span className="text-right">Processed</span>
        <span>Processed of received</span>
        <span className="text-right">Avg time</span>
      </div>
      <ul className="space-y-3 sm:space-y-2">
        {rows.map((row) => {
          const label = `${row.type}: ${row.processed.toLocaleString()} processed of ${row.received.toLocaleString()} received`
          return (
            <li key={row.type} className={ROW_GRID} style={{ fontSize: 'var(--text-sm)' }}>
              <span className="truncate" title={row.type}>
                {row.type}
              </span>
              <span className="text-right" style={TNUM}>
                {compact(row.processed)}
                <span className="text-muted-foreground"> / {compact(row.received)}</span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div tabIndex={0} role="img" aria-label={label} className="relative h-2.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: `${(row.received / max) * 100}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(row.processed / max) * 100}%` }} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span style={TNUM}>{label.slice(row.type.length + 2)}</span>
                </TooltipContent>
              </Tooltip>
              <span className="text-right text-muted-foreground" style={TNUM}>
                {row.avgLatencyMs == null ? '—' : ms(row.avgLatencyMs)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------------
// Connector health
// ---------------------------------------------------------------------------------

type HealthRow = Awaited<ReturnType<typeof getConnectorHealth>>[number]

function ConnectorCard({ row, onViewLogs }: { row: HealthRow; onViewLogs: () => void }) {
  const s = row.stats
  const healthy = s?.successRate != null && s.successRate >= 0.95
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate" style={{ fontWeight: 'var(--font-weight-medium)' }}>
            {row.name}
          </p>
          {s && s.executions > 0 && s.successRate != null && (
            <p className={cn('flex items-center gap-1', healthy ? 'text-success' : 'text-warning-foreground')} style={{ fontSize: 'var(--text-xs)' }}>
              {healthy ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5 text-warning" />}
              {healthy ? 'Working normally' : 'Some calls are failing'}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onViewLogs} className="shrink-0">
          View logs
        </Button>
      </div>

      {s && (
        <dl className="grid grid-cols-3 gap-3" style={TNUM}>
          <Stat label="Success" value={s.successRate == null ? '—' : pct(s.successRate)} />
          <Stat label="Calls" value={compact(s.executions)} />
          <Stat label="p95 time" value={s.p95LatencyS == null ? '—' : ms(s.p95LatencyS * 1000)} />
        </dl>
      )}
      {s && s.executions === 0 && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          No calls in the last 7 days.
        </p>
      )}

      {row.topFailures.length > 0 && (
        <div className="space-y-1 border-t border-border pt-3">
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Most common failures
          </p>
          <ul className="space-y-1">
            {row.topFailures.map((f) => (
              <li key={f.code} className="flex items-baseline gap-2" style={{ fontSize: 'var(--text-sm)' }}>
                <span className="shrink-0" style={{ fontWeight: 'var(--font-weight-medium)', ...TNUM }}>
                  {f.code}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={f.message}>
                  {f.message}
                </span>
                <span className="shrink-0 text-muted-foreground" style={TNUM}>
                  &times;{f.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.error && <InlineError message={row.error} />}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        {label}
      </dt>
      <dd style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-weight-medium)' }}>{value}</dd>
    </div>
  )
}
