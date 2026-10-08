import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { getBilling, setBudget, syncBilling, type Billing } from '@/app/api/billing'
import { formatMoney } from '@/app/lib/money'
import { SettingsSection } from './SettingsSection'
import { can } from '@/app/lib/permissions'

const FEATURE: Record<string, string> = { chat_summary: 'Chat summaries' }
const CATEGORY: Record<string, string> = { MARKETING: 'Marketing', UTILITY: 'Utility', AUTHENTICATION: 'Login codes', SERVICE: 'Service replies' }
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}

/** Last 30 days of spend as bars; hover shows the day's figures. */
function SpendBars({ days, currency }: { days: Billing['days']; currency: string | null }) {
  const max = Math.max(...days.map((d) => d.cost), 0)
  if (!days.length || max === 0) return <p className="text-muted-foreground text-sm">No paid messages in the last 30 days.</p>
  return (
    <div className="flex h-24 items-end gap-0.5" role="img" aria-label="WhatsApp spend per day, last 30 days">
      {days.map((d) => (
        <div
          key={d.day}
          className="flex-1 rounded-t-sm bg-primary/70 hover:bg-primary"
          style={{ height: `${Math.max(2, (d.cost / max) * 100)}%` }}
          title={`${new Date(d.day + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })}: ${formatMoney(d.cost, currency)} · ${d.volume} messages`}
        />
      ))}
    </div>
  )
}

/** Settings → Billing: what WhatsApp charged this month (Meta's own figures) and the budget alert. */
export function BillingSettingsTab() {
  const { me } = useAuth()
  const isOwner = can(me?.role, 'billing.manage')
  const [b, setB] = useState<Billing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [budget, setBudgetText] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    getBilling().then(
      (r) => {
        setB(r)
        setBudgetText(r.budget === null ? '' : String(r.budget))
      },
      (err) => setError(errorDetail(err)),
    )
  }, [])

  if (error) return <FormError>{error}</FormError>
  if (!b) return <Loader2 className="size-5 animate-spin text-muted-foreground" />
  const used = b.budget ? Math.min(1, b.month.total / b.budget) : 0

  return (
    <div>
      <SettingsSection title="This month" description="What WhatsApp charged for messages since the 1st, from Meta’s billing figures. Replies to customers within 24 hours are free." wide>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-[1.75rem] font-semibold">{formatMoney(b.month.total, b.currency)}</p>
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              {b.lastSyncError ? <span className="text-destructive">Last update failed: {b.lastSyncError}</span> : b.lastSyncAt ? <span>Updated {ago(b.lastSyncAt)}</span> : <span>Not updated yet</span>}
              <Button
                size="sm"
                variant="ghost"
                disabled={syncing}
                onClick={() => {
                  setSyncing(true)
                  syncBilling()
                    .then(setB, (err) => toast.error(errorDetail(err)))
                    .finally(() => setSyncing(false))
                }}
              >
                {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Update now
              </Button>
            </div>
          </div>
          {b.budget ? (
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={used >= 1 ? 'h-full bg-destructive' : used >= 0.8 ? 'h-full bg-amber-500' : 'h-full bg-primary'} style={{ width: `${used * 100}%` }} />
              </div>
              <p className="text-muted-foreground text-xs">
                {Math.round(used * 100)}% of your {formatMoney(b.budget, b.currency, 0)} budget
              </p>
            </div>
          ) : null}
          {b.month.byCategory.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {b.month.byCategory.map((c) => (
                <li key={c.category} className="flex justify-between px-3 py-2">
                  <span>{CATEGORY[c.category] ?? c.category}</span>
                  <span>{formatMoney(c.cost, b.currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              Last 30 days
            </p>
            <SpendBars days={b.days} currency={b.currency} />
          </div>
        </div>
      </SettingsSection>
      {b.messages && b.messages.billable + b.messages.free > 0 && (
        <SettingsSection title="Messages this month" description="As WhatsApp priced each message when it was delivered (from webhooks). Meta’s daily totals above are what you’re charged.">
          <dl className="space-y-2 text-sm">
            {b.messages.byCategory.map((c) => (
              <div key={c.category} className="flex justify-between gap-4">
                <dt className="capitalize text-muted-foreground">{c.category.replace(/_/g, ' ')}</dt>
                <dd className="tabular-nums">
                  {c.billable.toLocaleString()} billable{c.free ? ` · ${c.free.toLocaleString()} free` : ''}
                </dd>
              </div>
            ))}
          </dl>
        </SettingsSection>
      )}
      <SettingsSection title="AI usage" description="This month so far. Meta bills the AI agent’s own conversations; Helo.ai features like chat summaries use Claude and are counted in tokens here.">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">AI agent conversations (Meta)</dt>
            <dd>{b.ai.agentConversations === null ? 'Not collected yet' : b.ai.agentConversations.toLocaleString()}</dd>
          </div>
          {b.ai.agentUsage && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">AI agent tokens and cost (Meta)</dt>
              <dd className="text-right">
                {b.ai.agentUsage.state === 'ok' ? (
                  <>
                    {b.ai.agentUsage.billableTokens.toLocaleString()} tokens
                    <span className="block text-xs text-muted-foreground">
                      {b.ai.agentUsage.billableMessages.toLocaleString()} billable messages &middot; {formatMoney(b.ai.agentUsage.cost, b.currency)}
                    </span>
                  </>
                ) : b.ai.agentUsage.state === 'no_billable_account' ? (
                  <span className="text-muted-foreground">Meta reports this once the agent has a payment method</span>
                ) : b.ai.agentUsage.state ? (
                  <span className="text-muted-foreground">Meta didn’t answer; checked hourly</span>
                ) : (
                  'Not collected yet'
                )}
              </dd>
            </div>
          )}
          {b.ai.console.length === 0 ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Helo.ai AI features</dt>
              <dd>No use yet</dd>
            </div>
          ) : (
            b.ai.console.map((u) => (
              <div key={u.feature + u.model} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{FEATURE[u.feature] ?? u.feature}</dt>
                <dd className="text-right">
                  {(u.input + u.output).toLocaleString()} tokens
                  <span className="block text-muted-foreground text-xs">
                    {u.calls} uses &middot; {u.input.toLocaleString()} in, {u.output.toLocaleString()} out
                  </span>
                </dd>
              </div>
            ))
          )}
        </dl>
      </SettingsSection>
      <SettingsSection title="Monthly budget" description="Owners get an email and a notification at 80% and 100%. Messages keep sending; the budget only alerts you.">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            setSaving(true)
            setBudget(budget.trim() === '' ? null : Number(budget))
              .then((r) => {
                setB(r)
                toast.success(r.budget === null ? 'Budget removed.' : 'Budget saved.')
              }, (err) => toast.error(errorDetail(err)))
              .finally(() => setSaving(false))
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="budget">Budget per month{b.currency ? ` (${b.currency})` : ''}</Label>
            <Input id="budget" inputMode="decimal" value={budget} onChange={(e) => setBudgetText(e.target.value.replace(/[^\d.]/g, ''))} placeholder="No budget" disabled={!isOwner} />
          </div>
          {isOwner ? (
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save budget
            </Button>
          ) : (
            <p className="text-muted-foreground text-xs">
              Only owners can change the budget.
            </p>
          )}
        </form>
      </SettingsSection>
    </div>
  )
}
