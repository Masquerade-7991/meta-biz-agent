import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Lock, Unplug } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { StatusPill } from '@/app/components/ui/status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { LoadFailedBanner } from '@/app/components/wizard/RetryBanner'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { disconnectAccount, listAccounts, type WaAccount } from '@/app/api/whatsapp'
import { AccountSteps } from './AccountSteps'
import { AssetMap } from './AssetMap'
import { WebhookStatusCard } from './WebhookStatusCard'

const SOURCE: Record<WaAccount['source'], string> = { env: 'Set up by Helo.ai', signup: 'Connected with Embedded Signup', coexistence: 'WhatsApp Business app number' }

/** Assets › Account (owners): the selected WhatsApp Business account: how it was set up, its setup
 *  steps and payment method, how it maps into Helo.ai, its live events, and disconnecting it. The
 *  two-step PIN stays per number (a number's Security tab). */
export function AccountTab({ wabaId, onDisconnected }: { wabaId: string | null; onDisconnected: () => void }) {
  const { me } = useAuth()
  const [rows, setRows] = useState<WaAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const load = useCallback(() => {
    setError(null)
    listAccounts().then(setRows, (err) => setError(errorDetail(err)))
  }, [])
  useEffect(load, [load])

  if (error) return <LoadFailedBanner message={`Couldn’t load the WhatsApp account. ${error}`} onRetry={load} />
  if (!rows) return <PageLoader context="whatsapp" className="min-h-[30vh] py-10" />
  const a = rows.find((x) => x.wabaId === wabaId) ?? rows[0]
  if (!a) return <p className="text-sm text-muted-foreground">No WhatsApp account is connected.</p>
  const upsert = (next: WaAccount) => setRows((prev) => [...(prev ?? []).filter((x) => x.wabaId !== next.wabaId), next])

  return (
    <div className="space-y-6">
      <section aria-labelledby="account-card" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="account-card" className="text-section font-semibold">
              {a.wabaName}
            </h2>
            <p className="text-xs text-muted-foreground">{SOURCE[a.source]}</p>
          </div>
          <span className="flex flex-wrap gap-1.5">
            {a.needsAttention ? <StatusPill tone="warning">Needs attention</StatusPill> : <StatusPill tone="success">Connected</StatusPill>}
            <StatusPill tone="neutral" dot={false}>
              {a.billing.mode === 'partner_credit' ? 'Billed through Helo.ai' : 'Pays Meta directly'}
            </StatusPill>
            {a.protected && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <StatusPill tone="info" dot={false} className="cursor-default">
                      <Lock className="size-3" /> Managed by Helo.ai
                    </StatusPill>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">The console reads this account and configures its AI agent, but never changes its webhooks, registration, PIN or billing.</TooltipContent>
              </Tooltip>
            )}
          </span>
        </div>
        <ul className="space-y-1 text-sm">
          {a.phoneNumbers.map((n) => (
            <li key={n.id}>
              {n.display || n.id}
              {n.verifiedName && <span className="text-muted-foreground"> &middot; {n.verifiedName}</span>}
            </li>
          ))}
        </ul>
        {!a.protected && <AccountSteps account={a} canEdit onChange={upsert} />}
        <details className="group text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">How this account maps to Helo.ai</summary>
          <AssetMap
            className="mt-2"
            flow={a.source === 'coexistence' ? 'coexistence' : 'new'}
            workspace={me?.workspace?.name ?? 'this workspace'}
            assets={{ businessId: a.businessId || undefined, wabaId: a.wabaId, phoneNumberId: a.primaryNumberId ?? a.phoneNumbers[0]?.id }}
          />
        </details>
      </section>

      <section aria-labelledby="live-events" className="space-y-2">
        <div>
          <h2 id="live-events" className="text-section font-semibold">
            Live events
          </h2>
          <p className="text-sm text-muted-foreground">How WhatsApp delivers customers’ messages, replies and delivery ticks to this console, and who else receives them.</p>
        </div>
        <WebhookStatusCard />
      </section>

      {a.canDisconnect && (
        <section aria-labelledby="danger-zone" className="space-y-2 rounded-lg border border-destructive/40 p-4">
          <h2 id="danger-zone" className="text-section font-semibold">
            Disconnect {a.wabaName}
          </h2>
          <p className="text-sm text-muted-foreground">Helo.ai stops sending and receiving for its numbers: the AI agent and inbox stop working there. The WhatsApp account stays yours, and you can connect it again.</p>
          <Button variant="outline" className="text-destructive" onClick={() => setRemoving(true)}>
            <Unplug className="size-4" /> Disconnect
          </Button>
        </section>
      )}
      <ConfirmDialog
        open={removing}
        title={`Disconnect ${a.wabaName}?`}
        description="Helo.ai stops sending and receiving for its numbers: the AI agent and inbox stop working there. The WhatsApp account stays yours, and you can connect it again later."
        confirmLabel="Disconnect"
        confirmText={a.wabaName}
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false)
          disconnectAccount(a.wabaId).then(
            () => {
              toast.success(`${a.wabaName} disconnected.`)
              onDisconnected()
            },
            (err) => toast.error(errorDetail(err)),
          )
        }}
      />
    </div>
  )
}
