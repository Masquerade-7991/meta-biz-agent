import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, CircleDashed, Pause, Play, Plus, Rocket, X } from 'lucide-react'
import { Card } from '@/app/components/ui/card'
import { readiness } from '@/app/wizard/readiness'
import { cn } from '@/app/lib/utils'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { SelectableCard } from '@/app/components/wizard/SelectableCard'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { addAllowlistNumber, removeAllowlistNumber, setRollout } from '@/app/api/meta'

const E164_RE = /^\+[1-9]\d{6,14}$/
const MAX_ALLOWLIST = 20

// This page publishes an agent on one specific WhatsApp phone number, not a WABA account — a
// WABA can hold several numbers, and this page (and the agent it activates) belongs to exactly
// one. Nothing here should ever talk about "the WABA" going live.

export function PublishStep() {
  const { state, patch, setSection } = useWizard()
  const { publish } = state

  // Every change here goes to Meta first (settings: rollout + ai_audience; allowlist entries) and
  // only lands in the UI once Meta accepts it, so the screen never shows a state Meta doesn't have.
  async function pushPublish(changes: Partial<typeof publish>, okMessage: string, call?: () => Promise<unknown>): Promise<boolean> {
    const next = { ...publish, ...changes }
    try {
      await (call ? call() : setRollout(next.activated, next.audienceMode))
    } catch (err) {
      toast.error("Couldn't save to Meta", { description: err instanceof Error ? err.message : String(err) })
      return false
    }
    patch('publish', changes)
    toast.success(okMessage)
    return true
  }

  // ---- Who can talk to your agent ----
  const [numberDraft, setNumberDraft] = useState('')
  const [numberError, setNumberError] = useState<string | null>(null)

  function addNumber() {
    const value = numberDraft.trim()
    if (!E164_RE.test(value)) {
      setNumberError("This doesn't look like a valid number")
      return
    }
    setNumberDraft('')
    setNumberError(null)
    if (publish.allowlistNumbers.includes(value)) return
    // PRD V1b: Meta caps the allowlist at 20; reject before calling.
    if (publish.allowlistNumbers.length >= MAX_ALLOWLIST) return
    // Live the moment it's added (PRD AC3a); independent of Publish.
    void pushPublish({ allowlistNumbers: [...publish.allowlistNumbers, value] }, 'Saved', () => addAllowlistNumber(value))
  }

  function removeNumber(value: string) {
    void pushPublish({ allowlistNumbers: publish.allowlistNumbers.filter((n) => n !== value) }, 'Saved', () => removeAllowlistNumber(value))
  }

  function setAudienceMode(mode: 'allowlisted' | 'everyone') {
    void pushPublish({ audienceMode: mode }, 'Saved')
  }

  // ---- Activate on channels ----
  // Always enabled — no standard-checks precondition. Nothing in Meta's platform ever required
  // one; that was a Helo-invented safety rail, removed on direct instruction.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activateFailed, setActivateFailed] = useState(false)

  async function confirmActivate() {
    setConfirmOpen(false)
    if (state.demo.forceNextFailure) {
      patch('demo', { forceNextFailure: false })
      setActivateFailed(true)
      return
    }
    const ok = await pushPublish({ activated: true, activatedChannels: ['WhatsApp'], stopped: false }, 'Agent activated')
    setActivateFailed(!ok)
  }

  // ---- Stop / resume ----
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)

  function confirmStop() {
    setStopConfirmOpen(false)
    void pushPublish({ activated: false, stopped: true }, 'Agent stopped')
  }

  function resumeAgent() {
    void pushPublish({ activated: true, stopped: false }, 'Agent is live again')
  }

  useRegisterDevControls(
    'publish',
    <DemoControlsGroup label="Publish">
      <Button variant="outline" size="sm" onClick={() => patch('demo', { forceNextFailure: !state.demo.forceNextFailure })}>
        {state.demo.forceNextFailure ? 'Demo: force save failure (armed)' : 'Demo: force save failure'}
      </Button>
    </DemoControlsGroup>,
  )

  const audiencePhrase = publish.audienceMode === 'everyone' ? 'everyone who messages this number' : 'the numbers on your allowlist'

  const checks = readiness(state).filter((i) => i.id !== 'live' && i.id !== 'number')
  const notReady = checks.filter((i) => !i.done)

  return (
    <div className="space-y-6">
      <Card className="gap-4 px-5">
        <div>
          <h2 className="text-section font-semibold">Who your agent answers</h2>
          <p className="text-muted-foreground">Start with a few test numbers, then open it to everyone.</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <SelectableCard
            title="Only my test numbers"
            helper="Recommended while you try it"
            info="Only the WhatsApp numbers you add below can reach your agent until you switch this to Everyone."
            selected={publish.audienceMode === 'allowlisted'}
            onClick={() => setAudienceMode('allowlisted')}
          />
          <SelectableCard
            title="Everyone"
            info="Any customer who messages this number reaches your agent. Best once you've tested with a few numbers."
            selected={publish.audienceMode === 'everyone'}
            onClick={() => setAudienceMode('everyone')}
          />
        </div>

        {publish.audienceMode === 'allowlisted' ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  value={numberDraft}
                  onChange={(e) => {
                    setNumberDraft(e.target.value)
                    setNumberError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addNumber()
                  }}
                  placeholder="+15551234567"
                  aria-label="Test number with country code"
                />
                {numberError && <p className="mt-1 text-xs text-destructive">{numberError}</p>}
              </div>
              <Button variant="outline" onClick={addNumber} disabled={publish.allowlistNumbers.length >= MAX_ALLOWLIST}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {publish.allowlistNumbers.length >= MAX_ALLOWLIST
                ? 'You’ve reached the limit of 20 numbers. Remove one to add another.'
                : 'These numbers can chat with your agent as soon as they’re added, even before it goes live.'}
            </p>
            {publish.allowlistNumbers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {publish.allowlistNumbers.map((n) => (
                  <span key={n} className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs">
                    {n}
                    <button type="button" onClick={() => removeNumber(n)} aria-label={`Remove ${n}`} className="text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Any customer who messages this number reaches your agent as soon as it&rsquo;s live.</p>
        )}
      </Card>

      <Card className="gap-4 px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-section font-semibold">Go live</h2>
            <p className="text-muted-foreground">
              {publish.stopped
                ? 'Paused: customers get no AI replies until you resume it.'
                : publish.activated
                  ? `Live for ${audiencePhrase}.`
                  : 'Switch your agent on when the checks below look right.'}
            </p>
          </div>
          {publish.stopped ? (
            <Button onClick={resumeAgent}>
              <Play className="size-4" />
              Resume
            </Button>
          ) : publish.activated ? (
            <Button variant="outline" onClick={() => setStopConfirmOpen(true)}>
              <Pause className="size-4" />
              Pause agent
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)}>
              <Rocket className="size-4" />
              Go live
            </Button>
          )}
        </div>

        {!publish.activated && !publish.stopped && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {checks.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setSection(c.section)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60">
                  {c.done ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <CircleDashed className="size-4 shrink-0 text-muted-foreground" />}
                  <span className={cn('flex-1 text-sm', c.done && 'text-muted-foreground')}>{c.label}</span>
                  {c.detail && <span className="text-xs text-muted-foreground">{c.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {activateFailed && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3">
            <AlertTriangle className="size-4 text-destructive" />
            <p className="flex-1 text-sm">Couldn&rsquo;t switch your agent on. Nothing has changed.</p>
            <Button size="sm" variant="outline" onClick={confirmActivate}>
              Try again
            </Button>
          </div>
        )}
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ready to go live?</DialogTitle>
            <DialogDescription>
              Your agent becomes the main responder for {audiencePhrase}. Meta charges for each message it sends.
              {notReady.length > 0 && ` Still to do: ${notReady.map((c) => c.label.toLowerCase()).join(', ')}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Go back
            </Button>
            <Button onClick={confirmActivate}>Go live</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={stopConfirmOpen}
        title="Pause this agent?"
        description="Customers messaging this number get no AI replies until you resume it. Your team still sees their messages."
        confirmLabel="Pause agent"
        onConfirm={confirmStop}
        onCancel={() => setStopConfirmOpen(false)}
      />
    </div>
  )
}
