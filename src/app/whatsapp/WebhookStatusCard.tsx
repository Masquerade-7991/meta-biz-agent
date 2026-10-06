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
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full', live ? 'bg-success' : 'bg-amber-500')} />
        {s.lastAt ? `Last event from WhatsApp ${ago(s.lastAt)}` : 'No events from WhatsApp yet'}
      </p>
      {!live && (
        <p className="text-muted-foreground">
          Until WhatsApp sends this number&rsquo;s webhooks here, the inbox shows what the AI agent said, but customers&rsquo; own words, photos and files appear as placeholders.
        </p>
      )}
      <div className="space-y-1.5 rounded-lg border border-border p-3">
        <p className="text-muted-foreground text-xs">
          In your Meta app, open WhatsApp &rarr; Configuration and set the callback URL to:
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
          Then subscribe to <strong>messages</strong>, <strong>message_template_status_update</strong> and <strong>phone_number_quality_update</strong>.
          {s.verifyTokenSet ? ' Use the verify token set on the server (WEBHOOK_VERIFY_TOKEN).' : ' The server has no verify token yet: set WEBHOOK_VERIFY_TOKEN first.'}
          {!s.signatureChecked && ' Set APP_SECRET on the server too, so only Meta can post events.'}
        </p>
      </div>
    </div>
  )
}
