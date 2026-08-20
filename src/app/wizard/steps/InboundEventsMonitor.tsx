import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import {
  TableExtended,
  TableExtendedBody,
  TableExtendedCell,
  TableExtendedHead,
  TableExtendedHeader,
  TableExtendedRow,
} from '@/app/components/ui/table-extended'
import { AGENT_EVENT_STATUS_META, formatDuration, formatEventTime, formatEventTimestampPrecise } from '@/app/wizard/mockData'
import type { AgentEventRow, AgentEventStatus } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

const ALL_STATUSES: AgentEventStatus[] = ['request_received', 'processing', 'sent', 'success', 'failed', 'skipped']

type DateRange = '24h' | '7d' | '30d' | 'all'
const DATE_RANGE_MS: Record<Exclude<DateRange, 'all'>, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }
const DATE_RANGE_LABEL: Record<DateRange, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' }

const PAGE_SIZE = 10
// A chart of 1-4 points reads as noise, not a trend — same near-empty-data discipline already
// applied to whether a section gets a chart at all.
const CHART_MIN_EVENTS = 5

/** Solid-fill bar/dot colour per status, kept in sync with AGENT_EVENT_STATUS_META's badge
 *  treatment — `sent` stays a lighter tint of the same success colour `success` uses at full
 *  strength, the same distinction the badges make. */
const STATUS_BAR_COLOR: Record<AgentEventStatus, string> = {
  request_received: 'bg-muted-foreground/30',
  processing: 'bg-muted-foreground/60',
  sent: 'bg-success/40',
  success: 'bg-success',
  failed: 'bg-destructive',
  skipped: 'bg-warning',
}

const RANK_COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']

function dayKey(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}

function StatusBadge({ status }: { status: AgentEventStatus }) {
  const meta = AGENT_EVENT_STATUS_META[status]
  return (
    <Badge variant={meta.badgeVariant} className={meta.badgeClassName}>
      {meta.label}
    </Badge>
  )
}

/** Compact "Label: All / value / N selected" dropdown filter — the same Popover-menu-of-checkable-
 *  options idiom DropdownMenuCheckboxItem already exists for, just applied to filtering instead of
 *  a row's own actions. onSelect is suppressed so picking one option doesn't close the menu before
 *  the user is done picking more. */
function MultiSelectFilter({
  label,
  options,
  selected,
  onToggle,
  optionLabel = (v) => v,
  monospaceOptions,
}: {
  label: string
  options: string[]
  selected: Set<string>
  onToggle: (value: string) => void
  optionLabel?: (value: string) => string
  monospaceOptions?: boolean
}) {
  const triggerText = selected.size === 0 ? 'All' : selected.size === 1 ? optionLabel([...selected][0]) : `${selected.size} selected`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-normal">
          <span className="text-muted-foreground">{label}:</span> {triggerText}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt}
            checked={selected.has(opt)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(opt)}
          >
            <span className={monospaceOptions ? 'font-mono' : undefined} style={monospaceOptions ? { fontSize: 'var(--text-xs)' } : undefined}>
              {optionLabel(opt)}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{title}</p>
      {children}
    </div>
  )
}

