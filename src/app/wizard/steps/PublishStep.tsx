import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Plus, Rocket, ShieldQuestion, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Label } from '@/app/components/ui/label'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { SelectableCard } from '@/app/components/wizard/SelectableCard'
import { Switch } from '@/app/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useExitWizard } from '@/app/wizard/ExitContext'

const E164_RE = /^\+[1-9]\d{6,14}$/
const VERSION_NOTE_MAX = 300

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

  // ---- Publish ----
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [activateError, setActivateError] = useState<string | null>(null)

  const canActivate = publish.standardChecksRun
  const activateReason = !canActivate ? 'Run the standard checks to continue' : null

  const activateLabel = publish.approverRequired ? 'Submit for approval' : 'Activate on channels'

  function confirmActivate() {
    setConfirmOpen(false)
    if (state.demo.forceNextFailure) {
      patch('demo', { forceNextFailure: false })
      setActivateError('Could not save. Nothing was lost.')
      return
    }
    setActivateError(null)
    if (publish.approverRequired) {
      patch('publish', { pendingApproval: true })
    } else {
      patch('publish', { activated: true, activatedChannels: ['WhatsApp'] })
    }
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
        <div>
          <span className="flex items-center gap-1.5">
            <h3>Who can talk to your agent</h3>
            <InfoTooltip text="Start with a small group while you’re confident it’s ready, then open it up." />
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <SelectableCard
            title="Only the numbers I list below"
            helper="Recommended for testing"
            selected={publish.audienceMode === 'allowlisted'}
            onClick={() => setAudienceMode('allowlisted')}
          />
          <SelectableCard
            title="Everyone"
            info="Any customer who messages this number will reach your agent immediately once you activate."
            selected={publish.audienceMode === 'everyone'}
            onClick={() => setAudienceMode('everyone')}
          />
        </div>

        {publish.audienceMode === 'allowlisted' && (
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
        )}
      </section>

      {/* Publish */}
      <section className="space-y-4">
        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="version-note">What changed in this version?</Label>
            <InfoTooltip text="For your own records. This is not sent to Meta." />
          </span>
          <Textarea
            id="version-note"
            rows={2}
            maxLength={VERSION_NOTE_MAX}
            value={publish.versionNote}
            onChange={(e) => patch('publish', { versionNote: e.target.value })}
            placeholder="e.g. Added a connection to Shopify, updated the tone"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <ShieldQuestion className="size-4 text-muted-foreground" />
            <span className="flex items-center gap-1.5">
              <Label htmlFor="approval-toggle">Requires approval before going live</Label>
              <InfoTooltip text="Someone else on your team must approve before this agent can go live." />
            </span>
          </div>
          <Switch
            id="approval-toggle"
            checked={publish.approverRequired}
            onCheckedChange={(checked) => patch('publish', { approverRequired: checked })}
          />
        </div>

        {publish.activated ? (
          <div className="flex items-center justify-between rounded-lg border border-success bg-success/10 p-4">
            <span className="flex items-center gap-3">
              <CheckCircle2 className="size-5 text-success" />
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Your agent is live.</p>
            </span>
            <Button variant="outline" size="sm" onClick={exitWizard}>
              Back to agents list
            </Button>
          </div>
        ) : publish.pendingApproval ? (
          <div className="rounded-lg border border-border bg-muted p-4">
            <p style={{ fontWeight: 'var(--font-weight-medium)' }}>
              Sent for approval. You&rsquo;ll be notified once it&rsquo;s reviewed.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <Button size="lg" disabled={!canActivate} onClick={() => setConfirmOpen(true)}>
                <Rocket className="size-4" />
                {activateLabel}
              </Button>
              {activateReason && (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  {activateReason}
                </p>
              )}
            </div>
            {activateError && (
              <p className="text-destructive" style={{ fontSize: 'var(--text-sm)' }}>
                {activateError}
              </p>
            )}
          </div>
        )}
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          {publish.approverRequired ? (
            <>
              <DialogHeader>
                <DialogTitle>Send for approval?</DialogTitle>
                <DialogDescription>
                  This will notify your team that this agent is ready for review. It will not go live until approved.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                  Go back
                </Button>
                <Button onClick={confirmActivate}>Send for approval</Button>
              </DialogFooter>
            </>
          ) : (
            <>
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
