import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpRight, Check, Copy, Loader2, RotateCw, Smartphone, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { isDummyMode } from '@/app/api/dummy'
import { errorDetail } from '@/app/api/meta'
import { connectAccount, PAYMENT_URL, retryAccount, setBilling, STEP_LABEL, type Billing, type Flow, type SignupConfig, type StepName, type WaAccount } from '@/app/api/whatsapp'
import { startSignup } from './embeddedSignup'
import { TEXT_SM, TEXT_SM_OPEN, TEXT_XS } from '@/app/lib/text'
import { cn } from '@/app/lib/utils'

const ORDER: StepName[] = ['exchange', 'subscribe', 'register', 'sync', 'details', 'billing']

/** What each setup step did, with Retry for any that failed and the billing action if it's waiting. */
export function AccountSteps({ account, canEdit, onChange }: { account: WaAccount; canEdit: boolean; onChange: (a: WaAccount) => void }) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<WaAccount>) => {
    setBusy(true)
    try {
      onChange(await fn())
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  const failed = ORDER.some((s) => s !== 'billing' && account.steps[s]?.state === 'failed')
  const ownBillingPending = account.billing.mode === 'own' && account.billing.state !== 'confirmed'
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5" style={TEXT_SM}>
        {ORDER.filter((s) => account.steps[s] && account.steps[s]!.state !== 'skipped').map((s) => {
          const st = account.steps[s]!
          const waitingOnBusiness = s === 'billing' && ownBillingPending
          return (
            <li key={s} className="flex items-start gap-2">
              {st.state === 'done' ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
              ) : waitingOnBusiness ? (
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <span>
                {s === 'billing' ? (account.billing.mode === 'partner_credit' ? 'Billing through Helo.ai' : 'Your own payment method in Meta') : STEP_LABEL[s]}
                {st.state === 'failed' && !waitingOnBusiness && st.error && (
                  <span className="block text-destructive" style={TEXT_XS}>
                    {st.error}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {canEdit && (failed || (account.billing.mode === 'partner_credit' && account.steps.billing?.state === 'failed')) && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => retryAccount(account.wabaId))}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          Retry the failed steps
        </Button>
      )}
      {canEdit && ownBillingPending && (
        <div className="space-y-2 rounded-md bg-muted px-3 py-2.5" style={TEXT_SM}>
          <p>Conversations are billed by Meta to this business. Add a payment method in WhatsApp Manager so the number can message customers.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href={PAYMENT_URL} target="_blank" rel="noreferrer">
                Add a payment method <ArrowUpRight className="size-3.5" />
              </a>
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void run(() => setBilling(account.wabaId, { mode: 'own', confirmed: true }))}>
              I&rsquo;ve added it
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Dummy mode: a stand-in for Meta's popup, so the journey can be shown without Meta keys. */
function SimulatedSignup({ flow, onDone, onClose }: { flow: Flow; onDone: (ids: { wabaId: string; phoneNumberId: string; businessId: string }) => void; onClose: () => void }) {
  const screens =
    flow === 'coexistence'
      ? ['Continue as Asha Rao', 'Choose your business: Asha Foods', 'Scan the QR code in your WhatsApp Business app', 'Share your chat history and contacts']
      : ['Continue as Asha Rao', 'Choose your business: Asha Foods', 'Create a WhatsApp account and display name', 'Add +91 90000 12345 and enter the SMS code']
  const [i, setI] = useState(0)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Facebook (demo)</DialogTitle>
          <DialogDescription>A simulated Meta signup. With Meta keys on the server, Facebook&rsquo;s real window opens here.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-2" style={TEXT_SM}>
          {screens.map((s, j) => (
            <li key={s} className={cn('flex items-center gap-2', j > i && 'text-muted-foreground')}>
              {j < i ? <Check className="size-4 text-success" /> : <span className="flex size-4 items-center justify-center rounded-full border border-border" style={{ fontSize: 10 }}>{j + 1}</span>}
              {s}
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => (i < screens.length - 1 ? setI(i + 1) : onDone({ wabaId: `99${Date.now()}`.slice(0, 15), phoneNumberId: `98${Date.now()}`.slice(0, 15), businessId: '990000000000003' }))}>
            {i < screens.length - 1 ? 'Next' : 'Finish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Connects a WhatsApp Business number with Meta's Embedded Signup: a new number, or one already on
 * the WhatsApp Business app (it keeps working). `hero` is Home's big first step; `compact` sits in Settings.
 */
export function ConnectWhatsApp({ config, isOwner, workspaceName, variant, onConnected }: { config: SignupConfig | null; isOwner: boolean; workspaceName: string; variant: 'hero' | 'compact'; onConnected: (a: WaAccount) => void }) {
  // Until the user picks, follow the server: Helo.ai's credit line when it has one (config loads after mount).
  const [picked, setBillingChoice] = useState<Billing | null>(null)
  const billing: Billing = picked ?? (config?.partnerCredit || isDummyMode() ? 'partner_credit' : 'own')
  const [phase, setPhase] = useState<'idle' | 'meta' | 'finishing'>('idle')
  const [flow, setFlow] = useState<Flow>('new')
  const [simulating, setSimulating] = useState<Flow | null>(null)
  const [result, setResult] = useState<{ account: WaAccount; pin?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function finish(ids: { wabaId: string; phoneNumberId: string; businessId: string; code: string }, f: Flow) {
    setPhase('finishing')
    try {
      // The parent hears about it when the result dialog closes: Home hides this component once a
      // number is connected, which would otherwise take the dialog (and the PIN) with it.
      setResult(await connectAccount({ ...ids, flow: f, billing }))
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setPhase('idle')
    }
  }
  async function start(f: Flow) {
    setError(null)
    setFlow(f)
    if (isDummyMode()) return setSimulating(f)
    if (!config?.ready || !config.appId || !config.configId) return
    setPhase('meta')
    try {
      const r = await startSignup({ appId: config.appId, configId: config.configId, sdkVersion: config.sdkVersion }, f)
      await finish(r, r.flow)
    } catch (err) {
      setError(errorDetail(err))
      setPhase('idle')
    }
  }

  if (!isOwner)
    return (
      <p className="rounded-md bg-muted px-3 py-2.5 text-muted-foreground" style={TEXT_SM_OPEN}>
        Ask an owner of {workspaceName} to connect a WhatsApp number. Only owners can connect accounts.
      </p>
    )
  const ready = isDummyMode() || !!config?.ready
  const hero = variant === 'hero'
  return (
    <div className="space-y-5">
      {!ready ? (
        <div className="space-y-2 rounded-md bg-muted px-3 py-2.5" style={TEXT_SM_OPEN}>
          <p>Connecting WhatsApp from the console isn&rsquo;t switched on for this server yet. Helo.ai can connect your number for you meanwhile.</p>
          <Button size="sm" variant="outline" asChild>
            <a href="https://helo.ai/contact-us" target="_blank" rel="noreferrer">
              Talk to Helo.ai <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        </div>
      ) : (
        <>
          <div className={cn('grid gap-3', hero && 'sm:grid-cols-2')}>
            {(
              [
                ['new', 'Connect a new number', 'A number that isn’t on WhatsApp yet. You’ll verify it by SMS or call.'],
                ['coexistence', 'I use the WhatsApp Business app', 'Keep using the app on your phone. Your last 6 months of chats and your contacts come along.'],
              ] as const
            ).map(([f, label, hint]) => (
              <div key={f} className="space-y-1.5">
                <Button className="h-auto min-h-10 w-full py-2 whitespace-normal" variant={f === 'new' ? 'default' : 'outline'} size={hero ? 'lg' : 'default'} disabled={phase !== 'idle'} onClick={() => void start(f)}>
                  {phase !== 'idle' && flow === f ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                  {phase === 'meta' && flow === f ? 'Waiting for Facebook…' : phase === 'finishing' && flow === f ? 'Finishing setup…' : label}
                </Button>
                <p className="text-muted-foreground" style={TEXT_XS}>
                  {hint}
                </p>
              </div>
            ))}
          </div>
          {config?.partnerCredit || isDummyMode() ? (
            <fieldset className="space-y-2">
              <legend className="mb-1" style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-medium)' }}>
                Who pays Meta for conversations
              </legend>
              <RadioGroup value={billing} onValueChange={(v) => setBillingChoice(v as Billing)} className="gap-2">
                <label className="flex items-start gap-2.5" style={TEXT_SM}>
                  <RadioGroupItem value="partner_credit" className="mt-0.5" />
                  <span>
                    Through Helo.ai
                    <span className="block text-muted-foreground" style={TEXT_XS}>
                      Helo.ai pays Meta and includes it in your Helo.ai invoice. Nothing to set up.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5" style={TEXT_SM}>
                  <RadioGroupItem value="own" className="mt-0.5" />
                  <span>
                    I&rsquo;ll pay Meta myself
                    <span className="block text-muted-foreground" style={TEXT_XS}>
                      After connecting, you add a payment method in WhatsApp Manager.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </fieldset>
          ) : (
            <p className="text-muted-foreground" style={TEXT_XS}>
              After connecting, you&rsquo;ll add a payment method in WhatsApp Manager so Meta can bill your conversations.
            </p>
          )}
          {hero && (
            <div className="rounded-md bg-muted/60 px-3 py-2.5" style={TEXT_SM_OPEN}>
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>You&rsquo;ll need</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>A Facebook login with admin access to your business on Meta (you can create the business during signup)</li>
                <li>A phone number that can get an SMS or call, or your phone with the WhatsApp Business app</li>
                <li>Your business name, website and a display name customers will see</li>
              </ul>
              <p className="mt-1 text-muted-foreground" style={TEXT_XS}>
                It takes about 5 minutes in a Facebook window. Allow pop-ups for this site.
              </p>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive" style={TEXT_SM}>
          {error}
        </p>
      )}
      {simulating && (
        <SimulatedSignup
          flow={simulating}
          onClose={() => setSimulating(null)}
          onDone={(ids) => {
            const f = simulating
            setSimulating(null)
            void finish({ ...ids, code: 'demo' }, f)
          }}
        />
      )}
      {result && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (o) return
            onConnected(result.account)
            setResult(null)
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{result.account.needsAttention ? 'Almost there' : 'WhatsApp connected'}</DialogTitle>
              <DialogDescription>
                {result.account.phoneNumbers[0]?.verifiedName || result.account.wabaName} &middot; {result.account.phoneNumbers[0]?.display}
              </DialogDescription>
            </DialogHeader>
            <AccountSteps
              account={result.account}
              canEdit
              onChange={(a) => setResult({ ...result, account: a })}
            />
            {result.pin && (
              <div className="space-y-1 rounded-md border border-border px-3 py-2.5" style={TEXT_SM}>
                <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Your number&rsquo;s two-step PIN</p>
                <p className="flex items-center gap-2">
                  <span className="font-mono tracking-widest" style={{ fontSize: '1.25rem' }}>
                    {result.pin}
                  </span>
                  <Button size="sm" variant="ghost" aria-label="Copy PIN" onClick={() => void navigator.clipboard?.writeText(result.pin!).then(() => toast.success('PIN copied.'))}>
                    <Copy className="size-4" />
                  </Button>
                </p>
                <p className="text-muted-foreground" style={TEXT_XS}>
                  Keep it safe: Meta asks for it if the number is ever moved. Owners can see it again in Settings → WhatsApp.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button
                onClick={() => {
                  onConnected(result.account)
                  setResult(null)
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
