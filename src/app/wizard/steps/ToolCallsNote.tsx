import { useState } from 'react'
import { CheckCircle2, ChevronRight, Loader2, Wrench, XCircle } from 'lucide-react'
import { cn } from '@/app/lib/utils'
import { readable, type ToolCall, type ToolCallsState } from '@/app/wizard/testTools'

const XS = { fontSize: 'var(--text-xs)' } as const

/**
 * Under an agent reply in Test & Eval: which connector tools it called, with what, and what came
 * back. Shows nothing when there are no tools to call and none were used.
 */
export function ToolCallsNote({ tools, hasTools, onOpenConnections }: { tools?: ToolCallsState; hasTools: boolean; onOpenConnections: () => void }) {
  if (!tools) return null
  if (tools.state === 'checking')
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground" style={XS}>
        <Loader2 className="size-3 animate-spin" /> Checking which tools it used…
      </p>
    )
  if (tools.state === 'unknown')
    return hasTools ? (
      <p className="text-muted-foreground" style={XS}>
        Couldn&rsquo;t check which tools it used.
      </p>
    ) : null
  if (!tools.calls.length)
    return hasTools ? (
      <p className="max-w-[80%] text-muted-foreground" style={XS}>
        No tools used for this reply. If it should have used one, make that tool&rsquo;s &ldquo;When should the agent use it?&rdquo; more specific.
      </p>
    ) : null
  return (
    <div className="w-full max-w-[80%] space-y-1">
      {tools.calls.map((c, i) => (
        <Call key={i} call={c} onOpenConnections={onOpenConnections} />
      ))}
    </div>
  )
}

function Call({ call: c, onOpenConnections }: { call: ToolCall; onOpenConnections: () => void }) {
  const [open, setOpen] = useState(false)
  const ok = c.status === 'SUCCESS'
  const details = !!(c.input || c.output)
  return (
    <div className={cn('rounded-md border', ok ? 'border-border bg-card' : 'border-destructive/40 bg-destructive/5')}>
      <button
        type="button"
        onClick={() => details && setOpen((o) => !o)}
        aria-expanded={details ? open : undefined}
        className={cn('flex w-full items-center gap-1.5 px-2 py-1 text-left', !details && 'cursor-default')}
        style={XS}
      >
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span>
          Used <span className="font-mono">{c.tool}</span>
          {c.connector && <span className="text-muted-foreground"> · {c.connector}</span>}
        </span>
        {ok ? <CheckCircle2 className="size-3 shrink-0 text-success" /> : <XCircle className="size-3 shrink-0 text-destructive" />}
        <span className="whitespace-nowrap text-muted-foreground">{ok ? '' : c.status === 'TIMEOUT' ? 'timed out' : 'failed'}{c.ms !== undefined ? ` ${(c.ms / 1000).toFixed(1)} s` : ''}</span>
        {details && <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          {c.input && <Block label="Sent" text={readable(c.input)} />}
          {c.output && <Block label="Got back" text={readable(c.output)} />}
        </div>
      )}
      {!ok && (
        <p className="px-2 pb-1.5 text-muted-foreground" style={XS}>
          The agent couldn&rsquo;t use this tool.{' '}
          <button type="button" onClick={onOpenConnections} className="text-primary hover:underline">
            Test it in Connections
          </button>
        </p>
      )}
    </div>
  )
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-muted-foreground" style={XS}>
        {label}
      </p>
      <pre className="max-h-40 min-w-0 overflow-auto rounded bg-muted/60 p-1.5 break-all whitespace-pre-wrap" style={{ fontSize: 11, lineHeight: 1.5 }}>
        {text}
      </pre>
    </div>
  )
}
