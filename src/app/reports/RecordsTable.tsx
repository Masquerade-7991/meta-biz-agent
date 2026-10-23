import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { StatusPill } from '@/app/components/ui/status'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { errorDetail } from '@/app/api/meta'
import { getLog } from '@/app/api/overview'
import { hm, num } from '@/app/analytics/format'
import type { AnalyticsFilter, LogKind, LogPage, SortDir } from '@/app/analytics/types'
import { ticketsLink } from '@/app/tickets/ticketsLink'
import { cn } from '@/app/lib/utils'
import { MAX_LOG_ROWS } from './catalog'
import { cellText, columnLabel, LOG_NOUN, statusOf } from './records'

/** One record report (tickets, handovers…) on screen: sorted by the server on a header click, paged
 *  50 or 100 at a time; a row with a ticket opens it. */
export function RecordsTable({ kind, filter }: { kind: LogKind; filter: AnalyticsFilter }) {
  const navigate = useNavigate()
  const [skip, setSkip] = useState(0)
  const [size, setSize] = useState(50)
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null)
  const [page, setPage] = useState<LogPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify(filter)
  useEffect(() => {
    setSkip(0)
    setSort(null)
  }, [kind, key])
  useEffect(() => {
    let live = true
    setError(null)
    getLog(kind, filter, skip, size, sort).then(
      (p) => live && setPage(p),
      (err) => live && setError(errorDetail(err)),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, skip, size, key, retry, sort?.key, sort?.dir])
  // Only the first load shows the loader; a new sort or page keeps the old rows until the new ones arrive.
  const shown = page?.kind === kind ? page : null
  if (error) return <InlineError message={`Couldn’t load these records. ${error}`} onRetry={() => setRetry((n) => n + 1)} />
  if (!shown) return <PageLoader context="analytics" className="min-h-[30vh]" />
  const noun = LOG_NOUN[kind]
  const total = shown.total
  const by = (c: LogPage['columns'][number]) => {
    setSort(sort?.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.numeric ? 'desc' : 'asc' })
    setSkip(0)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium tabular-nums">
        {num(total)} {total === 1 ? noun[0] : noun[1]}
      </p>
      {total > MAX_LOG_ROWS && (
        <p className="flex items-center gap-2 text-sm text-warning-foreground">
          <AlertTriangle className="size-4 shrink-0" />
          The CSV has the first {num(MAX_LOG_ROWS)} of {num(total)} rows. Narrow the dates to get the rest.
        </p>
      )}
      {!shown.rows.length ? (
        <p className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">Nothing in this period. Try a longer date range.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card">
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
              <TableRow className="hover:bg-transparent">
                {shown.columns.map((c) => {
                  const on = sort?.key === c.key ? sort.dir : null
                  const Icon = on === 'asc' ? ArrowUp : on === 'desc' ? ArrowDown : ArrowUpDown
                  return (
                    <TableHead key={c.key} className={cn('whitespace-nowrap', c.numeric && 'text-right')} aria-sort={on ? (on === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sortable ? (
                        <button type="button" onClick={() => by(c)} className={cn('group inline-flex items-center gap-1 hover:text-foreground', c.numeric && 'flex-row-reverse')}>
                          {columnLabel(c)}
                          <Icon className={cn('size-3.5', !on && 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60')} aria-hidden />
                        </button>
                      ) : (
                        columnLabel(c)
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((r, i) => {
                const ticket = /^#\d+$/.test(String(r.ticket ?? '')) ? ticketsLink({ view: 'all', n: String(r.ticket).slice(1) }) : null
                return (
                  <TableRow key={skip + i} data-density-row className={cn(ticket && 'cursor-pointer')} onClick={ticket ? () => navigate(ticket) : undefined}>
                    {shown.columns.map((c) => {
                      const v = r[c.key] ?? null
                      const status = statusOf(c.key, v)
                      return (
                        <TableCell key={c.key} className={cn('whitespace-nowrap', c.numeric && 'text-right tabular-nums')}>
                          {c.key === 'ticket' && ticket ? (
                            <Link to={ticket} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                              {v}
                            </Link>
                          ) : status ? (
                            <StatusPill tone={status.tone}>{status.label}</StatusPill>
                          ) : c.key.endsWith('Min') && typeof v === 'number' ? (
                            hm(v)
                          ) : (
                            cellText(v)
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </table>
        </div>
      )}
      {total > 50 && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
          <Select
            value={String(size)}
            onValueChange={(v) => {
              setSize(Number(v))
              setSkip(0)
            }}
          >
            <SelectTrigger size="sm" className="w-auto" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 a page</SelectItem>
              <SelectItem value="100">100 a page</SelectItem>
            </SelectContent>
          </Select>
          <span className="tabular-nums">
            {num(skip + 1)}–{num(Math.min(skip + size, total))} of {num(total)}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={!skip} onClick={() => setSkip((s) => Math.max(0, s - size))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={skip + size >= total} onClick={() => setSkip((s) => s + size)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
