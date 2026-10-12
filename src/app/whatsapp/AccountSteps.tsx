import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpRight, Check, Clock, Loader2, RotateCw, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { errorDetail } from '@/app/api/meta'
import { PAYMENT_URL, retryAccount, setBilling, STEP_LABEL, type StepName, type WaAccount } from '@/app/api/whatsapp'

const ORDER: StepName[] = ['exchange', 'subscribe', 'register', 'sync', 'details', 'billing']

/** What each setup step did: done, waiting on the business (its own payment method), failed with
 *  Retry, or expired (Meta's time for it passed, so no Retry). Owners act; everyone else reads. */
export function AccountSteps({ account, canEdit, onChange }: { account: WaAccount; canEdit: boolean; onChange: (a: WaAccount) => void }) {
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<WaAccount>) => {
    setBusy(true)
    try {
      onChange(await fn())
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  const retryable = ORDER.some((s) => account.steps[s]?.state === 'failed')
  const waitingForPayment = account.steps.billing?.state === 'waiting'
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5 text-sm">
        {ORDER.filter((s) => account.steps[s] && account.steps[s]!.state !== 'skipped').map((s) => {
          const st = account.steps[s]!
          return (
            <li key={s} className="flex items-start gap-2">
              {st.state === 'done' ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
              ) : st.state === 'waiting' ? (
                <Clock className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-label="Waiting on you" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label={st.state === 'expired' ? 'Too late to retry' : 'Failed'} />
              )}
              <span>
                {s === 'billing' ? (account.billing.mode === 'partner_credit' ? 'Billing through Helo.ai' : 'Your own payment method in Meta') : STEP_LABEL[s]}
                {st.state === 'waiting' && <span className="block text-xs text-muted-foreground">Waiting on you: add a payment method in WhatsApp Manager.</span>}
                {(st.state === 'failed' || st.state === 'expired') && st.error && <span className="block text-xs text-destructive">{st.error}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {canEdit && retryable && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => retryAccount(account.wabaId))}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          Retry the failed steps
        </Button>
      )}
      {canEdit && waitingForPayment && (
        <div className="space-y-2 rounded-md bg-muted px-3 py-2.5 text-sm">
          <p>Meta bills this business for its conversations. Add a payment method in WhatsApp Manager so the number can message customers.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href={PAYMENT_URL} target="_blank" rel="noreferrer">
                Add a payment method <ArrowUpRight className="size-3.5" />
              </a>
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void run(() => setBilling(account.wabaId, { mode: 'own', confirmed: true }))}>
              I&rsquo;ve added it
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
