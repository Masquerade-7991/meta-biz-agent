import { AlertTriangle, MessageSquare, Wrench } from 'lucide-react'
import { useWizard } from '@/app/wizard/WizardContext'
import { CONNECTION_STATUS_META } from '@/app/wizard/mockData'

const XS = { fontSize: 'var(--text-xs)' } as const

/**
 * Above the Test & Eval chat: the tools the agent can call, whether each can run, and one-tap
 * example questions (set on each tool) to try them in a real conversation.
 */
export function TestToolsStrip({ onAsk, onManage, disabled }: { onAsk: (question: string) => void; onManage: () => void; disabled: boolean }) {
  const { state } = useWizard()
  const { connections, actions } = state.connections
  if (!actions.length) return null
  const rows = actions.map((t) => {
    const c = connections.find((x) => x.id === t.connectionId)
    const blocked = !c?.metaId || !t.metaId ? 'not saved' : c.demoStatus === 'working' || c.demoStatus === 'not_tested' ? null : CONNECTION_STATUS_META[c.demoStatus].label.toLowerCase()
    return { t, c, blocked }
  })
  const examples = rows.filter((r) => r.t.exampleQuestion && !r.blocked)
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>
          <Wrench className="size-4 text-muted-foreground" /> Tools your agent can use
        </p>
        <button type="button" onClick={onManage} className="text-primary hover:underline" style={XS}>
          Manage in Connections
        </button>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {rows.map(({ t, c, blocked }) => (
          <li key={t.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5" style={XS} title={c ? `${c.name} · ${t.method} ${t.path}` : undefined}>
            <span className={blocked ? 'size-1.5 rounded-full bg-warning' : 'size-1.5 rounded-full bg-success'} />
            <span className="font-mono">{t.name}</span>
            {blocked && (
              <span className="flex items-center gap-1 text-warning-foreground">
                <AlertTriangle className="size-3" /> won&rsquo;t run: {blocked}
              </span>
            )}
          </li>
        ))}
      </ul>
      {examples.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground" style={XS}>
            Try:
          </span>
          {examples.map(({ t }) => (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => onAsk(t.exampleQuestion!)}
              className="flex items-center gap-1 rounded-full border border-primary px-2.5 py-0.5 text-primary hover:bg-accent disabled:opacity-50"
              style={XS}
            >
              <MessageSquare className="size-3" /> {t.exampleQuestion}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground" style={XS}>
          Ask something only live data can answer, like &ldquo;how many are in stock right now?&rdquo;. Under each reply you&rsquo;ll see which tools the agent used. Add an example question to a tool to try it with one tap.
        </p>
      )}
    </section>
  )
}
