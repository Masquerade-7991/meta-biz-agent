import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, Circle, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { StatusPill } from '@/app/components/ui/status'
import { getWebhookStatus, resetWebhookBaseline, type WebhookStatus } from '@/app/api/whatsapp'
import { errorDetail } from '@/app/api/meta'
import type { Tone } from '@/app/lib/status'

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`
}
type App = { id: string | null; name: string | null }
const keyOf = (a: App) => a.id ?? a.name ?? ''
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function Tile({ label, tone, state, reason }: { label: string; tone: Tone; state: string; reason: ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card p-3.5">
      <p className="text-meta text-muted-foreground">{label}</p>
      <StatusPill tone={tone} className="max-w-full">{state}</StatusPill>
      <p className="text-xs text-muted-foreground">{reason}</p>
    </div>
  )
}

function Step({ done, children, hint }: { done: boolean; children: ReactNode; hint?: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={done ? 'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground' : 'mt-0.5 shrink-0 text-muted-foreground'}>
        {done ? <Check className="size-3" strokeWidth={3} /> : <Circle className="size-4" />}
      </span>
      <span className="min-w-0 text-sm">
        <span className={done ? 'text-muted-foreground' : 'font-medium'}>{children}</span>
        {!done && hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </li>
  )
}

/** How WhatsApp's events reach the console: at a glance, then the setup checklist, the apps Meta
 *  sends them to, and the technical details. Owners only (the server refuses everyone else). */
export function WebhookStatusCard() {
  const [s, setS] = useState<WebhookStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marking, setMarking] = useState(false)
  useEffect(() => {
    getWebhookStatus().then(setS, (err: Error) => setError(errorDetail(err)))
  }, [])
  if (error) return <p className="text-xs text-muted-foreground">Couldn&rsquo;t check webhooks: {error}</p>
  if (!s) return <Loader2 className="size-4 animate-spin text-muted-foreground" />

  const apps = s.subscribedApps ?? null
  const now = new Set((apps ?? []).map(keyOf))
  const baseline = s.baseline?.apps ?? []
  const missing = baseline.filter((a) => !now.has(keyOf(a)))
  const listener = apps?.find((a) => a.id && a.id === s.listenerAppId) ?? null
  const inBaseline = new Set(baseline.map(keyOf))
  const added = (apps ?? []).filter((a) => !inBaseline.has(keyOf(a)) && keyOf(a) !== s.listenerAppId)
  const others = (apps ?? []).filter((a) => keyOf(a) !== s.listenerAppId)

  const live = !!s.lastAt && Date.now() - Date.parse(s.lastAt) < 7 * 86_400_000
  const events24 = (s.last24h ?? []).reduce((n, f) => n + f.count, 0)
  const pending = s.pending ?? 0
  const secrets = s.appsAccepted ?? (s.signatureChecked ? 1 : 0)
  const listenerOk = !s.listenerAppId || !apps || !!listener
  const ready = s.verifyTokenSet && secrets > 0 && listenerOk && live

  const markExpected = () => {
    setMarking(true)
    resetWebhookBaseline().then(
      (next) => {
        setS(next)
        toast.success('Saved. This list is now the expected one.')
      },
      (err) => toast.error(errorDetail(err)),
    ).finally(() => setMarking(false))
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Tile
          label="Receiving events"
          tone={live ? 'success' : 'warning'}
          state={live ? 'Live' : 'Waiting'}
          reason={s.lastAt ? `Last event ${ago(s.lastAt)}` : 'No event has reached this console yet'}
        />
        <Tile
          label="Signature check"
          tone={secrets > 0 ? 'success' : 'danger'}
          state={secrets > 0 ? plural(secrets, 'app') + ' accepted' : 'Not set up'}
          reason={secrets > 0 ? 'Only signed events are accepted' : 'Add the app secret (WEBHOOK_APP_SECRETS) on the server'}
        />
        <Tile
          label="Delivery"
          tone={pending ? 'warning' : 'success'}
          state={pending ? `${pending} waiting` : 'All processed'}
          reason={pending ? `${s.failed ?? 0} failed · retried automatically` : `${plural(events24, 'event')} in the last 24 hours`}
        />
        <Tile
          label="Apps on this account"
          tone={!apps ? 'neutral' : missing.length ? 'danger' : 'success'}
          state={!apps ? 'Unavailable' : missing.length ? `${missing.length} missing` : 'All intact'}
          reason={!apps ? 'Couldn’t read the list from Meta' : missing.length ? missing.map((a) => a.name ?? a.id).join(', ') : `${plural(baseline.length || others.length, 'original app')}${listener ? ', plus your listening app' : ''}`}
        />
      </div>

      {ready ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
          <span className="flex size-4 items-center justify-center rounded-full bg-success text-success-foreground">
            <Check className="size-3" strokeWidth={3} />
          </span>
          Everything is set up. Customer messages, replies and delivery ticks arrive here.
        </p>
      ) : (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">To start receiving events</h3>
          <ul className="space-y-2.5">
            <Step done={s.verifyTokenSet} hint="Set WEBHOOK_VERIFY_TOKEN on the server, and type the same value in the Meta app.">
              Verify token set
            </Step>
            <Step done={secrets > 0} hint="Add the listening app’s App Secret as WEBHOOK_APP_SECRETS on the server, then redeploy.">
              App secret set
            </Step>
            <Step done={listenerOk} hint="In Graph API Explorer, POST /<your WhatsApp account id>/subscribed_apps with the listening app’s token.">
              Listening app subscribed to this account
            </Step>
            <Step done={live} hint="In the listening app: save the webhook (callback URL, verify token, fields), switch it to Live, then send a message to the business number. Development mode only delivers events for people with a role on the app.">
              Events are arriving
            </Step>
          </ul>
        </section>
      )}

      {apps && (
        <details className="group rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-sm font-semibold">Apps receiving this account’s events ({apps.length})</span>
              <span className="block text-xs text-muted-foreground">Read from Meta. The console never changes these.</span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-border px-4 py-3">
            <ul className="divide-y divide-border">
              {listener && (
                <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <span className="text-sm font-medium">{listener.name ?? 'Listening app'}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{listener.id}</span>
                    <StatusPill tone="info">Listening here</StatusPill>
                  </span>
                </li>
              )}
              {others.map((a) => (
                <li key={keyOf(a)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <span className="text-sm">{a.name ?? 'App'}</span>
                  <span className="font-mono text-xs text-muted-foreground">{a.id}</span>
                </li>
              ))}
              {missing.map((a) => (
                <li key={'missing' + keyOf(a)} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-destructive">{a.name ?? 'App'}</span>
                  <StatusPill tone="danger">Missing</StatusPill>
                </li>
              ))}
            </ul>
            {s.baseline && (
              <p className="text-xs text-muted-foreground">
                {missing.length
                  ? `Compared with the list saved on ${new Date(s.baseline.at).toLocaleDateString()}.`
                  : `Every app on the list saved on ${new Date(s.baseline.at).toLocaleDateString()} is still here.`}
                {added.length > 0 && ` New since then: ${added.map((a) => a.name ?? a.id).join(', ')}.`}
              </p>
            )}
            {(missing.length > 0 || added.length > 0) && (
              <Button size="sm" variant="outline" disabled={marking} onClick={markExpected}>
                {marking && <Loader2 className="size-3.5 animate-spin" />}
                Mark this list as expected
              </Button>
            )}
          </div>
        </details>
      )}

      {!!s.last24h?.length && (
        <div className="space-y-1.5">
          <p className="text-meta text-muted-foreground">Last 24 hours</p>
          <ul className="flex flex-wrap gap-1.5">
            {s.last24h.map((f) => (
              <li key={f.field} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                {f.field.replace(/_/g, ' ')} <span className="tabular-nums text-muted-foreground">{f.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(s.unknownNumbers ?? 0) > 0 && (
        <p className="text-xs text-warning-foreground">{plural(s.unknownNumbers!, 'event')} this week for a number this console doesn’t know (kept, not shown).</p>
      )}

      <details className="group text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
          Technical details
        </summary>
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-card p-3.5">
          <p className="text-xs text-muted-foreground">In the listening app on Meta, open WhatsApp &rarr; Configuration and set the callback URL to:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{s.callbackUrl}</code>
            <Button size="sm" variant="ghost" aria-label="Copy callback URL" onClick={() => void navigator.clipboard.writeText(s.callbackUrl).then(() => toast.success('Copied.'))}>
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Subscribe to <strong>messages</strong> and the other WhatsApp fields, and leave every override setting empty.
            {s.verifyTokenSet ? ' Use the verify token set on the server (WEBHOOK_VERIFY_TOKEN).' : ' The server has no verify token yet: set WEBHOOK_VERIFY_TOKEN first.'}
          </p>
        </div>
      </details>
    </div>
  )
}
