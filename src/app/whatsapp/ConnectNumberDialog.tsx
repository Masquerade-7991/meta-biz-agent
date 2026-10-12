import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpRight, CheckCircle2, Copy, ExternalLink, Loader2, Plus, ShieldAlert, Smartphone, Store } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { useAuth } from '@/app/auth/AuthContext'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { isDummyMode } from '@/app/api/dummy'
import { errorDetail } from '@/app/api/meta'
import { connectAccount, getSignupConfig, type Billing, type Flow, type SignupConfig, type WaAccount } from '@/app/api/whatsapp'
import { startSignup } from './embeddedSignup'
import { SignupWindow } from './SignupWindow'
import { AssetMap } from './AssetMap'
import { AccountSteps } from './AccountSteps'
import type { SignupAssets } from './signupLink'

type Phase =
  | { at: 'loading' }
  | { at: 'config-error'; message: string }
  | { at: 'choose' }
  /** Meta's window is open and this page follows it (the full signup, or the demo). */
  | { at: 'meta' }
  /** Meta's hosted signup opened in its own window, which Meta keeps apart from this page. */
  | { at: 'opened'; url: string }
  | { at: 'blocked'; url: string }
  | { at: 'finishing'; assets: SignupAssets }
  | { at: 'connected'; assets: SignupAssets; account: WaAccount; pin?: string }
  | { at: 'left'; message: string; title: string }
  | { at: 'no-number'; assets: SignupAssets }

const FLOWS: { id: Flow; icon: typeof Smartphone; title: string; body: string }[] = [
  { id: 'new', icon: Smartphone, title: 'A new number', body: 'A number not on WhatsApp yet. Meta checks it by SMS or call and registers it for the API.' },
  { id: 'coexistence', icon: Store, title: 'My WhatsApp Business app number', body: 'Keep using the app on your phone. Your contacts and recent chats sync here.' },
]

/** A window for Meta's page: a centred pop-up on a computer, a new tab on a phone. null = blocked. */
function openMetaWindow(url: string) {
  const w = 640
  const h = 760
  const phone = window.matchMedia?.('(max-width: 640px)').matches
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2)
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2)
  return window.open(url, 'helo-meta-signup', phone ? undefined : `popup,width=${w},height=${h},left=${left},top=${top}`)
}

/**
 * Connecting a WhatsApp number, the same from everywhere (Home, the WhatsApp page, Settings):
 * choose the kind of number, see what gets connected, open Meta's signup, then see the result.
 * How far it goes depends on the server (SignupConfig.mode): the full signup finishes the connection
 * here; Meta's hosted link opens Meta's real flow and Helo.ai completes it on its side.
 */
