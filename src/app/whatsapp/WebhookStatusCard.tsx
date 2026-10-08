import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { getWebhookStatus, type WebhookStatus } from '@/app/api/whatsapp'
import { cn } from '@/app/lib/utils'

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`
}

/** Are Meta's webhooks reaching us? Without them the inbox sees only the AI's side of each chat. */
export function WebhookStatusCard() {
  const [s, setS] = useState<WebhookStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getWebhookStatus().then(setS, (err: Error) => setError(err.message))
  }, [])
  if (error) return <p className="text-muted-foreground text-xs">Couldn&rsquo;t check webhooks: {error}</p>
  if (!s) return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  const live = !!s.lastAt && Date.now() - Date.parse(s.lastAt) < 7 * 86_400_000
  const appKey = (a: { id: string | null; name: string | null }) => a.id ?? a.name ?? ''
  const now = new Set((s.subscribedApps ?? []).map(appKey))
  const missing = (s.baseline?.apps ?? []).filter((a) => !now.has(appKey(a)))
  return (
    <div className="space-y-4 text-sm">
      <p className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full', live ? 'bg-success' : 'bg-amber-500')} />
        {s.lastAt ? `Last event from WhatsApp ${ago(s.lastAt)}` : 'No events from WhatsApp yet'}
      </p>
      {!live && (
        <p className="text-muted-foreground">
          Until WhatsApp sends this number&rsquo;s webhooks here, the inbox shows what the AI agent said, but customers&rsquo; own words, photos and files appear as placeholders.
        </p>
      )}

      {!!s.last24h?.length && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Last 24 hours</p>
          <ul className="flex flex-wrap gap-1.5">
            {s.last24h.map((f) => (
              <li key={f.field} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {f.field} <span className="tabular-nums text-muted-foreground">{f.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(!!s.pending || !!s.unknownNumbers) && (
        <p className="text-xs text-warning-foreground">
          {s.pending ? `${s.pending} event${s.pending === 1 ? '' : 's'} waiting to be processed${s.failed ? ` (${s.failed} failed; retried automatically)` : ''}. ` : ''}
          {s.unknownNumbers ? `${s.unknownNumbers} event${s.unknownNumbers === 1 ? '' : 's'} this week for a number this console doesn’t know (kept, not shown).` : ''}
        </p>
      )}

      {s.subscribedApps && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Apps receiving this account’s events (read from Meta)</p>
          <ul className="space-y-1">
            {s.subscribedApps.map((a) => (
              <li key={appKey(a)} className="flex items-center gap-2 text-sm">
                <span className="size-1.5 rounded-full bg-success" />
                {a.name ?? 'App'} <span className="font-mono text-xs text-muted-foreground">{a.id}</span>
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="text-xs text-destructive">
              No longer subscribed since {new Date(s.baseline!.at).toLocaleDateString()}: {missing.map((a) => a.name ?? a.id).join(', ')}.
            </p>
          )}
          {s.baseline && !missing.length && (
            <p className="text-xs text-muted-foreground">Every app subscribed on {new Date(s.baseline.at).toLocaleDateString()} is still there.</p>
          )}
        </div>
      )}

      <div className="space-y-1.5 rounded-lg border border-border p-3">
        <p className="text-muted-foreground text-xs">
          In the listening app on Meta, open WhatsApp &rarr; Configuration and set the callback URL to:
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
            {s.callbackUrl}
          </code>
          <Button size="sm" variant="ghost" aria-label="Copy callback URL" onClick={() => void navigator.clipboard.writeText(s.callbackUrl).then(() => toast.success('Copied.'))}>
            <Copy className="size-4" />
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Subscribe to <strong>messages</strong> and the other WhatsApp fields; leave every override setting empty.
          {s.verifyTokenSet ? ' Use the verify token set on the server (WEBHOOK_VERIFY_TOKEN).' : ' The server has no verify token yet: set WEBHOOK_VERIFY_TOKEN first.'}
          {s.signatureChecked
            ? ` Signatures from ${s.appsAccepted ?? 1} app${s.appsAccepted === 1 ? '' : 's'} are accepted.`
            : ' The server has no app secret yet (WEBHOOK_APP_SECRETS), so it refuses events until one is set.'}
        </p>
      </div>
    </div>
  )
}
