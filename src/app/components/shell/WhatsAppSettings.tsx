import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, Unplug } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { disconnectAccount, listAccounts, revealPin, type WaAccount } from '@/app/api/whatsapp'
import { AccountSteps } from '@/app/whatsapp/ConnectWhatsApp'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { SettingsSection } from './SettingsSection'
import { WebhookStatusCard } from '@/app/whatsapp/WebhookStatusCard'
import { TEXT_SM } from '@/app/lib/text'
import { can } from '@/app/lib/permissions'

const SOURCE: Record<WaAccount['source'], string> = { env: 'Set up by Helo.ai', signup: 'Connected with Embedded Signup', coexistence: 'WhatsApp Business app number' }

function AccountCard({ a, isOwner, onChange, onRemove }: { a: WaAccount; isOwner: boolean; onChange: (a: WaAccount) => void; onRemove: () => void }) {
  const [pin, setPin] = useState<string | null>(null)
  return (
    <li className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-semi-bold)' }}>{a.wabaName}</p>
          <p className="text-muted-foreground text-xs">
            {SOURCE[a.source]}
          </p>
        </div>
        <span className="flex flex-wrap gap-1">
          {a.needsAttention ? <Badge className="bg-warning/15 text-warning-foreground">Needs attention</Badge> : <Badge className="bg-success text-success-foreground">Connected</Badge>}
          <Badge variant="secondary">{a.billing.mode === 'partner_credit' ? 'Billed through Helo.ai' : 'Pays Meta directly'}</Badge>
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
      {a.source !== 'env' && <AccountSteps account={a} canEdit={isOwner} onChange={onChange} />}
      {isOwner && (a.hasPin || a.canDisconnect) && (
        <div className="flex flex-wrap items-center gap-2">
          {a.hasPin &&
            (pin ? (
              <span className="rounded-md bg-muted px-2 py-1 font-mono tracking-widest text-sm">
                PIN {pin}
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void revealPin(a.wabaId).then((r) => setPin(r.pin), (err) => toast.error(errorDetail(err)))}>
                <Eye className="size-4" />
                Show two-step PIN
              </Button>
            ))}
          {a.canDisconnect && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
              <Unplug className="size-4" />
              Disconnect
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

/** Settings → WhatsApp: each account's billing, PIN and disconnect; numbers live on the WhatsApp page. */
export function WhatsAppSettings({ onManageNumbers }: { onManageNumbers?: () => void }) {
  const { me } = useAuth()
  const isOwner = can(me?.role, 'whatsapp.manage')
  const [rows, setRows] = useState<WaAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<WaAccount | null>(null)
  useEffect(() => {
    listAccounts().then(setRows, (err) => setError(errorDetail(err)))
  }, [])
  const upsert = (a: WaAccount) => setRows((prev) => [...(prev ?? []).filter((x) => x.wabaId !== a.wabaId), a])

  return (
    <div>
      <SettingsSection wide title="WhatsApp accounts" description="Billing, PIN and disconnecting, per WhatsApp account. Numbers, their profiles and connecting a new one are on the WhatsApp page.">
        {onManageNumbers && can(me?.role, 'numbers.view') && (
          <Button variant="outline" size="sm" className="mb-3" onClick={onManageNumbers}>
            {rows?.length ? 'Manage numbers on the WhatsApp page' : 'Connect a number on the WhatsApp page'} &rarr;
          </Button>
        )}
        {error ? (
          <FormError>{error}</FormError>
        ) : !rows ? (
          <PageLoader context="whatsapp" className="min-h-[30vh] py-10" />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
            No WhatsApp number connected yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((a) => (
              <AccountCard key={a.wabaId} a={a} isOwner={isOwner} onChange={upsert} onRemove={() => setRemoving(a)} />
            ))}
          </ul>
        )}
      </SettingsSection>
      {!!rows?.length && (
        <SettingsSection wide title="Customer messages" description="WhatsApp delivers customers’ messages, photos and delivery ticks to this app by webhook.">
          <WebhookStatusCard />
        </SettingsSection>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Disconnect ${removing?.wabaName}?`}
        description="Helo.ai stops sending and receiving for its numbers: the AI agent, inbox and broadcasts stop working there. The WhatsApp account stays yours, and you can connect it again later."
        confirmLabel="Disconnect"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const a = removing!
          setRemoving(null)
          disconnectAccount(a.wabaId).then(
            () => {
              setRows((prev) => prev?.filter((x) => x.wabaId !== a.wabaId) ?? prev)
              toast.success(`${a.wabaName} disconnected.`)
            },
            (err) => toast.error(errorDetail(err)),
          )
        }}
      />
    </div>
  )
}