export function ConnectNumberDialog({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (o: boolean) => void; onConnected?: (a: WaAccount) => void }) {
  const { me } = useAuth()
  const workspace = me?.workspace?.name ?? 'this workspace'
  const demo = isDummyMode()
  const [config, setConfig] = useState<SignupConfig | null>(null)
  const [phase, setPhase] = useState<Phase>({ at: 'loading' })
  const [flow, setFlow] = useState<Flow>('new')
  const [picked, setPicked] = useState<Billing | null>(null)
  const billing: Billing = picked ?? (config?.partnerCredit ? 'partner_credit' : 'own')
  // A signup this dialog stopped waiting for (closed, or Cancel) must not come back later.
  const run = useRef(0)

  const load = () => {
    setPhase({ at: 'loading' })
    getSignupConfig().then(
      (c) => {
        setConfig(c)
        setPhase({ at: 'choose' })
      },
      (err) => setPhase({ at: 'config-error', message: errorDetail(err) }),
    )
  }
  useEffect(() => {
    if (!open) return
    run.current++
    setPicked(null)
    load()
  }, [open])

  const close = () => {
    if (phase.at === 'finishing') return // the server is connecting the account: its result (and PIN) must be seen
    if (phase.at === 'connected') onConnected?.(phase.account)
    run.current++
    onOpenChange(false)
  }

  async function finish(assets: SignupAssets & { code: string }, f: Flow) {
    if (!assets.phoneNumberId) return setPhase({ at: 'no-number', assets })
    setPhase({ at: 'finishing', assets })
    try {
      const r = await connectAccount({ code: assets.code, wabaId: assets.wabaId ?? '', phoneNumberId: assets.phoneNumberId, businessId: assets.businessId ?? '', flow: f, billing })
      setPhase({ at: 'connected', assets, account: r.account, pin: r.pin })
    } catch (err) {
      setPhase({ at: 'left', title: 'Couldn’t finish connecting', message: errorDetail(err) })
    }
  }

  async function start() {
    const id = ++run.current
    if (demo) return setPhase({ at: 'meta' })
    if (config?.mode === 'hosted' && config.links) {
      const url = config.links[flow]
      return setPhase(openMetaWindow(url) ? { at: 'opened', url } : { at: 'blocked', url })
    }
    if (config?.mode !== 'sdk' || !config.appId || !config.configId) return
    setPhase({ at: 'meta' })
    try {
      const r = await startSignup({ appId: config.appId, configId: config.configId, sdkVersion: config.sdkVersion ?? 'v23.0' }, flow)
      if (id !== run.current) return
      await finish(r, r.flow)
    } catch (err) {
      if (id === run.current) setPhase({ at: 'left', title: 'Nothing was connected', message: errorDetail(err) })
    }
  }

  const off = !demo && config?.mode === 'none'
  const busy = phase.at === 'finishing'
  const title =
    phase.at === 'connected'
      ? phase.account.needsAttention
        ? 'Almost there'
        : 'WhatsApp connected'
      : phase.at === 'left'
        ? phase.title
        : phase.at === 'opened'
          ? 'Meta’s signup is open'
          : 'Connect a WhatsApp number'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={(e) => busy && e.preventDefault()} onPointerDownOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {phase.at === 'choose'
              ? 'Meta’s signup takes about 5 minutes in its own window: log in with Facebook, pick your business and number, and allow Helo.ai.'
              : phase.at === 'connected'
                ? `${phase.account.phoneNumbers.find((n) => n.id === phase.account.primaryNumberId)?.verifiedName || phase.account.wabaName} is connected to ${workspace}.`
                : ' '}
          </DialogDescription>
        </DialogHeader>

        {phase.at === 'loading' && <PageLoader context="whatsapp" className="min-h-40" />}
        {phase.at === 'config-error' && <InlineError message={`Couldn’t check how connecting works here. ${phase.message}`} onRetry={load} />}

        {phase.at === 'choose' && (
          <div className="space-y-4">
            {off && (
              <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-sm">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                Connecting numbers from the console isn&rsquo;t switched on for this workspace yet. Talk to your Helo.ai contact and they&rsquo;ll set it up.
              </p>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Which number?</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Which number">
                {FLOWS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={flow === f.id}
                    onClick={() => setFlow(f.id)}
                    className={cn('flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors', flow === f.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-border-strong')}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <f.icon className="size-4" />
                      {f.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{f.body}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            {(config?.partnerCredit || demo) && (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Who pays Meta for conversations</legend>
                <RadioGroup value={billing} onValueChange={(v) => setPicked(v as Billing)} className="gap-2">
                  <label className="flex items-start gap-2.5 text-sm">
                    <RadioGroupItem value="partner_credit" className="mt-0.5" />
                    <span>
                      Through Helo.ai
                      <span className="block text-xs text-muted-foreground">On your Helo.ai invoice. Nothing to set up.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 text-sm">
                    <RadioGroupItem value="own" className="mt-0.5" />
                    <span>
                      I&rsquo;ll pay Meta myself
                      <span className="block text-xs text-muted-foreground">You add a payment method in WhatsApp Manager afterwards.</span>
                    </span>
                  </label>
                </RadioGroup>
              </fieldset>
            )}
            <AssetMap flow={flow} workspace={workspace} />
            <p className="text-xs text-muted-foreground">
              You&rsquo;ll need a Facebook login with admin access to your business on Meta, and {flow === 'coexistence' ? 'your phone with the WhatsApp Business app' : 'a phone number that can get an SMS or call'}. Allow pop-ups for this site.
            </p>
          </div>
        )}

        {phase.at === 'meta' && !demo && (
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-3 text-sm">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            Meta&rsquo;s signup is open in another window. Finish it there; this page updates by itself.
          </p>
        )}

        {phase.at === 'opened' && (
          <div className="space-y-4 text-sm">
            <p>
              Meta keeps its signup window separate from this page for your security, so we can&rsquo;t follow your progress here. Finish in Meta&rsquo;s window, then come back.
            </p>
            <AssetMap flow={flow} workspace={workspace} />
            <p className="text-muted-foreground">
              When you finish, Helo.ai completes the connection on its side: it connects our listening app to your account, {flow === 'coexistence' ? 'starts syncing your chats and contacts' : 'registers your number'} and sets up billing. The number then appears on the WhatsApp page.
            </p>
          </div>
        )}

        {phase.at === 'blocked' && (
          <div className="space-y-3 text-sm">
            <p>Your browser blocked Meta&rsquo;s window. Allow pop-ups for this site, or open it in a new tab:</p>
            <Button variant="outline" asChild>
              <a href={phase.url} target="_blank" rel="noopener noreferrer" onClick={() => setPhase({ at: 'opened', url: phase.url })}>
                Open Meta&rsquo;s signup in a new tab <ExternalLink className="size-4" />
              </a>
            </Button>
          </div>
        )}

        {phase.at === 'finishing' && (
          <div className="space-y-4">
            <AssetMap flow={flow} workspace={workspace} assets={phase.assets} />
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Finishing the connection: access, events, {flow === 'coexistence' ? 'chat sync' : 'registration'} and billing. Keep this open.
            </p>
          </div>
        )}

        {phase.at === 'connected' && (
          <div className="space-y-4">
            <AssetMap flow={flow} workspace={workspace} assets={phase.assets} />
            <AccountSteps account={phase.account} canEdit onChange={(a) => setPhase({ ...phase, account: a })} />
            {phase.pin && (
              <div className="space-y-1 rounded-md border border-border px-3 py-2.5 text-sm">
                <p className="font-medium">Your number&rsquo;s two-step PIN</p>
                <p className="flex items-center gap-2">
                  <span className="font-mono text-xl tracking-widest">{phase.pin}</span>
                  <Button size="sm" variant="ghost" aria-label="Copy PIN" onClick={() => void navigator.clipboard?.writeText(phase.pin!).then(() => toast.success('PIN copied.'))}>
                    <Copy className="size-4" />
                  </Button>
                </p>
                <p className="text-xs text-muted-foreground">Keep it safe: Meta asks for it if the number is ever moved. Owners can see it again in Settings › WhatsApp.</p>
              </div>
            )}
          </div>
        )}

        {phase.at === 'left' && <p className="rounded-md bg-muted px-3 py-2.5 text-sm">{phase.message}</p>}

        {phase.at === 'no-number' && (
          <div className="space-y-3 text-sm">
            <p>Meta connected the WhatsApp account but no phone number. Add a number to the account in WhatsApp Manager, then connect again.</p>
            <AssetMap flow={flow} workspace={workspace} assets={phase.assets} />
          </div>
        )}

        {demo && phase.at === 'meta' && (
          <SignupWindow
            flow={flow}
            onClose={(step) => setPhase({ at: 'left', title: 'Nothing was connected', message: `You left Meta’s signup at “${step}”. Nothing was connected.` })}
            onDone={() => {
              const stamp = String(Date.now())
              void finish({ businessId: '990000000000003', wabaId: `99${stamp}`.slice(0, 15), phoneNumberId: `98${stamp}`.slice(0, 15), code: 'demo' }, flow)
            }}
          />
        )}

        <DialogFooter>
          {phase.at === 'choose' ? (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => void start()} disabled={off}>
                Open Meta&rsquo;s signup <ArrowUpRight className="size-4" />
              </Button>
            </>
          ) : phase.at === 'meta' ? (
            <Button variant="outline" onClick={() => (run.current++, setPhase({ at: 'choose' }))}>
              Stop waiting
            </Button>
          ) : phase.at === 'opened' ? (
            <>
              <Button variant="outline" onClick={() => openMetaWindow(phase.url)}>
                Open Meta&rsquo;s window again
              </Button>
              <Button onClick={close}>Done</Button>
            </>
          ) : phase.at === 'left' || phase.at === 'no-number' ? (
            <>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
              <Button onClick={() => setPhase({ at: 'choose' })}>Open again</Button>
            </>
          ) : phase.at === 'connected' ? (
            <Button onClick={close}>
              <CheckCircle2 className="size-4" />
              Done
            </Button>
          ) : phase.at === 'blocked' || phase.at === 'config-error' ? (
            <Button variant="outline" onClick={close}>
              Close
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** "Connect a number" for owners, opening the dialog; everyone else sees why they can't. */
export function ConnectNumberButton({ label = 'Connect a number', variant = 'default', size, className, onConnected }: { label?: string; variant?: 'default' | 'outline' | 'link'; size?: 'sm' | 'default' | 'lg'; className?: string; onConnected?: (a: WaAccount) => void }) {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  if (!can(me?.role, 'whatsapp.manage'))
    return (
      <span className={cn('inline-flex flex-col gap-1', className)}>
        <Button variant={variant} size={size} disabled>
          <Plus className="size-4" />
          {label}
        </Button>
        <span className="text-xs text-muted-foreground">Only owners connect numbers.</span>
      </span>
    )
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        {label}
      </Button>
      <ConnectNumberDialog open={open} onOpenChange={setOpen} onConnected={onConnected} />
    </>
  )
}
