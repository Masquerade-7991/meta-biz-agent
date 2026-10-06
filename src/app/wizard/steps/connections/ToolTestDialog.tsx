import { useState } from 'react'
import { CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/app/components/ui/dialog'
import { agentFills, previewRequest, runInput } from '@/app/wizard/toolRequest'
import type { ToolRunResult } from '@/app/wizard/toolRun'
import type { Connection, ConnectionAction } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { Field, PlaceBadge, RequestPreviewBlock } from './parts'


const XS = { fontSize: 'var(--text-xs)' } as const
const SM = { fontSize: 'var(--text-sm)' } as const

export type TestOutcome = ({ kind: 'done' } & ToolRunResult & { ms: number }) | { kind: 'error'; message: string }

/** Plain words for the system's HTTP status, with the likely fix. */
function explain(status: number | undefined, system: string): string | null {
  if (status === undefined) return null
  if (status === 401 || status === 403) return `${system} refused the key (${status}). Replace the key, or check it has permission for this.`
  if (status === 404) return `${system} found nothing at this address (404). Check the base address and the path.`
  if (status === 400 || status === 422) return `${system} said the request is wrong (${status}). Check the values: names and where each one goes.`
  if (status === 429) return `${system} is limiting requests (429). Try again in a moment.`
  if (status >= 500) return `${system} had an error (${status}). Try again; if it keeps happening, it’s on their side.`
  if (status >= 300) return `${system} answered ${status}.`
  return null
}

/** Run one tool live on Meta with the connection's saved key, with typed inputs for the values the agent fills. */
export function ToolTestDialog({
  tool,
  connection,
  onRun,
  onReplaceKey,
  onClose,
}: {
  tool: ConnectionAction
  connection: Connection
  onRun: (tool: ConnectionAction, input: Record<string, unknown>) => Promise<TestOutcome>
  onReplaceKey: () => void
  onClose: () => void
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestOutcome | null>(null)
  const [showFull, setShowFull] = useState(false)

  const asked = tool.values.filter(agentFills)
  const { input, errors } = runInput(tool, inputs)
  const preview = previewRequest(connection.baseUrl, connection.authMethod === 'api_key' ? (connection.apiKeys ?? []) : [], tool, inputs)

  async function run() {
    setTouched(true)
    if (Object.keys(errors).length) return
    setRunning(true)
    setResult(null)
    setShowFull(false)
    setResult(await onRun(tool, input))
    setRunning(false)
  }

  const failure = result?.kind === 'done' && !result.ok ? (explain(result.httpStatus, connection.name) ?? result.body) : null
  const keyProblem = result?.kind === 'done' && !result.ok && (result.httpStatus === 401 || result.httpStatus === 403)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        <div className="space-y-1 border-b border-border px-6 pt-5 pb-4 pr-12">
          <DialogTitle>
            Test <span className="font-mono">{tool.name}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">Runs the real request through Meta with your saved key. It doesn&rsquo;t message any customer.</DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {asked.length > 0 && (
            <div className="space-y-3">
              <p style={{ ...SM, fontWeight: 'var(--font-weight-semi-bold)' }}>Values the agent would fill in</p>
              {asked.map((v) => (
                <Field
                  key={v.id}
                  htmlFor={`test-${v.id}`}
                  label={
                    <span className="flex items-center gap-2">
                      <PlaceBadge place={v.location} />
                      <span className="font-mono">{v.name}</span>
                      {(v.required || v.location === 'path') && <span className="text-muted-foreground">required</span>}
                    </span>
                  }
                  help={v.description || undefined}
                  error={touched ? errors[v.id] : null}
                >
                  <Input
                    id={`test-${v.id}`}
                    value={inputs[v.id] ?? ''}
                    onChange={(e) => setInputs((p) => ({ ...p, [v.id]: e.target.value }))}
                    placeholder={v.type === 'boolean' ? 'yes or no' : v.type === 'text' ? '' : 'a number'}
                    inputMode={v.type === 'integer' || v.type === 'number' ? 'decimal' : undefined}
                    className="font-mono"
                  />
                </Field>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <p style={{ ...SM, fontWeight: 'var(--font-weight-semi-bold)' }}>What it sends</p>
            <RequestPreviewBlock preview={preview} />
          </div>

          {result && (
            <div className="space-y-2" aria-live="polite">
              {result.kind === 'error' ? (
                <Banner ok={false} title="Couldn’t run the test" detail={result.message} />
              ) : (
                <>
                  <Banner
                    ok={result.ok}
                    title={result.ok ? `It worked${result.httpStatus ? ` · ${result.httpStatus}` : ''} · ${(result.ms / 1000).toFixed(1)} s` : 'It didn’t work'}
                    detail={result.ok ? `${connection.name} answered. This is what your agent would see:` : failure}
                    action={keyProblem ? { label: 'Replace key', onClick: onReplaceKey } : undefined}
                  />
                  {result.ok && (
                    <pre className="max-h-72 min-w-0 overflow-auto rounded-lg border border-border bg-muted/50 p-3 break-all whitespace-pre-wrap" style={{ ...XS, lineHeight: 1.6 }}>
                      {result.body}
                    </pre>
                  )}
                  <button type="button" onClick={() => setShowFull((s) => !s)} aria-expanded={showFull} className="flex items-center gap-1 text-primary hover:underline text-xs">
                    <ChevronRight className={cn('size-3.5 transition-transform', showFull && 'rotate-90')} /> Full response from Meta
                  </button>
                  {showFull && (
                    <pre className="max-h-72 min-w-0 overflow-auto rounded-lg border border-border bg-muted/50 p-3 break-all whitespace-pre-wrap" style={{ ...XS, lineHeight: 1.6 }}>
                      {result.full}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void run()} disabled={running}>
            {running && <Loader2 className="size-3.5 animate-spin" />}
            {result ? 'Run again' : 'Run test'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Banner({ ok, title, detail, action }: { ok: boolean; title: string; detail?: string | null; action?: { label: string; onClick: () => void } }) {
  const Icon = ok ? CheckCircle2 : XCircle
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg px-3 py-2.5', ok ? 'bg-success/10' : 'bg-destructive/10')}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', ok ? 'text-success' : 'text-destructive')} />
      <div className="min-w-0 space-y-0.5">
        <p style={{ ...SM, fontWeight: 'var(--font-weight-semi-bold)' }}>{title}</p>
        {detail && (
          <p className="break-words text-muted-foreground text-xs">
            {detail}
          </p>
        )}
        {action && (
          <button type="button" onClick={action.onClick} className="text-primary hover:underline text-xs">
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
