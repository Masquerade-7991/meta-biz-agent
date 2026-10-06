import { AlertTriangle, ChevronDown, Loader2, MoreHorizontal, Plug, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { CONNECTION_STATUS_META } from '@/app/wizard/mockData'
import type { Connection, ConnectionAction } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { domainFromUrl } from './helpers'
import { MethodBadge } from './parts'

const SM = { fontSize: 'var(--text-sm)' } as const
const MANY_TOOLS = 6

/** What the status means and the one thing to do about it. */
function statusLine(c: Connection): { text: string; action?: 'key' | 'errors' } | null {
  if (!c.metaId) return { text: 'Not saved to Meta yet. Edit and save it to use it.' }
  switch (c.demoStatus) {
    case 'waiting_signin':
      return { text: 'Not connected yet: it needs its key.', action: 'key' }
    case 'key_rejected':
      return { text: 'The system stopped accepting the key. Tokens like Shopify’s expire after about a day.', action: 'key' }
    case 'having_problems':
      return { text: 'Recent calls failed.', action: 'errors' }
    case 'not_tested':
      return { text: 'Test a tool to check it works.' }
    default:
      return null
  }
}

/** One connection: its status, its tools, and what can be done with them. */
export function ConnectionCard({
  connection: c,
  tools,
  expanded,
  canEdit,
  refreshing,
  rowError,
  onToggle,
  onAddTool,
  onRefreshTools,
  onEditTool,
  onTestTool,
  onDeleteTool,
  onEdit,
  onReplaceKey,
  onErrors,
  onDelete,
  onClearError,
}: {
  connection: Connection
  tools: ConnectionAction[]
  expanded: boolean
  canEdit: boolean
  refreshing: boolean
  rowError: Record<string, string>
  onToggle: () => void
  onAddTool: () => void
  onRefreshTools: () => void
  onEditTool: (t: ConnectionAction) => void
  onTestTool: (t: ConnectionAction) => void
  onDeleteTool: (t: ConnectionAction) => void
  onEdit: () => void
  onReplaceKey: () => void
  onErrors: () => void
  onDelete: () => void
  onClearError: (id: string) => void
}) {
  const isMcp = c.protocol === 'mcp'
  const status = CONNECTION_STATUS_META[c.demoStatus]
  const line = statusLine(c)
  // PRD AC-c14a: tools run only while the connection itself is Active.
  const testBlocked = !c.metaId ? 'Save the connection first.' : c.demoStatus !== 'working' && c.demoStatus !== 'not_tested' ? `Can’t test while the connection is ${status.label}.` : null
  const panelId = `conn-tools-${c.id}`

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 px-4 py-3">
        <Plug className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">
              {c.name}
            </span>
            <span
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs', status.dot === 'success' ? 'bg-success/10 text-success' : status.dot === 'warning' ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground')}
            >
              <span className={cn('size-1.5 rounded-full', status.dot === 'success' ? 'bg-success' : status.dot === 'warning' ? 'bg-warning' : 'bg-muted-foreground/50')} />
              {status.label}
            </span>
            {isMcp && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                MCP{c.mcpSync?.status === 'ERROR' ? ' · couldn’t list tools' : c.mcpSync?.status === 'PENDING' ? ' · listing tools…' : ''}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-muted-foreground text-xs">
            {domainFromUrl(c.baseUrl)} · {tools.length} tool{tools.length === 1 ? '' : 's'}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {canEdit &&
            (isMcp ? (
              <Button size="sm" variant="outline" onClick={onRefreshTools} disabled={refreshing || !c.metaId}>
                {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh tools
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onAddTool} disabled={!c.metaId}>
                <Plus className="size-3.5" /> Add tool
              </Button>
            ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`More for ${c.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onErrors}>Errors and stats</DropdownMenuItem>
              {canEdit && (
                <>
                  <DropdownMenuItem onClick={onEdit}>Edit connection</DropdownMenuItem>
                  {c.authMethod !== 'none' && <DropdownMenuItem onClick={onReplaceKey}>{c.authMethod === 'client_credentials' ? 'Replace secret' : 'Replace key'}</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    Delete connection
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon-sm" variant="ghost" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId} aria-label={expanded ? 'Hide tools' : 'Show tools'}>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {line && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-3 pl-11 text-muted-foreground text-xs">
          {line.action && <AlertTriangle className="size-3.5 shrink-0 text-warning-foreground" />}
          <span>{line.text}</span>
          {line.action === 'key' && canEdit && (
            <button type="button" className="text-primary hover:underline" onClick={onReplaceKey}>
              {c.authMethod === 'client_credentials' ? 'Replace secret' : 'Replace key'}
            </button>
          )}
          {line.action === 'errors' && (
            <button type="button" className="text-primary hover:underline" onClick={onErrors}>
              See errors
            </button>
          )}
        </div>
      )}

      {rowError[c.id] && (
        <div className="px-4 pb-3 pl-11">
          <InlineError message={rowError[c.id]} onRetry={() => onClearError(c.id)} />
        </div>
      )}

      {expanded && (
        <div id={panelId} className="border-t border-border px-2 py-2">
          {tools.length === 0 ? (
            <p className="px-3 py-3 text-muted-foreground text-sm">
              {isMcp ? 'No tools yet. Refresh tools to ask the server for its list.' : 'No tools yet. A tool is one request the agent can make, like “look up an order”.'}
            </p>
          ) : (
            <ul>
              {tools.map((t) => (
                <li key={t.id} className="rounded-md px-2 py-2 hover:bg-accent/40">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono" style={{ ...SM, fontWeight: 'var(--font-weight-medium)' }}>
                        {t.name}
                      </p>
                      <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                        <MethodBadge method={t.method} />
                        <span className="truncate font-mono">{t.path || '/'}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onTestTool(t)} disabled={!!testBlocked || !t.metaId} title={testBlocked ?? undefined}>
                        Test
                      </Button>
                      {canEdit && !t.fromMcp && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => onEditTool(t)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onDeleteTool(t)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {rowError[t.id] && <InlineError message={rowError[t.id]} onRetry={() => onClearError(t.id)} />}
                </li>
              ))}
            </ul>
          )}
          {testBlocked && tools.length > 0 && (
            <p className="px-3 pt-1 pb-2 text-muted-foreground text-xs">
              {testBlocked}
            </p>
          )}
          {tools.length > MANY_TOOLS && (
            <p className="flex items-center gap-1.5 px-3 pt-1 pb-2 text-warning-foreground text-xs">
              <AlertTriangle className="size-3.5 shrink-0" />
              Many similar tools make it harder for the agent to pick the right one. Fewer, clearly described tools work better.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
