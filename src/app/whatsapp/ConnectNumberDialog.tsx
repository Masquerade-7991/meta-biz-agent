import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ArrowLeft, ArrowLeftRight, CheckCircle2, ChevronRight, Copy, Loader2, Plus, Smartphone, Store } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { useAuth } from '@/app/auth/AuthContext'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { isDummyMode } from '@/app/api/dummy'
import { errorDetail } from '@/app/api/meta'
import { connectAccount, getSignupConfig, type Flow, type SignupConfig, type WaAccount } from '@/app/api/whatsapp'
import { startSignup } from './embeddedSignup'
import { SignupWindow } from './SignupWindow'
import { CONNECT_KINDS, type ConnectKind } from './connectKinds'
import type { SignupAssets } from './signupLink'

type Phase =
  | { at: 'loading' }
  | { at: 'config-error'; message: string }
  | { at: 'choose' }
  | { at: 'check' }
  /** Meta's window is open and this page follows it (the full signup, or the demo). */
  | { at: 'meta' }
  | { at: 'finishing' }
  | { at: 'connected'; account: WaAccount; pin?: string }
  | { at: 'left'; message: string; title: string }
  | { at: 'no-number' }

const ICONS: Record<ConnectKind['id'], typeof Smartphone> = { new: Smartphone, app: Store, move: ArrowLeftRight }

/**
 * Two screens, then Meta: pick the kind of number, read what to know and tick the confirmations, then
 * Connect. The full signup (mode sdk) and Dummy mode follow Meta's window here and finish the
 * connection; with only Meta's hosted link (mode hosted), Connect sends this tab to Meta's page.
 * Conversations are billed through Helo.ai's credit line when it's set up, otherwise to the business.
 */
