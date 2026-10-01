import { Fragment, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileText, Info } from 'lucide-react'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Button } from '@/app/components/ui/button'
import { Separator } from '@/app/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { SaveButton } from '@/app/components/wizard/SaveButton'
import { UnsavedChangesDialog } from '@/app/components/wizard/UnsavedChangesDialog'
import { LoadFailedBanner, LoadingIndicator, SaveFailedBanner, SavingIndicator } from '@/app/components/wizard/RetryBanner'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useSaveOnNextSection } from '@/app/wizard/useSaveOnNextSection'
import {
  ADVANCED_PERSONAS,
  DEFAULT_BUSINESS_HOURS,
  PAYMENT_METHOD_OPTIONS,
  SAMPLE_BUSINESS_PROFILE,
  SAMPLE_PAYMENT_TEXT_FROM_ELSEWHERE,
  SERVICES_TYPE_CATEGORIES,
  TIME_OPTIONS,
} from '@/app/wizard/mockData'
import { composeBusinessHoursSentence, composePaymentSentence } from '@/app/wizard/format'
import type { BusinessHourRow, BusinessState, Day, PaymentMethodId } from '@/app/wizard/types'
import { FIELD_LABELS, hasHoursData, isFieldEmpty } from '@/app/wizard/validation'
import { cn } from '@/app/lib/utils'

const MAX_DESCRIPTION = 500
const MAX_POLICY = 1000
const MAX_ADDRESS = 300
const MAX_OTHER = 60
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const POLICY_COPY = {
  returnPolicy: {
    label: 'Cancellations & refunds',
    placeholder: 'e.g. 7 day returns, or free cancellation up to 24 hours before',
    helper: 'Your cancellation or return window, and how refunds are issued.',
    example:
      '7 day returns on unused items with original packaging. Refunds go back to the original payment method within 5 working days. No returns on innerwear or customised items.',
  },
  purchaseInfo: {
    label: 'How customers buy or book',
    placeholder: 'e.g. Order on our website or WhatsApp',
    helper: 'The steps a customer takes to place an order or make a booking with you.',
    example:
      'Order on our website or right here on WhatsApp. Share the product name and your address, and we will confirm price and delivery time before you pay.',
  },
  deliveryAndShipping: {
    label: 'Delivery or fulfilment',
    placeholder: 'e.g. 2 to 5 days across India, or on-site at your service area',
    helper: 'How you get orders or services to customers, how long it takes, and what it costs.',
    example:
      'We deliver across India. Metro cities in 2 to 3 days, everywhere else in 5 to 7 days. Free delivery on orders above Rs 999, otherwise Rs 49.',
  },
} as const

type PolicyKey = keyof typeof POLICY_COPY

function getClearedFields(saved: BusinessState, current: BusinessState): string[] {
  return Object.keys(FIELD_LABELS).filter((key) => !isFieldEmpty(key, saved) && isFieldEmpty(key, current)).map((key) => FIELD_LABELS[key])
}

function AssembledBox({ text, warning }: { text: string; warning?: string | null }) {
  return (
    <div className="space-y-2 rounded-lg bg-muted p-3">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="caption text-muted-foreground">What we will tell the agent</p>
          <p style={{ fontSize: 'var(--text-sm)' }}>{text}</p>
        </div>
      </div>
      {warning && (
        <p className="flex items-center gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          <AlertTriangle className="size-3.5 shrink-0" /> {warning}
        </p>
      )}
    </div>
  )
}

/** Merges a field's (i) helper text and its "see an example" affordance into one click-triggered
 *  popover — a tooltip can't reliably host the clickable "Use this example" button inside it. */
