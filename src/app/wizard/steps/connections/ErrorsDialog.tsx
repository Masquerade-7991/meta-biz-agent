import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { connectorLogs, errorText, type ConnectorLogs } from '@/app/api/meta'
import type { Connection } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { formatActivityTime } from './helpers'
import { DIALOG_TITLE } from './places'

/** A connection's record: Meta's last 7 days of errors and stats, or this browser's test runs before it's on Meta. */
export function ErrorsDialog({
  connection,
  rows,
  onClose,
}: {
  connection: Connection
  rows: { id: string; actionName: string; timestamp: number; outcome: 'worked' | 'failed'; errorText?: string }[]
  onClose: () => void
}) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  // A connector on Meta: its real last-7-days log (PRD AC-a19..a22). Otherwise, local test runs.
  const [logs, setLogs] = useState<ConnectorLogs | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(100)
  const [page, setPage] = useState(0)
  useEffect(() => {
    if (!connection.metaId) return
    connectorLogs(connection.metaId).then(setLogs, (err) => setLogsError(errorText(err)))
  }, [connection.metaId])
  const remoteRows = (logs?.data ?? []).map((d, i) => ({
    id: `log-${i}`,
    actionName: d.tool_name ?? 'Unknown tool',
    timestamp: d.event_time ? Date.parse(d.event_time) : Date.now(),
    outcome: 'failed' as const,
    errorText: [d.failure_code_name, d.error_message].filter(Boolean).join(': '),
  }))
  // Meta's failures, plus tests run from this browser (worked or not), marked as tests.
  const allRows = connection.metaId ? [...remoteRows, ...rows.map((r) => ({ ...r, actionName: `${r.actionName} · test` }))] : rows
  const sorted = [...allRows].sort((a, b) => b.timestamp - a.timestamp)
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize)
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle style={DIALOG_TITLE}>Errors and stats: <span className="font-mono">{connection.name}</span></DialogTitle>
          <DialogDescription>
            {connection.metaId
              ? 'The last 7 days on Meta, plus tests run from this browser. Meta keeps only failed calls, so successful chats count in the totals, not the list.'
              : 'Tests run from this browser.'}
          </DialogDescription>
        </DialogHeader>
        {logsError && <InlineError message={`Could not load activity. ${logsError}`} />}
        {logs?.stats && (
          <div className="grid grid-cols-4 gap-2">
            {[
              ['Executions', String(logs.stats.start_count)],
              ['Succeeded', String(logs.stats.success_count)],
              ['Success rate', `${Math.round((logs.stats.success_rate ?? 0) * (logs.stats.success_rate > 1 ? 1 : 100))}%`],
              ['Avg latency', `${(logs.stats.avg_latency_s ?? 0).toFixed(2)} s`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {label}
                </p>
                <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{value}</p>
              </div>
            ))}
          </div>
        )}
        {connection.metaId && !logs && !logsError ? (
          <p className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            <Loader2 className="size-3.5 animate-spin" /> Loading activity...
          </p>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            {connection.metaId ? 'No errors in the last 7 days.' : 'No tests run yet.'}
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {pageRows.map((row) => (
              <div key={row.id} className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => row.outcome === 'failed' && setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="flex items-center gap-3" style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="text-muted-foreground">{formatActivityTime(row.timestamp)}</span>
                    <span>{row.actionName}</span>
                  </span>
                  <span
                    className={cn(row.outcome === 'worked' ? 'text-success' : 'text-warning-foreground')}
                    style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}
                  >
                    {row.outcome === 'worked' ? 'Worked' : 'Failed'}
                  </span>
                </button>
                {row.outcome === 'failed' && expandedRowId === row.id && (
                  <pre className="mx-3 mb-2 max-h-32 min-w-0 overflow-auto rounded-md bg-muted p-2 break-all whitespace-pre-wrap" style={{ fontSize: 'var(--text-xs)' }}>
                    {row.errorText}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
        {sorted.length > 10 && (
          <div className="flex items-center justify-between gap-2" style={{ fontSize: 'var(--text-xs)' }}>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Per page
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(0)
                }}
                className="rounded border border-border bg-background"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              {page + 1} / {pageCount}
              <Button size="sm" variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