function ConnectNumberDialog({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (o: boolean) => void; onConnected?: (a: WaAccount) => void }) {
  const { me } = useAuth()
  const workspace = me?.workspace?.name ?? 'this workspace'
  const demo = isDummyMode()
  const [config, setConfig] = useState<SignupConfig | null>(null)
  const [phase, setPhase] = useState<Phase>({ at: 'loading' })
  const [kind, setKind] = useState<ConnectKind>(CONNECT_KINDS[0])
  const [ticked, setTicked] = useState<boolean[]>([])
  const flow: Flow = kind.flow
  // A signup this dialog stopped waiting for (closed, or Stop waiting) must not come back later.
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
    load()
  }, [open])

  const close = () => {
    if (phase.at === 'finishing') return // the server is connecting the account: its result (and PIN) must be seen
    if (phase.at === 'connected') onConnected?.(phase.account)
    run.current++
    onOpenChange(false)
  }
  const pick = (k: ConnectKind) => {
    setKind(k)
    setTicked(k.confirm.map(() => false))
    setPhase({ at: 'check' })
  }

  async function finish(assets: SignupAssets & { code: string }, f: Flow) {
    if (!assets.phoneNumberId) return setPhase({ at: 'no-number' })
    setPhase({ at: 'finishing' })
    try {
      const billing = config?.partnerCredit ? 'partner_credit' : 'own'
      const r = await connectAccount({ code: assets.code, wabaId: assets.wabaId ?? '', phoneNumberId: assets.phoneNumberId, businessId: assets.businessId ?? '', flow: f, billing })
      setPhase({ at: 'connected', account: r.account, pin: r.pin })
    } catch (err) {
      setPhase({ at: 'left', title: 'Couldn’t finish connecting', message: errorDetail(err) })
    }
  }

  async function start() {
    const id = ++run.current
    if (demo) return setPhase({ at: 'meta' })
    if (config?.mode === 'hosted') {
      const link = config.links?.[flow] ?? config.link
      if (link) window.location.assign(link)
      return
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

  const busy = phase.at === 'finishing'
  const ready = ticked.length > 0 && ticked.every(Boolean)
  const title =
    phase.at === 'choose' || phase.at === 'loading' || phase.at === 'config-error'
      ? 'Connect your WhatsApp number'
      : phase.at === 'connected'
        ? 'WhatsApp connected'
        : phase.at === 'left'
          ? phase.title
          : phase.at === 'no-number'
            ? 'No number was connected'
            : kind.title

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={(e) => busy && e.preventDefault()} onPointerDownOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase.at === 'check' && (
              <Button variant="ghost" size="icon-sm" className="-ml-2" aria-label="Back" onClick={() => setPhase({ at: 'choose' })}>
                <ArrowLeft className="size-4" />
              </Button>
            )}
            {title}
          </DialogTitle>
          <DialogDescription className={cn(phase.at !== 'connected' && 'sr-only')}>
            {phase.at === 'connected'
              ? `${phase.account.phoneNumbers.find((n) => n.id === phase.account.primaryNumberId)?.verifiedName || phase.account.wabaName} is connected to ${workspace}.`
              : 'Connect a WhatsApp number to this workspace through Meta’s signup.'}
          </DialogDescription>
        </DialogHeader>

        {phase.at === 'loading' && <PageLoader context="whatsapp" className="min-h-40" />}
        {phase.at === 'config-error' && <InlineError message={`Couldn’t check how connecting works here. ${phase.message}`} onRetry={load} />}

        {phase.at === 'choose' && (
          <div className="grid gap-2">
            {CONNECT_KINDS.map((k) => {
              const Icon = ICONS[k.id]
              return (
                <button key={k.id} type="button" onClick={() => pick(k)} className="group flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-success/10 text-success">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{k.title}</span>
                    <span className="block text-xs text-muted-foreground">{k.line}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </button>
              )
            })}
          </div>
        )}

        {phase.at === 'check' && (
          <div className="rounded-lg border border-border">
            <div className="space-y-2 p-4">
              <p className="text-sm font-medium">Here are some things you should know</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                {kind.know.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </div>
            <div className="space-y-3 border-t border-border p-4">
              {kind.confirm.map((label, i) => (
                <label key={label} className="flex items-center gap-2.5 text-sm">
                  <Checkbox checked={!!ticked[i]} onCheckedChange={(v) => setTicked((t) => t.map((x, j) => (j === i ? v === true : x)))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        {phase.at === 'meta' && !demo && (
          <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-3 text-sm">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            Finish in Meta&rsquo;s window; this updates by itself.
          </p>
        )}

        {phase.at === 'finishing' && (
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Connecting&hellip;
          </p>
        )}

        {phase.at === 'connected' && (phase.pin || phase.account.needsAttention) && (
          <div className="space-y-3">
            {phase.pin && (
              <div className="space-y-1 rounded-md border border-border px-3 py-2.5 text-sm">
                <p className="font-medium">Your number&rsquo;s two-step PIN</p>
                <p className="flex items-center gap-2">
                  <span className="font-mono text-xl tracking-widest">{phase.pin}</span>
                  <Button size="sm" variant="ghost" aria-label="Copy PIN" onClick={() => void navigator.clipboard?.writeText(phase.pin!).then(() => toast.success('PIN copied.'))}>
                    <Copy className="size-4" />
                  </Button>
                </p>
                <p className="text-xs text-muted-foreground">Keep it safe: Meta asks for it if the number is ever moved. Owners can see it again on the number’s Security tab in Assets.</p>
              </div>
            )}
            {phase.account.needsAttention && (
              <p className="rounded-md bg-warning/15 px-3 py-2.5 text-sm text-warning-foreground">
                One step still needs you.{' '}
                <Link to="/whatsapp?tab=account" className="font-medium underline underline-offset-2" onClick={close}>
                  Finish it in Assets › Account
                </Link>
              </p>
            )}
          </div>
        )}

        {phase.at === 'left' && <p className="rounded-md bg-muted px-3 py-2.5 text-sm">{phase.message}</p>}
        {phase.at === 'no-number' && <p className="text-sm">Meta connected the WhatsApp account but no phone number. Add a number to the account in WhatsApp Manager, then connect again.</p>}

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

        {phase.at !== 'choose' && phase.at !== 'loading' && phase.at !== 'finishing' && (
          <DialogFooter>
            {phase.at === 'check' ? (
              <Button disabled={!ready} onClick={() => void start()}>
                Connect
              </Button>
            ) : phase.at === 'meta' ? (
              <Button variant="outline" onClick={() => (run.current++, setPhase({ at: 'check' }))}>
                Stop waiting
              </Button>
            ) : phase.at === 'left' || phase.at === 'no-number' ? (
              <>
                <Button variant="outline" onClick={close}>
                  Close
                </Button>
                <Button onClick={() => setPhase({ at: 'check' })}>Try again</Button>
              </>
            ) : phase.at === 'connected' ? (
              <Button onClick={close}>
                <CheckCircle2 className="size-4" />
                Done
              </Button>
            ) : (
              <Button variant="outline" onClick={close}>
                Close
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Connect" for owners; everyone else sees why they can't. It opens the dialog with the full signup
 * (sdk), Meta's hosted link (hosted) and in Dummy mode; with neither, it says who to ask.
 */
export function ConnectNumberButton({ label = 'Connect', variant = 'default', size, className, onConnected }: { label?: string; variant?: 'default' | 'outline' | 'link'; size?: 'sm' | 'default' | 'lg'; className?: string; onConnected?: (a: WaAccount) => void }) {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function connect() {
    if (isDummyMode()) return setOpen(true)
    setBusy(true)
    try {
      const c = await getSignupConfig()
      if (c.mode === 'sdk' || (c.mode === 'hosted' && (c.links || c.link))) setOpen(true)
      else toast.info('Connecting numbers from the console isn’t switched on for this workspace yet. Talk to your Helo.ai contact.')
    } catch (err) {
      toast.error('Couldn’t open Meta’s signup', { description: errorDetail(err) })
    } finally {
      setBusy(false)
    }
  }
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
      <Button variant={variant} size={size} className={className} disabled={busy} onClick={() => void connect()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {label}
      </Button>
      <ConnectNumberDialog open={open} onOpenChange={setOpen} onConnected={onConnected} />
    </>
  )
}
