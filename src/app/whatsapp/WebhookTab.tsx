import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { errorDetail } from '@/app/api/meta'
import { routeWebhook } from '@/app/api/numbers'
import { TEXT_SM, TEXT_XS } from '@/app/lib/text'
import { WebhookStatusCard } from './WebhookStatusCard'
import { useForcedFailure } from './useForcedFailure'
import type { TabProps } from './NumberPage'

/** Where WhatsApp sends this number's events (owners only). The most specific setting wins:
 *  the number's own, then the WhatsApp account's, then the Meta app's. */
export function WebhookTab({ detail, onSaved }: TabProps) {
  const failNext = useForcedFailure()
  const w = detail.webhook
  const current = w.number ?? w.account ?? w.app
  const here = current === w.console
  const [confirm, setConfirm] = useState(false)
  const [other, setOther] = useState({ url: '', verifyToken: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply(b: Parameters<typeof routeWebhook>[1]) {
    setBusy(true)
    setError(null)
    try {
      failNext()
      onSaved(await routeWebhook(detail.number.id, b))
      toast.success('WhatsApp now sends this number’s events to the new address.')
      setOther({ url: '', verifyToken: '' })
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2" style={TEXT_SM}>
        <p className="text-muted-foreground" style={TEXT_XS}>
          WhatsApp sends this number&rsquo;s events to
        </p>
        <code className="block truncate rounded bg-muted px-2 py-1.5">{current ?? 'Nowhere set'}</code>
        <p className="text-muted-foreground" style={TEXT_XS}>
          {w.number ? 'Set on this number.' : w.account ? 'Set on the WhatsApp account (applies to all its numbers).' : w.app ? 'Set on the Meta app.' : ''}
          {here ? ' That’s this console, so the inbox gets customers’ messages, photos and delivery ticks.' : ' That isn’t this console, so the inbox only sees the AI agent’s side of chats.'}
        </p>
      </div>
      <WebhookStatusCard />
      {!here && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4" style={TEXT_SM}>
          <p className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              Sending events here means <strong>{current ?? 'the current address'}</strong> stops getting them. If another system uses them (for example Helo.ai&rsquo;s own servers), agree this with its owners first.
            </span>
          </p>
          {!w.reachable && (
            <p className="text-muted-foreground" style={TEXT_XS}>
              This console runs at an address WhatsApp can&rsquo;t reach ({w.console}). Deploy the server and set APP_URL first.
            </p>
          )}
          <Button disabled={busy || !w.reachable || !w.verifyTokenSet} onClick={() => setConfirm(true)}>
            {busy && <Loader2 className="size-4 animate-spin" />} Send events to this console
          </Button>
        </div>
      )}
      <form
        className="space-y-3 border-t border-border pt-6"
        onSubmit={(e) => {
          e.preventDefault()
          void apply({ target: 'other', ...other })
        }}
      >
        <p style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-semi-bold)' }}>Send them somewhere else</p>
        <p className="text-muted-foreground" style={TEXT_XS}>
          For example back to {w.account ?? w.app ?? 'the previous address'}. That system&rsquo;s owners can give you its verify token.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="wh-url">Callback URL</Label>
          <Input id="wh-url" value={other.url} onChange={(e) => setOther({ ...other, url: e.target.value })} placeholder="https://" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wh-tok">Verify token</Label>
          <Input id="wh-tok" value={other.verifyToken} onChange={(e) => setOther({ ...other, verifyToken: e.target.value })} />
        </div>
        <Button type="submit" variant="outline" disabled={busy || !other.url.startsWith('https://') || !other.verifyToken.trim()}>
          Use this address
        </Button>
      </form>
      {error && <FormError>{error}</FormError>}
      <ConfirmDialog
        open={confirm}
        title="Send this number’s events to this console?"
        description={`WhatsApp will stop sending them to ${current ?? 'the current address'}. You can point them back from this tab with that system’s verify token.`}
        confirmLabel="Send them here"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void apply({ target: 'console' })
        }}
      />
    </div>
  )
}
