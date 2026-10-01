import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, Search } from 'lucide-react'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
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
const PAGE_SIZE = 10

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

/** A plain "Label: N" count per status present in the currently visible rows — never a bar or
 *  trend, just addition. The one summary this section earns under the governing one-chart,
 *  one-sentence rule; everything more detailed than this was cut. */
function StatusCounts({ rows }: { rows: AgentEventRow[] }) {
  const counts = ALL_STATUSES.map((status) => ({ status, count: rows.filter((r) => r.status === status).length })).filter(
    (c) => c.count > 0,
  )
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {counts.map(({ status, count }) => (
        <span key={status} style={{ fontSize: 'var(--text-sm)' }}>
          <span className="text-muted-foreground">{AGENT_EVENT_STATUS_META[status].label}: </span>
          <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{count}</span>
        </span>
      ))}
    </div>
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

/** The monitoring half of Inbound business events: a searchable, status-filterable, paginated,
 *  real-field-grounded log of every submitted agent_event, with detail-on-click and one plain
 *  status-count line above it — no bar charts, no type filter, no date range, per the one-chart
 *  rule this page now holds to. Setup (webhook, secret, event type defs) lives in
 *  InboundEventsSetupDialog in ActivityPage.tsx and is untouched by this component. */
export function InboundEventsMonitor({ events }: { events: AgentEventRow[] }) {
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded'>('loading')
  useEffect(() => {
    const timer = setTimeout(() => setLoadStatus('loaded'), 500)
    return () => clearTimeout(timer)
  }, [])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AgentEventStatus>('all')
  const [sortAsc, setSortAsc] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = events.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (q && !row.eventType.toLowerCase().includes(q) && !row.description.toLowerCase().includes(q)) return false
      return true
    })
    return rows.sort((a, b) => (sortAsc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
  }, [events, search, statusFilter, sortAsc])

  // Filters/search/sort changed underneath the current page — start back at page one rather than
  // showing a confusing short list mid-scroll.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, statusFilter, sortAsc])

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
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
  const filtersActive = !!search.trim() || statusFilter !== 'all'

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
        <div className="relative min-w-55 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | AgentEventStatus)}>
          <SelectTrigger className="w-44" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: All</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {AGENT_EVENT_STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredRows.length > 0 && <StatusCounts rows={filteredRows} />}

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
