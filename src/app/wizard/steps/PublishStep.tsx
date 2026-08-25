import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Play, Plus, Rocket, Square, X } from 'lucide-react'
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
import { useExitWizard } from '@/app/wizard/ExitContext'

const E164_RE = /^\+[1-9]\d{6,14}$/

// This page publishes an agent on one specific WhatsApp phone number, not a WABA account — a
// WABA can hold several numbers, and this page (and the agent it activates) belongs to exactly
// one. Nothing here should ever talk about "the WABA" going live.

export function PublishStep() {
  const { state, patch } = useWizard()
  const { publish } = state
  const exitWizard = useExitWizard()

  // ---- Who can talk to your agent ----
  const [numberDraft, setNumberDraft] = useState('')
  const [numberError, setNumberError] = useState<string | null>(null)

  function addAllowlistNumber() {
    const value = numberDraft.trim()
    if (!E164_RE.test(value)) {
      setNumberError("This doesn't look like a valid number")
      return
    }
    setNumberDraft('')
    setNumberError(null)
    if (publish.allowlistNumbers.includes(value)) return
    patch('publish', { allowlistNumbers: [...publish.allowlistNumbers, value] })
    toast.success('Saved')
  }

  function removeAllowlistNumber(value: string) {
    patch('publish', { allowlistNumbers: publish.allowlistNumbers.filter((n) => n !== value) })
    toast.success('Saved')
  }

  function setAudienceMode(mode: 'allowlisted' | 'everyone') {
    patch('publish', { audienceMode: mode })
    toast.success('Saved')
  }

  // ---- Activate on channels ----
  // Always enabled — no standard-checks precondition. Nothing in Meta's platform ever required
  // one; that was a Helo-invented safety rail, removed on direct instruction.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activateFailed, setActivateFailed] = useState(false)

  function confirmActivate() {
    setConfirmOpen(false)
    if (state.demo.forceNextFailure) {
      patch('demo', { forceNextFailure: false })
      setActivateFailed(true)
      return
    }
    setActivateFailed(false)
    patch('publish', { activated: true, activatedChannels: ['WhatsApp'], stopped: false })
  }

  // ---- Stop / resume ----
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false)

  function confirmStop() {
    setStopConfirmOpen(false)
    patch('publish', { activated: false, stopped: true })
    toast.success('Agent stopped')
  }

  function resumeAgent() {
    patch('publish', { activated: true, stopped: false })
    toast.success('Agent is live again')
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

  return (
    <div className="space-y-10">
      {/* Who can talk to your agent */}
      <section className="space-y-3">
        <h3>Who can talk to your agent</h3>

        <div className="grid gap-2 sm:grid-cols-2">
          <SelectableCard
            title="Only the numbers I list below"
            helper="Recommended for testing"
            info="Add the WhatsApp numbers you want to test with below. Only those numbers can reach your agent until you switch this to Everyone."
            selected={publish.audienceMode === 'allowlisted'}
            onClick={() => setAudienceMode('allowlisted')}
          />
          <SelectableCard
            title="Everyone"
            info="Opens your agent to any customer who messages this number. Best once you've tested with a smaller group first."
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
                    if (e.key === 'Enter') addAllowlistNumber()
                  }}
                  placeholder="+15551234567"
                />
                {numberError && (
                  <p className="mt-1 text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
                    {numberError}
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={addAllowlistNumber}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>
            {publish.allowlistNumbers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {publish.allowlistNumbers.map((n) => (
                  <span key={n} className="badge flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-accent-foreground">
                    {n}
                    <button type="button" onClick={() => removeAllowlistNumber(n)} aria-label={`Remove ${n}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            Any customer who messages this number will reach your agent immediately once you
            activate.
          </p>
        )}
      </section>

      {/* Activate on channels */}
      <section className="space-y-4">
        {publish.stopped ? (
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <span className="flex items-center gap-3">
              <Square className="size-5 text-destructive" />
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>This agent is stopped.</p>
            </span>
            <Button size="sm" onClick={resumeAgent}>
              <Play className="size-3.5" />
              Resume
            </Button>
          </div>
        ) : publish.activated ? (
          <div className="flex items-center justify-between rounded-lg border border-success bg-success/10 p-4">
            <span className="flex items-center gap-3">
              <CheckCircle2 className="size-5 text-success" />
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Your agent is live.</p>
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setStopConfirmOpen(true)}>
                <Square className="size-3.5" />
                Stop agent
              </Button>
              <Button variant="outline" size="sm" onClick={exitWizard}>
                Back to agents list
              </Button>
            </div>
          </div>
        ) : activateFailed ? (
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>Couldn&rsquo;t activate</p>
            </span>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              Something went wrong switching this agent on. Nothing has changed.
            </p>
            <Button size="sm" onClick={confirmActivate}>
              Try again
            </Button>
          </div>
        ) : (
          <Button size="lg" onClick={() => setConfirmOpen(true)}>
            <Rocket className="size-4" />
            Activate on channels
          </Button>
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ready to go live?</DialogTitle>
            <DialogDescription>
              Once activated, your agent becomes the main responder for {audiencePhrase}. Meta charges for every
              message it sends. This is not a test anymore.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Go back
            </Button>
            <Button onClick={confirmActivate}>Yes, activate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={stopConfirmOpen}
        title="Stop this agent?"
        description="Customers messaging this number will no longer reach your agent until you resume."
        confirmLabel="Stop agent"
        onConfirm={confirmStop}
        onCancel={() => setStopConfirmOpen(false)}
      />
    </div>
  )
}