function StatusBreakdownChart({ rows }: { rows: AgentEventRow[] }) {
  const total = rows.length
  const counts = ALL_STATUSES.map((status) => ({ status, count: rows.filter((r) => r.status === status).length })).filter((c) => c.count > 0)

  return (
    <ChartCard title="Status breakdown">
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
        {counts.map(({ status, count }) => (
          <div
            key={status}
            className={STATUS_BAR_COLOR[status]}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${AGENT_EVENT_STATUS_META[status].label}: ${count}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {counts.map(({ status, count }) => (
          <span key={status} className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-xs)' }}>
            <span className={cn('size-2 shrink-0 rounded-full', STATUS_BAR_COLOR[status])} />
            <span className="text-muted-foreground">{AGENT_EVENT_STATUS_META[status].label}</span>
            <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{count}</span>
          </span>
        ))}
      </div>
    </ChartCard>
  )
}

function VolumeOverTimeChart({ rows }: { rows: AgentEventRow[] }) {
  const counts = new Map<number, number>()
  rows.forEach((r) => {
    const key = dayKey(r.createdAt)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const days = [...counts.entries()].sort((a, b) => a[0] - b[0])
  const max = Math.max(...days.map(([, c]) => c), 1)

  return (
    <ChartCard title="Volume over time">
      <div className="mt-3 flex h-24 items-end gap-1 overflow-x-auto">
        {days.map(([day, count]) => (
          <div
            key={day}
            className="flex h-full min-w-[8px] flex-1 items-end"
            title={`${count} event${count === 1 ? '' : 's'} on ${new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
          >
            <div className="w-full rounded-t bg-chart-1" style={{ height: `${Math.max(6, (count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        <span>{new Date(days[0][0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>{new Date(days[days.length - 1][0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    </ChartCard>
  )
}

function TopEventTypesChart({ rows }: { rows: AgentEventRow[] }) {
  const counts = new Map<string, number>()
  rows.forEach((r) => counts.set(r.eventType, (counts.get(r.eventType) ?? 0) + 1))
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const max = ranked[0]?.[1] ?? 1

  return (
    <ChartCard title="Most common event types">
      <div className="mt-3 space-y-2">
        {ranked.map(([type, count], i) => (
          <div key={type} className="flex items-center gap-3">
            <code className="w-36 shrink-0 truncate" style={{ fontSize: 'var(--text-xs)' }}>
              {type}
            </code>
            <div className="h-2 flex-1 rounded-full bg-muted">
              <div className={cn('h-2 rounded-full', RANK_COLORS[i % RANK_COLORS.length])} style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <span className="w-6 shrink-0 text-right text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              {count}
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

function EventDetailDialog({ row, onClose }: { row: AgentEventRow; onClose: () => void }) {
  const [showRaw, setShowRaw] = useState(false)
  const reason = row.status === 'failed' ? row.errorMessage : row.status === 'skipped' ? row.skippedReason : null
  const reasonLabel = row.status === 'failed' ? 'Error' : 'Skipped reason'

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <code style={{ fontWeight: 'var(--font-weight-regular)' }}>{row.eventType}</code>
            <StatusBadge status={row.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1" style={{ fontSize: 'var(--text-sm)' }}>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <span className="text-muted-foreground">Received</span>
            <span>{formatEventTimestampPrecise(row.createdAt)}</span>
            <span className="text-muted-foreground">Last updated</span>
            <span>{formatEventTimestampPrecise(row.updatedAt)}</span>
          </div>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Took {formatDuration(row.updatedAt - row.createdAt)}
          </p>

          <div>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              Sent to
            </p>
            <p>{row.to}</p>
          </div>

          <div>
            <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Description</p>
            <p className="text-muted-foreground">{row.description}</p>
          </div>

          {reason && (
            <div>
              <p className={cn(row.status === 'failed' ? 'text-destructive' : 'text-warning-foreground', 'font-medium')}>{reasonLabel}</p>
              <p className={row.status === 'failed' ? 'text-destructive' : undefined}>{reason}</p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-3">
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Payload</p>
              <button type="button" onClick={() => setShowRaw((v) => !v)} className="shrink-0 text-primary" style={{ fontSize: 'var(--text-xs)' }}>
                {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
              </button>
            </div>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              A technical field passed through as-is from the system that sent this event. Not normally needed unless
              you&rsquo;re troubleshooting with a developer.
            </p>
            {showRaw && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2" style={{ fontSize: 'var(--text-xs)' }}>
                {prettyPayload(row.payload)}
              </pre>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EventsTableSkeleton() {
  return (
    <TableExtended>
      <TableExtendedHeader>
        <TableExtendedRow>
          <TableExtendedHead>Time</TableExtendedHead>
          <TableExtendedHead>Type</TableExtendedHead>
          <TableExtendedHead>Description</TableExtendedHead>
          <TableExtendedHead>Recipient</TableExtendedHead>
          <TableExtendedHead>Status</TableExtendedHead>
        </TableExtendedRow>
      </TableExtendedHeader>
      <TableExtendedBody>
        {Array.from({ length: 5 }).map((_, i) => (
          <TableExtendedRow key={i}>
            <TableExtendedCell>
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </TableExtendedCell>
            <TableExtendedCell>
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            </TableExtendedCell>
            <TableExtendedCell>
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </TableExtendedCell>
            <TableExtendedCell>
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            </TableExtendedCell>
            <TableExtendedCell>
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            </TableExtendedCell>
          </TableExtendedRow>
        ))}
      </TableExtendedBody>
    </TableExtended>
  )
}

/** The monitoring half of Inbound business events: a filterable, paginated, real-field-grounded
 *  log of every submitted agent_event, with detail-on-click and three charts above it. Setup
 *  (webhook, secret, event type defs) lives in InboundEventsSetupDialog in ActivityPage.tsx and is
 *  untouched by this component. */
export function InboundEventsMonitor({ events }: { events: AgentEventRow[] }) {
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded'>('loading')
  useEffect(() => {
    const timer = setTimeout(() => setLoadStatus('loaded'), 500)
    return () => clearTimeout(timer)
  }, [])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())
  const [dateRange, setDateRange] = useState<DateRange>('30d')
  const [sortAsc, setSortAsc] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  const availableTypes = useMemo(() => [...new Set(events.map((e) => e.eventType))].sort(), [events])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const cutoff = dateRange === 'all' ? 0 : Date.now() - DATE_RANGE_MS[dateRange]
    const rows = events.filter((row) => {
      if (row.createdAt < cutoff) return false
      if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false
      if (typeFilter.size > 0 && !typeFilter.has(row.eventType)) return false
      if (q && !row.eventType.toLowerCase().includes(q) && !row.description.toLowerCase().includes(q)) return false
      return true
    })
    return rows.sort((a, b) => (sortAsc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
  }, [events, search, statusFilter, typeFilter, dateRange, sortAsc])

  // Filters/search/sort changed underneath the current page — start back at page one rather than
  // showing a confusing short list mid-scroll.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, statusFilter, typeFilter, dateRange, sortAsc])

  function toggleInSet(setter: typeof setStatusFilter, value: string) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function clearFilters() {
    setSearch('')
    setStatusFilter(new Set())
    setTypeFilter(new Set())
    setDateRange('all')
  }

  function loadMore() {
    setLoadingMore(true)
    setTimeout(() => {
      setVisibleCount((v) => v + PAGE_SIZE)
      setLoadingMore(false)
    }, 500)
  }

  const pagedRows = filteredRows.slice(0, visibleCount)
  const hasMore = filteredRows.length > pagedRows.length
  const openRow = openRowId ? (events.find((e) => e.id === openRowId) ?? null) : null
  const filtersActive = !!search.trim() || statusFilter.size > 0 || typeFilter.size > 0 || dateRange !== 'all'

  if (events.length === 0) {
    return (
      <div className="space-y-1 rounded-lg border border-border bg-muted p-4">
        <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>No events received yet.</p>
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Once your systems start sending events here, they&rsquo;ll show up in this list.
        </p>
      </div>
    )
  }

  if (loadStatus === 'loading') {
    return <EventsTableSkeleton />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events..." className="pl-9" />
        </div>
        <MultiSelectFilter
          label="Status"
          options={ALL_STATUSES}
          selected={statusFilter}
          onToggle={(v) => toggleInSet(setStatusFilter, v)}
          optionLabel={(v) => AGENT_EVENT_STATUS_META[v as AgentEventStatus].label}
        />
        <MultiSelectFilter
          label="Type"
          options={availableTypes}
          selected={typeFilter}
          onToggle={(v) => toggleInSet(setTypeFilter, v)}
          monospaceOptions
        />
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
          <SelectTrigger className="w-40" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DATE_RANGE_LABEL) as DateRange[]).map((r) => (
              <SelectItem key={r} value={r}>
                {DATE_RANGE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredRows.length >= CHART_MIN_EVENTS && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatusBreakdownChart rows={filteredRows} />
            <TopEventTypesChart rows={filteredRows} />
          </div>
          <VolumeOverTimeChart rows={filteredRows} />
        </div>
      )}

      {filteredRows.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-border p-6 text-center">
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No events match these filters.
          </p>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <TableExtended>
            <TableExtendedHeader>
              <TableExtendedRow>
                <TableExtendedHead>
                  <button type="button" onClick={() => setSortAsc((v) => !v)} className="flex items-center gap-1">
                    Time {sortAsc ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                </TableExtendedHead>
                <TableExtendedHead>Type</TableExtendedHead>
                <TableExtendedHead>Description</TableExtendedHead>
                <TableExtendedHead>Recipient</TableExtendedHead>
                <TableExtendedHead>Status</TableExtendedHead>
              </TableExtendedRow>
            </TableExtendedHeader>
            <TableExtendedBody>
              {pagedRows.map((row) => (
                <TableExtendedRow key={row.id} className="cursor-pointer hover:bg-accent/50" onClick={() => setOpenRowId(row.id)}>
                  <TableExtendedCell className="text-muted-foreground whitespace-nowrap">{formatEventTime(row.createdAt)}</TableExtendedCell>
                  <TableExtendedCell>
                    <Badge variant="outline" className="font-mono">
                      {row.eventType}
                    </Badge>
                  </TableExtendedCell>
                  <TableExtendedCell className="max-w-xs truncate" title={row.description}>
                    {row.description}
                  </TableExtendedCell>
                  <TableExtendedCell className="whitespace-nowrap">{row.to}</TableExtendedCell>
                  <TableExtendedCell>
                    <StatusBadge status={row.status} />
                  </TableExtendedCell>
                </TableExtendedRow>
              ))}
            </TableExtendedBody>
          </TableExtended>

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
                Load more events
              </Button>
            </div>
          )}
        </div>
      )}

      {!filtersActive && filteredRows.length > 0 && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          Showing {pagedRows.length} of {filteredRows.length} events
        </p>
      )}

      {openRow && <EventDetailDialog row={openRow} onClose={() => setOpenRowId(null)} />}
    </div>
  )
}
