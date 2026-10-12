import { useCallback, useEffect, useState } from 'react'
import { Bot, History } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@/app/components/ui/button'
import { EmptyState } from '@/app/components/ui/page'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { errorDetail } from '@/app/api/meta'
import { listActivity, type ActivityQuery } from '@/app/api/activity'
import { activityText, type ActivityEvent, type Names } from './activityText'
import { cn, initialsOf } from '@/app/lib/utils'

const dayOf = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The activity log for a query, newest first, grouped by day, 50 at a time. `compact` drops the
 *  day headings and links (a ticket's own history). */
export function ActivityList({ query, compact, empty = 'Nothing has happened here yet.' }: { query: ActivityQuery; compact?: boolean; empty?: string }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ActivityEvent[] | null>(null)
  const [names, setNames] = useState<Names>({})
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const key = JSON.stringify(query)

  const load = useCallback(
    async (before?: string) => {
      setError(null)
      try {
        const page = await listActivity(JSON.parse(key) as ActivityQuery, before)
        setRows((r) => (before ? [...(r ?? []), ...page.events] : page.events))
        setNames((n) => ({ ...n, ...page.names }))
        setMore(page.more)
      } catch (err) {
        setError(errorDetail(err))
        if (!before) setRows(null)
      }
    },
    [key],
  )
  useEffect(() => {
    setRows(null)
    void load()
  }, [load])

  if (error && !rows) return <InlineError message={`Couldn’t load the activity. ${error}`} onRetry={() => void load()} />
  if (!rows) return <PageLoader context="settings" className={compact ? 'py-6' : undefined} />
  if (!rows.length) return compact ? <p className="text-muted-foreground text-sm">{empty}</p> : <EmptyState icon={History} title="No activity found" description={empty} />

  return (
    <div className="space-y-3">
      <ol className={cn(!compact && 'rounded-lg border border-border')}>
        {rows.map((e, i) => {
          const day = dayOf(e.at)
          const newDay = !compact && day !== (i ? dayOf(rows[i - 1].at) : '')
          const ticket = !compact && e.entity === 'ticket' && e.entityId
          return (
            <li key={e.id}>
              {newDay && <p className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground first:rounded-t-lg">{day}</p>}
              <div data-density-row className={cn('flex items-start gap-3 text-sm', compact ? 'py-1.5' : 'border-b border-border px-4 py-2.5')}>
                <span
                  aria-hidden
                  className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-micro font-semibold', e.userId ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}
                >
                  {e.userId ? initialsOf(e.actor || names[e.userId] || '?') : <Bot className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  {activityText(e, names)}
                  {ticket && (
                    <Button variant="link" size="sm" className="ml-1 h-auto p-0 align-baseline" onClick={() => navigate(`/tickets?n=${e.entityId}`)}>
                      Open
                    </Button>
                  )}
                </span>
                <time dateTime={e.at} title={new Date(e.at).toLocaleString()} className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {compact ? `${dayOf(e.at)}, ${timeOf(e.at)}` : timeOf(e.at)}
                </time>
              </div>
            </li>
          )
        })}
      </ol>
      {error && <InlineError message={error} onRetry={() => void load(rows.at(-1)?.id)} />}
      {more && (
        <Button
          variant="outline"
          size="sm"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true)
            await load(rows.at(-1)?.id)
            setLoadingMore(false)
          }}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
