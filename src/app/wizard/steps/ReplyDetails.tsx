import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, Clock, Loader2, MessageSquareOff, UserRound, Wrench, XCircle } from 'lucide-react'
import { cn } from '@/app/lib/utils'
import { readable, type ToolCall, type ToolCallsState } from '@/app/wizard/testTools'

const XS = { fontSize: 'var(--text-xs)' } as const
const SM = { fontSize: 'var(--text-sm)' } as const

/** What happened behind one reply in a Test & Eval chat. */
export interface ReplyInfo {
  /** The customer message it answers. */
  asked: string
  /** Time from sending to the reply, in ms. */
  ms: number
  outcome: 'replied' | 'handoff' | 'no_reply'
  /** Meta's handoff or no-reply reason. */
  reason?: string
  /** Connector tools it called (looked up only when the agent has tools). */
  tools?: ToolCallsState
}

/**
 * Beside the test phone: one row per reply, newest first: what the customer asked, what the agent
 * did (replied, handed off, stayed quiet), how long it took and which tools it used. Kept out of the
 * phone so the conversation reads exactly as the customer would see it.
 */
export function BehindTheScenes({
  replies,
  selected,
  onSelect,
  hasTools,
  onOpenConnections,
}: {
  /** Message index → what happened, in conversation order. */
  replies: { index: number; info: ReplyInfo }[]
  selected: number | null
  onSelect: (index: number) => void
  hasTools: boolean
  onOpenConnections: () => void
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-border bg-card" aria-label="Behind the scenes">
      <div className="border-b border-border px-4 py-3">
        <h3 style={{ ...SM, fontWeight: 'var(--font-weight-semi-bold)' }}>Behind the scenes</h3>
        <p className="text-muted-foreground" style={XS}>
          What your agent did for each reply. Customers never see this.
        </p>
      </div>
      {replies.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground">
          <Wrench className="size-5" />
          <p style={SM}>Send a message to see what your agent did behind each reply: tools, handoffs and timing.</p>
        </div>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {[...replies].reverse().map(({ index, info }) => (
            <Row key={index} info={info} selected={selected === index} onSelect={() => onSelect(index)} hasTools={hasTools} onOpenConnections={onOpenConnections} />
          ))}
        </ol>
      )}
    </section>
  )
}

function Row({ info, selected, onSelect, hasTools, onOpenConnections }: { info: ReplyInfo; selected: boolean; onSelect: () => void; hasTools: boolean; onOpenConnections: () => void }) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  const outcome =
    info.outcome === 'handoff'
      ? { icon: UserRound, text: 'Handed to a person', tone: 'text-warning-foreground' }
      : info.outcome === 'no_reply'
        ? { icon: MessageSquareOff, text: 'Didn’t reply', tone: 'text-muted-foreground' }
        : { icon: CheckCircle2, text: 'Replied', tone: 'text-success' }
  const Icon = outcome.icon
  const t = info.tools
  return (
    <li ref={ref} className={cn('space-y-2 px-4 py-3 transition-colors', selected ? 'bg-accent/60' : 'hover:bg-accent/30')}>
      <button type="button" onClick={onSelect} className="w-full space-y-1 text-left">
        <p className="line-clamp-2 text-muted-foreground" style={XS}>
          &ldquo;{info.asked}&rdquo;
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1" style={XS}>
          <span className={cn('flex items-center gap-1', outcome.tone)} style={{ fontWeight: 'var(--font-weight-medium)' }}>
            <Icon className="size-3.5" /> {outcome.text}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3.5" /> {(info.ms / 1000).toFixed(1)} s
          </span>
        </p>
        {info.reason && (
          <p className="text-muted-foreground" style={XS}>
            {info.reason.replace(/_/g, ' ')}
          </p>
        )}
      </button>
      {t?.state === 'checking' && (
        <p className="flex items-center gap-1.5 text-muted-foreground" style={XS}>
          <Loader2 className="size-3 animate-spin" /> Checking which tools it used…
        </p>
      )}
      {t?.state === 'unknown' && hasTools && (
        <p className="text-muted-foreground" style={XS}>
          Couldn&rsquo;t check which tools it used.
        </p>
      )}
      {t?.state === 'done' &&
        (t.calls.length ? (
          <div className="space-y-1">
            {t.calls.map((c, i) => (
              <Call key={i} call={c} onOpenConnections={onOpenConnections} />
            ))}
          </div>
        ) : (
          hasTools && (
            <p className="text-muted-foreground" style={XS}>
              No tools used. If it should have, make that tool&rsquo;s &ldquo;When should the agent use it?&rdquo; more specific.
            </p>
          )
        ))}
    </li>
  )
}

function Call({ call: c, onOpenConnections }: { call: ToolCall; onOpenConnections: () => void }) {
  const [open, setOpen] = useState(false)
  const ok = c.status === 'SUCCESS'
  const details = !!(c.input || c.output)
  return (
    <div className={cn('rounded-md border', ok ? 'border-border' : 'border-destructive/40 bg-destructive/5')}>
      <button
        type="button"
        onClick={() => details && setOpen((o) => !o)}
        aria-expanded={details ? open : undefined}
        className={cn('flex w-full items-center gap-1.5 px-2 py-1.5 text-left', !details && 'cursor-default')}
        style={XS}
      >
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">
          <span className="font-mono">{c.tool}</span>
          {c.connector && <span className="text-muted-foreground"> · {c.connector}</span>}
        </span>
        {ok ? <CheckCircle2 className="size-3 shrink-0 text-success" /> : <XCircle className="size-3 shrink-0 text-destructive" />}
        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
          {ok ? '' : c.status === 'TIMEOUT' ? 'timed out ' : 'failed '}
          {c.ms !== undefined ? `${(c.ms / 1000).toFixed(1)} s` : ''}
        </span>
        {details && <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          {c.input && <Block label="Sent to the system" text={readable(c.input)} />}
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
      <pre className="max-h-48 min-w-0 overflow-auto rounded bg-muted/60 p-1.5 break-all whitespace-pre-wrap" style={{ fontSize: 11, lineHeight: 1.5 }}>
        {text}
      </pre>
    </div>
  )
}
