import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Eye, Loader2, MessageSquare, Phone } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { changePin, deregisterNumber, registerNumber, requestCode, showPin, verifyCode } from '@/app/api/numbers'
import { can } from '@/app/lib/permissions'
import { SECTION_TITLE, TEXT_SM, TEXT_XS } from '@/app/lib/text'
import { useForcedFailure } from './useForcedFailure'
import type { TabProps } from './NumberPage'

function Section({ title, description, children, danger }: { title: string; description: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className={danger ? 'space-y-3 rounded-lg border border-destructive/40 p-4' : 'space-y-3 border-b border-border pb-6'}>
      <div className="space-y-1">
        <h2 style={SECTION_TITLE}>{title}</h2>
        <p className="text-muted-foreground" style={TEXT_SM}>
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}
const digits6 = (v: string) => v.replace(/\D/g, '').slice(0, 6)

/** Proving ownership, registering for messaging, the two-step PIN, and switching the number off. */
export function SecurityTab({ detail, onSaved }: TabProps) {
  const { me } = useAuth()
  const isOwner = can(me?.role, 'whatsapp.manage')
  const canEdit = can(me?.role, 'numbers.edit')
  const failNext = useForcedFailure()
  const n = detail.number
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ where: string; text: string } | null>(null)
  // Verification: ask for a code, then type it. Resending waits a minute.
  const [codeSent, setCodeSent] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!codeSent) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [codeSent])
  const wait = codeSent ? Math.max(0, 60 - Math.floor((now - codeSent) / 1000)) : 0
  const [regPin, setRegPin] = useState('')
  const [pin, setPin] = useState({ a: '', b: '' })
  const [shown, setShown] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  async function run(where: string, fn: () => Promise<unknown>, done: string) {
    setBusy(where)
    setError(null)
    try {
      failNext()
      await fn()
      toast.success(done)
    } catch (err) {
      setError({ where, text: errorDetail(err) })
    } finally {
      setBusy(null)
    }
  }
  const err = (where: string) => error?.where === where && <FormError>{error.text}</FormError>
  const spin = (where: string) => busy === where && <Loader2 className="size-4 animate-spin" />
  const verified = n.codeVerification === 'VERIFIED' || n.status === 'CONNECTED'
  const live = n.status === 'CONNECTED'

  return (
    <div className="max-w-2xl space-y-6">
      {!verified && (
        <Section title="Verify you own this number" description="WhatsApp sends a 6-digit code by text message or phone call to this number. Enter it here.">
          {!canEdit ? (
            <p className="text-muted-foreground" style={TEXT_SM}>
              Owners and admins verify numbers.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {(['SMS', 'VOICE'] as const).map((m) => (
                  <Button key={m} variant="outline" size="sm" disabled={!!busy || wait > 0} onClick={() => void run('code', async () => (await requestCode(n.id, m), setCodeSent(Date.now())), m === 'SMS' ? 'Code sent by text message.' : 'WhatsApp is calling the number with the code.')}>
                    {busy === 'code' ? <Loader2 className="size-4 animate-spin" /> : m === 'SMS' ? <MessageSquare className="size-4" /> : <Phone className="size-4" />}
                    {codeSent ? (m === 'SMS' ? 'Text it again' : 'Call again') : m === 'SMS' ? 'Text me the code' : 'Call me with the code'}
                  </Button>
                ))}
                {wait > 0 && (
                  <span className="self-center text-muted-foreground" style={TEXT_XS}>
                    You can ask again in {wait}s
                  </span>
                )}
              </div>
              {err('code')}
              {codeSent && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void run('verify', async () => onSaved(await verifyCode(n.id, code)), 'Verified. Now register the number below.')
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="vc">Code</Label>
                    <Input id="vc" className="w-40 tracking-widest" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(digits6(e.target.value))} />
                  </div>
                  <Button type="submit" disabled={!!busy || code.length < 6}>
                    {spin('verify')} Verify
                  </Button>
                </form>
              )}
              {err('verify')}
            </>
          )}
        </Section>
      )}

      <Section title="Messaging" description={live ? 'This number is registered and can send and receive messages.' : 'Registering turns messaging on for this number. It needs the two-step PIN.'}>
        {!isOwner ? (
          <p className="text-muted-foreground" style={TEXT_SM}>
            Owners register and deregister numbers.
          </p>
        ) : !verified ? (
          <p className="text-muted-foreground" style={TEXT_SM}>
            Verify the number first.
          </p>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run('register', async () => (onSaved(await registerNumber(n.id, regPin || undefined)), setRegPin('')), live ? 'Registered again. A newly approved name now shows.' : 'Registered. The number is live.')
            }}
          >
            {!n.pinKnown && (
              <div className="space-y-1.5">
                <Label htmlFor="rp">Two-step PIN</Label>
                <Input id="rp" type="password" className="w-40 tracking-widest" inputMode="numeric" value={regPin} onChange={(e) => setRegPin(digits6(e.target.value))} />
              </div>
            )}
            <Button type="submit" variant={live ? 'outline' : 'default'} disabled={!!busy || (!n.pinKnown && regPin.length < 6)}>
              {spin('register')} {live ? 'Register again' : 'Register the number'}
            </Button>
            {live && (
              <span className="w-full text-muted-foreground" style={TEXT_XS}>
                Register again after WhatsApp approves a new display name, so customers see it.
              </span>
            )}
          </form>
        )}
        {err('register')}
      </Section>

      {isOwner && (
        <Section title="Two-step verification PIN" description="WhatsApp asks for this 6-digit PIN whenever the number is registered again. It can’t be turned off.">
          {!detail.pinStorage && (
            <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground" style={TEXT_XS}>
              This server can&rsquo;t remember PINs yet (TOKEN_ENCRYPTION_KEY isn&rsquo;t set), so keep yours somewhere safe. You&rsquo;ll type it when registering.
            </p>
          )}
          {n.pinKnown && (
            <div className="flex items-center gap-2">
              {shown ? (
                <span className="rounded-md bg-muted px-2 py-1 font-mono tracking-widest" style={TEXT_SM}>
                  {shown}
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => void showPin(n.id).then((r) => setShown(r.pin), (e) => toast.error(errorDetail(e)))}>
                  <Eye className="size-4" /> Show the current PIN
                </Button>
              )}
            </div>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run('pin', async () => (onSaved(await changePin(n.id, pin.a)), setPin({ a: '', b: '' }), setShown(null)), detail.pinStorage ? 'PIN changed. The console remembers it for registering.' : 'PIN changed. Keep it somewhere safe: you’ll need it to register.')
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="p1">New PIN</Label>
              <Input id="p1" type="password" className="w-36 tracking-widest" inputMode="numeric" autoComplete="new-password" value={pin.a} onChange={(e) => setPin({ ...pin, a: digits6(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p2">Repeat it</Label>
              <Input id="p2" type="password" className="w-36 tracking-widest" inputMode="numeric" autoComplete="new-password" value={pin.b} onChange={(e) => setPin({ ...pin, b: digits6(e.target.value) })} />
            </div>
            <Button type="submit" disabled={!!busy || pin.a.length < 6 || pin.a !== pin.b}>
              {spin('pin')} Change PIN
            </Button>
            {pin.b.length === 6 && pin.a !== pin.b && (
              <span className="w-full text-destructive" style={TEXT_XS}>
                The two PINs don&rsquo;t match.
              </span>
            )}
          </form>
          {err('pin')}
        </Section>
      )}

      {isOwner && live && (
        <Section danger title="Deregister this number" description="Messaging stops on this number: the AI agent, inbox and broadcasts stop working there until it’s registered again.">
          <Button variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
            Deregister&hellip;
          </Button>
          {err('deregister')}
        </Section>
      )}

      <Dialog open={confirming} onOpenChange={(o) => (setConfirming(o), setTyped(''))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deregister {n.display}?</DialogTitle>
            <DialogDescription>Customers can&rsquo;t reach you on this number until it&rsquo;s registered again with its PIN. Type the number to confirm.</DialogDescription>
          </DialogHeader>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={n.display} aria-label="Type the number to confirm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!!busy || typed.replace(/\D/g, '') !== n.display.replace(/\D/g, '')}
              onClick={() => void run('deregister', async () => (onSaved(await deregisterNumber(n.id, typed)), setConfirming(false)), 'Deregistered. Register it again from this page when you’re ready.')}
            >
              {spin('deregister')} Deregister
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