function PolicyHelpPopover({
  helper,
  example,
  onUseExample,
  defaultOpen,
}: {
  helper: string
  example: string
  onUseExample: () => void
  defaultOpen?: boolean
}) {
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
          aria-label="More information"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" side="top" align="start">
        <p style={{ fontSize: 'var(--text-sm)' }}>{helper}</p>
        <div className="space-y-2 rounded-lg bg-muted p-3">
          <p style={{ fontSize: 'var(--text-sm)' }}>{example}</p>
          <Button size="sm" variant="outline" onClick={onUseExample}>
            Use this example
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function BusinessProfileStep() {
  const { state, patch } = useWizard()
  const { business } = state
  const businessRef = useRef(business)
  useEffect(() => {
    businessRef.current = business
  }, [business])

  const category = state.demo.businessCategory
  const isServicesType = SERVICES_TYPE_CATEGORIES.includes(category)

  const [hoursExpanded, setHoursExpanded] = useState(business.businessHoursEnabled)
  useEffect(() => {
    if (business.businessHoursEnabled) setHoursExpanded(true)
    // Only reacts to a freshly-loaded/loaded-with-sample-data profile turning hours on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.businessHoursEnabled])

  const [pendingClearedFields, setPendingClearedFields] = useState<string[] | null>(null)
  const clearingResolverRef = useRef<((result: boolean) => void) | null>(null)

  function askClearing(fields: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      clearingResolverRef.current = resolve
      setPendingClearedFields(fields)
    })
  }

  function resolveClearing(result: boolean) {
    setPendingClearedFields(null)
    clearingResolverRef.current?.(result)
    clearingResolverRef.current = null
  }

  const section = useSaveOnNextSection('business', {
    confirmSave: async (saved, current) => {
      const cleared = getClearedFields(saved, current)
      if (cleared.length === 0) return true
      return askClearing(cleared)
    },
  })

  function simulateLoadSuccess(sample: Partial<BusinessState>) {
    section.setLoadStatus('loading')
    setTimeout(() => {
      patch('business', sample)
      const merged = { ...businessRef.current, ...sample }
      section.setSavedSnapshot(merged)
      section.setLoadStatus('loaded')
    }, 900)
  }

  const { loadStatus, saveStatus, forceSaveFailure, setForceSaveFailure, simulateLoadFailure, retryLoad, performSave, loading } = section

  // ---- Field helpers ----
  const [emailTouched, setEmailTouched] = useState(false)
  const emailInvalid = emailTouched && business.contactEmail.trim().length > 0 && !EMAIL_RE.test(business.contactEmail)

  // Personas who asked for more control up front (setup front door, Screen 1) see each field's
  // helper popover already open, instead of requiring a click to reach it.
  const advancedDefault = state.identity.persona !== null && ADVANCED_PERSONAS.includes(state.identity.persona)
  const [pendingExample, setPendingExample] = useState<{ key: PolicyKey; text: string } | null>(null)

  function requestApplyExample(key: PolicyKey, text: string) {
    if (business[key].trim().length > 0 && business[key].trim() !== text.trim()) {
      setPendingExample({ key, text })
    } else {
      patch('business', { [key]: text })
    }
  }

  // ---- Payments ----
  const [otherOpen, setOtherOpen] = useState(business.paymentMethods.includes('other'))
  const [pendingReplaceWithChips, setPendingReplaceWithChips] = useState(false)

  function togglePayment(id: PaymentMethodId) {
    if (id === 'other') {
      const turningOn = !business.paymentMethods.includes('other')
      setOtherOpen(turningOn)
      patch('business', {
        paymentMethods: turningOn
          ? [...business.paymentMethods, 'other']
          : business.paymentMethods.filter((m) => m !== 'other'),
        paymentOtherText: turningOn ? business.paymentOtherText : '',
      })
      return
    }
    const has = business.paymentMethods.includes(id)
    patch('business', {
      paymentMethods: has ? business.paymentMethods.filter((m) => m !== id) : [...business.paymentMethods, id],
    })
  }

  function updateOtherText(value: string) {
    patch('business', {
      paymentOtherText: value,
      paymentMethods: value.trim()
        ? business.paymentMethods.includes('other')
          ? business.paymentMethods
          : [...business.paymentMethods, 'other']
        : business.paymentMethods.filter((m) => m !== 'other'),
    })
    if (!value.trim()) setOtherOpen(false)
  }

  // ---- Hours ----
  function updateHourRow(day: Day, rowPatch: Partial<BusinessHourRow>) {
    const nextHours = business.businessHours.map((row) => (row.day === day ? { ...row, ...rowPatch } : row))
    patch('business', { businessHours: nextHours, businessHoursEnabled: hasHoursData(nextHours) })
  }

  function applySameTimeEveryDay() {
    const nextHours = business.businessHours.map((row) => ({ ...row, closed: false, open: '09:00', close: '18:00' }))
    patch('business', { businessHours: nextHours, businessHoursEnabled: true })
  }

  function applyClosedWeekends() {
    const nextHours = business.businessHours.map((row) =>
      row.day === 'Sat' || row.day === 'Sun' ? { ...row, closed: true, open: '', close: '' } : row,
    )
    patch('business', { businessHours: nextHours, businessHoursEnabled: hasHoursData(nextHours) })
  }

  const [pendingRemoveHours, setPendingRemoveHours] = useState(false)

  function confirmRemoveHours() {
    patch('business', { businessHours: DEFAULT_BUSINESS_HOURS, businessHoursEnabled: false })
    setHoursExpanded(false)
    setPendingRemoveHours(false)
  }

  const hoursSentence = business.businessHoursEnabled ? composeBusinessHoursSentence(business.businessHours) : ''
  const allDaysClosed = business.businessHoursEnabled && hoursSentence === 'Closed every day'

  const paymentSentence =
    business.paymentSource === 'text' ? business.paymentPlainText : composePaymentSentence(business.paymentMethods, business.paymentOtherText)

  const policyOrder: PolicyKey[] = isServicesType
    ? ['purchaseInfo', 'returnPolicy', 'deliveryAndShipping']
    : ['returnPolicy', 'purchaseInfo', 'deliveryAndShipping']

  useRegisterDevControls(
    'business',
    <DemoControlsGroup label="Business details">
      <Button variant="outline" size="sm" onClick={() => simulateLoadSuccess(SAMPLE_BUSINESS_PROFILE)}>
        Load saved profile
      </Button>
      <Button variant="outline" size="sm" onClick={simulateLoadFailure}>
        Force load failure
      </Button>
      <label className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        <input type="checkbox" checked={forceSaveFailure} onChange={(e) => setForceSaveFailure(e.target.checked)} />
        Force save failure
      </label>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          simulateLoadSuccess({
            paymentMethods: [],
            paymentOtherText: '',
            paymentSource: 'text',
            paymentPlainText: SAMPLE_PAYMENT_TEXT_FROM_ELSEWHERE,
          })
        }
      >
        Payment text from elsewhere
      </Button>
    </DemoControlsGroup>,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <SaveButton dirty={section.dirty} saving={saveStatus === 'saving'} onSave={performSave} />
      </div>

      {loadStatus === 'failed' && (
        <LoadFailedBanner
          message="We could not load your saved details. Anything you enter now will be saved, but it may overwrite details saved earlier."
          onRetry={retryLoad}
        />
      )}

      {saveStatus === 'failed' && (
        <SaveFailedBanner message="We could not save your details. Nothing has been lost." onRetry={() => void performSave()} />
      )}

      {saveStatus === 'saving' && <SavingIndicator />}
      {loading && <LoadingIndicator label="Loading your saved details" />}

      <div className={cn('space-y-10', loading && 'pointer-events-none opacity-50')} aria-hidden={loading}>
        {/* Section 1 */}
        <section className="space-y-6">
          <span className="flex items-center gap-1.5">
            <h3>About your business</h3>
            <InfoTooltip text="General background the agent can draw on in any conversation." />
          </span>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Label htmlFor="business-description">Business description</Label>
                <InfoTooltip text="Background about the business. What the agent does is set in step 1, Your agent. What you sell, who you serve, and anything customers often ask about." />
              </span>
              {business.businessDescription.length > 400 && (
                <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {business.businessDescription.length}/{MAX_DESCRIPTION}
                </span>
              )}
            </div>
            <Textarea
              id="business-description"
              rows={4}
              maxLength={MAX_DESCRIPTION}
              disabled={loading}
              value={business.businessDescription}
              onChange={(e) => patch('business', { businessDescription: e.target.value })}
              placeholder="e.g. We sell handmade candles and home fragrance"
              className="bg-input-background shadow-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Payment methods</Label>

            {business.paymentSource === 'text' ? (
              <div className="space-y-1.5">
                <Textarea readOnly rows={2} value={business.paymentPlainText} className="bg-muted text-muted-foreground" />
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  These payment details were entered elsewhere.{' '}
                  <button
                    type="button"
                    className="text-primary underline"
                    onClick={() => setPendingReplaceWithChips(true)}
                  >
                    Replace with chips
                  </button>
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {PAYMENT_METHOD_OPTIONS.map((option) => {
                    const active = business.paymentMethods.includes(option.id as PaymentMethodId)
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={loading}
                        onClick={() => togglePayment(option.id as PaymentMethodId)}
                        className={cn(
                          'badge rounded-full border px-3 py-1.5 transition-colors',
                          active
                            ? 'border-primary bg-accent text-accent-foreground'
                            : 'border-border bg-background text-muted-foreground hover:border-primary/50',
                        )}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                  {otherOpen && (
                    <Input
                      autoFocus
                      value={business.paymentOtherText}
                      maxLength={MAX_OTHER}
                      disabled={loading}
                      onChange={(e) => updateOtherText(e.target.value)}
                      placeholder="e.g. Bank transfer, EMI"
                      className="h-8 w-48"
                    />
                  )}
                </div>
                {business.paymentMethods.length > 0 && paymentSentence && <AssembledBox text={paymentSentence} />}
              </>
            )}
          </div>
        </section>

        {/* Section 2 */}
        <section className="space-y-6">
          <span className="flex items-center gap-1.5">
            <h3>Your policies</h3>
            <InfoTooltip text="Fill in what applies to your business. Skip what does not." />
          </span>

          {policyOrder.map((key, i) => {
            const copy = POLICY_COPY[key]
            return (
              <Fragment key={key}>
                {isServicesType && i === 1 && (
                  <div className="flex items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="shrink-0 caption text-muted-foreground">More policies, if they apply to you</span>
                    <Separator className="flex-1" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Label htmlFor={key}>{copy.label}</Label>
                      <PolicyHelpPopover
                        helper={copy.helper}
                        example={copy.example}
                        defaultOpen={advancedDefault}
                        onUseExample={() => requestApplyExample(key, copy.example)}
                      />
                    </span>
                    {business[key].length > 800 && (
                      <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        {business[key].length}/{MAX_POLICY}
                      </span>
                    )}
                  </div>
                  <Textarea
                    id={key}
                    rows={3}
                    maxLength={MAX_POLICY}
                    disabled={loading}
                    value={business[key]}
                    onChange={(e) => patch('business', { [key]: e.target.value })}
                    placeholder={copy.placeholder}
                    className="bg-input-background shadow-sm"
                  />
                </div>
              </Fragment>
            )
          })}
        </section>

        {/* Section 3 */}
        <section className="space-y-6">
          <span className="flex items-center gap-1.5">
            <h3>How customers reach you</h3>
            <InfoTooltip text="Contact and location details the agent can share with customers." />
          </span>

          <div className="space-y-1.5">
            <Label htmlFor="contact-email">Contact email</Label>
            <Input
              id="contact-email"
              type="email"
              disabled={loading}
              value={business.contactEmail}
              aria-invalid={emailInvalid}
              onChange={(e) => patch('business', { contactEmail: e.target.value })}
              onBlur={() => setEmailTouched(true)}
              placeholder="support@yourbusiness.com"
            />
            {emailInvalid && (
              <p className="text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                This does not look like an email address
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="business-address">Business address</Label>
              <InfoTooltip text="Written the way you would say it to a customer, for example “Shop 4, Link Road, Bandra West, Mumbai 400050”. Where your business is located, if customers can visit or send things there." />
            </span>
            <Textarea
              id="business-address"
              rows={2}
              maxLength={MAX_ADDRESS}
              disabled={loading}
              value={business.businessAddress}
              onChange={(e) => patch('business', { businessAddress: e.target.value })}
              placeholder="e.g. Shop 4, Link Road, Bandra West"
              className="bg-input-background shadow-sm"
            />
          </div>

          <div className="space-y-3">
            <div>
              <span className="flex items-center gap-1.5">
                <Label>Business hours</Label>
                <InfoTooltip text="These are your business hours, not the agent’s. The agent is available at all times." />
              </span>
            </div>

            {!hoursExpanded ? (
              <button
                type="button"
                onClick={() => setHoursExpanded(true)}
                className="text-primary"
                style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}
              >
                + Add business hours
              </button>
            ) : (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={applySameTimeEveryDay}>
                    Same time every day
                  </Button>
                  <Button variant="outline" size="sm" onClick={applyClosedWeekends}>
                    Closed on weekends
                  </Button>
                </div>

                <div className="space-y-2">
                  {business.businessHours.map((row) => (
                    <div key={row.day} className="flex flex-wrap items-center gap-3">
                      <span className="w-24 shrink-0" style={{ fontSize: 'var(--text-sm)' }}>
                        {row.day === 'Mon' && 'Monday'}
                        {row.day === 'Tue' && 'Tuesday'}
                        {row.day === 'Wed' && 'Wednesday'}
                        {row.day === 'Thu' && 'Thursday'}
                        {row.day === 'Fri' && 'Friday'}
                        {row.day === 'Sat' && 'Saturday'}
                        {row.day === 'Sun' && 'Sunday'}
                      </span>
                      <Select
                        value={row.open || undefined}
                        disabled={row.closed}
                        onValueChange={(value) => updateHourRow(row.day, { open: value })}
                      >
                        <SelectTrigger className="w-28"><SelectValue placeholder="--:--" /></SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>to</span>
                      <Select
                        value={row.close || undefined}
                        disabled={row.closed}
                        onValueChange={(value) => updateHourRow(row.day, { close: value })}
                      >
                        <SelectTrigger className="w-28"><SelectValue placeholder="--:--" /></SelectTrigger>
                        <SelectContent>
                          {TIME_OPTIONS.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-sm)' }}>
                        <input
                          type="checkbox"
                          checked={row.closed}
                          onChange={(e) => updateHourRow(row.day, { closed: e.target.checked, open: '', close: '' })}
                        />
                        Closed
                      </label>
                    </div>
                  ))}
                </div>

                {hasHoursData(business.businessHours) && (
                  <AssembledBox
                    text={hoursSentence}
                    warning={allDaysClosed ? 'Are you sure? This tells the agent you are never open.' : null}
                  />
                )}

                <button
                  type="button"
                  onClick={() => setPendingRemoveHours(true)}
                  className="text-primary"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  Remove hours
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Example overwrite confirm */}
      <Dialog open={pendingExample !== null} onOpenChange={(open) => !open && setPendingExample(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your text?</DialogTitle>
            <DialogDescription>This will replace what you have written. Continue?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingExample(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (pendingExample) patch('business', { [pendingExample.key]: pendingExample.text })
                setPendingExample(null)
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace-with-chips confirm */}
      <Dialog open={pendingReplaceWithChips} onOpenChange={setPendingReplaceWithChips}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace with chips?</DialogTitle>
            <DialogDescription>
              This will clear your current payment details and start again. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingReplaceWithChips(false)}>Cancel</Button>
            <Button
              onClick={() => {
                patch('business', { paymentSource: 'chips', paymentPlainText: '', paymentMethods: [], paymentOtherText: '' })
                setPendingReplaceWithChips(false)
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove hours confirm */}
      <Dialog open={pendingRemoveHours} onOpenChange={setPendingRemoveHours}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove business hours?</DialogTitle>
            <DialogDescription>This will remove your opening hours. Continue?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemoveHours(false)}>Cancel</Button>
            <Button onClick={confirmRemoveHours}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsavedChangesDialog open={section.unsavedDialogOpen} onResolve={section.resolveUnsaved} />

      <Dialog open={pendingClearedFields !== null} onOpenChange={(open) => !open && resolveClearing(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>You have cleared: {pendingClearedFields?.join(', ')}.</DialogTitle>
            <DialogDescription>These details will be removed. Save anyway?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => resolveClearing(false)}>Go back</Button>
            <Button onClick={() => resolveClearing(true)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
