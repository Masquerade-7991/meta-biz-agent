import { useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronsUpDown,
  CreditCard,
  ExternalLink,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Card, CardContent } from '@/app/components/ui/card'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/app/components/ui/command'
import { useWizard } from '@/app/wizard/WizardContext'
import { MOCK_WABAS } from '@/app/wizard/mockData'
import { cn } from '@/app/lib/utils'

const INELIGIBLE_REASONS: Record<string, string> = {
  Health: 'your declared vertical (Health) falling under Meta’s excluded categories',
  Finance: 'your declared vertical (Finance) falling under Meta’s excluded categories',
  Government: 'your declared vertical (Government) falling under Meta’s excluded categories',
}

function statusBadge(status: (typeof MOCK_WABAS)[number]['status']) {
  if (status === 'eligible') return <Badge className="bg-success text-success-foreground">Eligible</Badge>
  if (status === 'ineligible') return <Badge variant="destructive">Ineligible</Badge>
  return <Badge className="bg-warning/15 text-warning-foreground">Needs registration</Badge>
}

export function GateScreen({ onBack }: { onBack?: () => void }) {
  const { state, patch } = useWizard()
  const [open, setOpen] = useState(false)
  const [billingAttached, setBillingAttached] = useState<boolean | null>(null)
  const [attachingBilling, setAttachingBilling] = useState(false)

  const selected = MOCK_WABAS.find((w) => w.id === state.gate.selectedWabaId) ?? null
  const resolvedBilling = billingAttached ?? selected?.billingAttached ?? false

  function selectWaba(id: string) {
    const waba = MOCK_WABAS.find((w) => w.id === id)
    setBillingAttached(waba?.billingAttached ?? false)
    patch('gate', {
      selectedWabaId: id,
      pin: '',
      pinAttempted: false,
      pinError: null,
      registrationComplete: false,
    })
    setOpen(false)
  }

  function attachBilling() {
    setAttachingBilling(true)
    toast('Opening Meta’s Billing Hub…')
    setTimeout(() => {
      setBillingAttached(true)
      setAttachingBilling(false)
      toast.success('Payment method attached')
    }, 900)
  }

  function verifyPin() {
    if (!selected) return
    const isValid = state.gate.pin.length === 6 && state.gate.pin !== '000000'
    patch('gate', {
      pinAttempted: true,
      pinError: isValid ? null : 'That PIN was not accepted. Check the code and try again.',
      registrationComplete: isValid,
    })
  }

  const registered = selected ? selected.registered || state.gate.registrationComplete : false
  const eligible = selected?.status === 'eligible'
  const canStart = Boolean(selected) && eligible && registered && resolvedBilling

  function startConfiguring() {
    if (!selected) return
    patch('identity', { companyName: selected.displayName })
    patch('gate', {
      gatePassed: true,
      billingAttached: resolvedBilling,
      selectedPhoneNumber: selected.phoneNumber,
      selectedWabaName: selected.displayName,
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-6 flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm"
          >
            <ArrowLeft className="size-4" />
            Back to Helo
          </button>
        )}
        <p className="caption text-primary">Create agent</p>
        <h1 className="mt-1">Set up a Meta Business Agent</h1>
        <p className="mt-2 text-muted-foreground">
          Pick the WhatsApp number you are configuring. We will check that it can actually go
          live before you spend any time building.
        </p>

        <div className="mt-8 space-y-1.5">
          <Label htmlFor="waba-select">WhatsApp number</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id="waba-select"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                className="w-full justify-between font-normal"
              >
                {selected ? (
                  <span className="flex items-center gap-2 truncate">
                    <span className="truncate">
                      {selected.displayName} &middot; {selected.phoneNumber}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Search your connected numbers&hellip;</span>
                )}
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search by name or number..." />
                <CommandList>
                  <CommandEmpty>No numbers found.</CommandEmpty>
                  <CommandGroup>
                    {MOCK_WABAS.map((waba) => (
                      <CommandItem
                        key={waba.id}
                        value={`${waba.displayName} ${waba.phoneNumber}`}
                        onSelect={() => selectWaba(waba.id)}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {waba.displayName}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {waba.phoneNumber}
                          </span>
                        </span>
                        {statusBadge(waba.status)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {selected && (
          <div className="mt-6 space-y-3">
            {/* Eligibility row */}
            <Card>
              <CardContent className="flex items-start gap-3 py-4">
                {eligible ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Eligibility: {eligible ? 'Eligible' : 'Not eligible'}
                  </p>
                  {!eligible && (
                    <p className="mt-1 text-muted-foreground text-sm">
                      This number is not eligible. Based on your account details, this is most
                      likely because of {INELIGIBLE_REASONS[selected.vertical] ?? 'a conflicting messaging product already running on this number'}.{' '}
                      <span className="caption">Estimate, not confirmed by Meta.</span> Contact Helo
                      support to confirm.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Registration row */}
            <Card>
              <CardContent className="flex items-start gap-3 py-4">
                {registered ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Registration: {registered ? 'Registered' : 'Needs registration'}
                  </p>
                  {!registered && eligible && (
                    <div className="mt-2 flex items-end gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="pin" className="text-muted-foreground">
                          6-digit PIN
                        </Label>
                        <Input
                          id="pin"
                          inputMode="numeric"
                          maxLength={6}
                          value={state.gate.pin}
                          onChange={(e) =>
                            patch('gate', { pin: e.target.value.replace(/\D/g, '').slice(0, 6) })
                          }
                          className="w-32"
                          placeholder="000000"
                        />
                      </div>
                      <Button size="sm" variant="outline" onClick={verifyPin}>
                        Verify
                      </Button>
                    </div>
                  )}
                  {state.gate.pinAttempted && state.gate.pinError && (
                    <p className="mt-1 text-destructive text-sm">
                      {state.gate.pinError}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Billing row */}
            <Card>
              <CardContent className="flex items-start gap-3 py-4">
                {resolvedBilling ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <CreditCard className="mt-0.5 size-5 shrink-0 text-warning" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Billing: {resolvedBilling ? 'Payment method attached' : 'No payment method'}
                  </p>
                  {!resolvedBilling && (
                    <>
                      <p className="mt-1 text-muted-foreground text-sm">
                        A payment method must be attached in Meta&rsquo;s Billing Hub before this
                        agent can send a single message.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={attachBilling}
                        disabled={attachingBilling}
                      >
                        {attachingBilling ? 'Opening Billing Hub…' : 'Attach a payment method'}
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className={cn('mt-8 flex items-center gap-3', !selected && 'opacity-0')}>
          <Button size="lg" disabled={!canStart} onClick={startConfiguring}>
            <ShieldCheck className="size-4" />
            Start configuring
          </Button>
          {selected && !canStart && (
            <p className="text-muted-foreground text-sm">
              Resolve the checks above to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
