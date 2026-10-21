import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { errorDetail } from '@/app/api/meta'
import { getLog } from '@/app/api/overview'
import { num } from '@/app/analytics/format'
import type { AnalyticsFilter, LogKind, LogPage } from '@/app/analytics/types'
import { ticketsLink } from '@/app/tickets/ticketsLink'
import { cn } from '@/app/lib/utils'

const PAGE = 50

/** One record report (tickets, handovers…) on screen, 50 rows a page. `onLoad` gets each page (its total). */
export function RecordsTable({ kind, filter, onLoad }: { kind: LogKind; filter: AnalyticsFilter; onLoad?: (p: LogPage) => void }) {
  const [skip, setSkip] = useState(0)
  const [page, setPage] = useState<LogPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const key = JSON.stringify(filter)
  useEffect(() => setSkip(0), [kind, key])
  useEffect(() => {
    let live = true
    setPage(null)
    setError(null)
    getLog(kind, filter, skip, PAGE).then(
      (p) => {
        if (!live) return
        setPage(p)
        onLoad?.(p)
      },
      (err) => live && setError(errorDetail(err)),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, skip, key, retry])
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        {error ? (
          <p className="p-6 text-sm text-destructive">
            Couldn&rsquo;t load these records. {error}{' '}
            <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </p>
        ) : !page ? (
          <PageLoader context="analytics" className="min-h-[30vh]" />
        ) : !page.rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">Nothing in this period. Try a longer date range.</p>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                {page.columns.map((c) => (
                  <TableHead key={c.key} className={cn('whitespace-nowrap', c.numeric && 'text-right')}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((r, i) => (
                <TableRow key={i} data-density-row>
                  {page.columns.map((c) => (
                    <TableCell key={c.key} className={cn('whitespace-nowrap', c.numeric && 'text-right tabular-nums')}>
                      {c.key === 'ticket' && /^#\d+$/.test(String(r[c.key])) ? (
                        <Link to={ticketsLink({ view: 'all', n: String(r[c.key]).slice(1) })} className="text-primary hover:underline">
                          {r[c.key]}
                        </Link>
                      ) : (
                        (r[c.key] ?? '–')
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {page && page.total > PAGE && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          {skip + 1}–{Math.min(skip + PAGE, page.total)} of {num(page.total)}
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={!skip} onClick={() => setSkip((s) => Math.max(0, s - PAGE))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={skip + PAGE >= page.total} onClick={() => setSkip((s) => s + PAGE)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
