import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { newId } from '@/app/wizard/mockData'
import type { AgentInstanceSummary } from '@/app/wizard/types'
import {
  checkEligibility,
  getAgentOnNumber,
  getServerHealth,
  listPhoneNumbers,
  listWabas,
  errorText,
  MetaError,
  onboardAgent,
  setActivePhoneNumberId,
} from '@/app/api/meta'
import { putStoredAgent } from '@/app/api/store'

// ---- WABA / phone number directory: Meta's, else the .env number, else a mock (offline demo) ----

interface PhoneOption {
  id: string
  phoneNumber: string
  verifiedName: string
}

interface WabaOption {
  id: string
  name: string
  /** Preset for the .env / mock fallbacks; Meta WABAs load their numbers on selection. */
  phoneNumbers?: PhoneOption[]
}

type DirectorySource = 'meta' | 'env' | 'mock'

const MOCK_WABA_DIRECTORY: WabaOption[] = [
  {
    id: 'waba_dir_1',
    name: 'Aurora Retail India',
    phoneNumbers: [
      { id: 'num_1', verifiedName: 'Support Line', phoneNumber: '+91 98765 43210' },
      { id: 'num_3', verifiedName: 'Returns Desk', phoneNumber: '+91 98765 43212' },
    ],
  },
  {
    id: 'waba_dir_2',
    name: 'Aurora Wellness Clinic',
    phoneNumbers: [
      { id: 'num_4', verifiedName: 'Front Desk', phoneNumber: '+91 90000 11122' },
      { id: 'num_5', verifiedName: 'Appointments', phoneNumber: '+91 90000 11123' },
    ],
  },
]

/** Black primary line, grey secondary line (PRD 5.2 AC4/AC5). */
function TwoLineOption({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <span className="flex flex-col items-start">
      <span className="text-foreground">{primary}</span>
      <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        {secondary}
      </span>
    </span>
  )
}

// ---- Mock eligibility API (real endpoint: GET /{phone_number_id}/agent_eligibility) ----

type ForcedOutcome = 'ready' | 'not_available' | 'our_error' | 'meta_busy' | 'meta_down'
type CheckStatus = 'idle' | 'checking' | 'ready' | 'not_available' | 'our_error' | 'meta_down'

type MockApiResult = { ok: true; isEligible: boolean } | { ok: false; httpCode: number }

function mockEligibilityCheck(outcome: ForcedOutcome): Promise<MockApiResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      switch (outcome) {
        case 'ready':
          resolve({ ok: true, isEligible: true })
          break
        case 'not_available':
          resolve({ ok: true, isEligible: false })
          break
        case 'our_error': {
          const codes = [400, 401, 404]
          resolve({ ok: false, httpCode: codes[Math.floor(Math.random() * codes.length)] })
          break
        }
        case 'meta_busy':
          resolve({ ok: false, httpCode: 429 })
          break
        case 'meta_down':
          resolve({ ok: false, httpCode: 500 })
          break
      }
    }, 1500)
  })
}

function openHelpPlaceholder() {
  toast('This would open a support ticket in the real product.')
}

export function CreateAgentModal({
  open,
  onClose,
  onCreate,
  existingAgentNames,
}: {
  open: boolean
  onClose: () => void
  /** phoneNumberId is Meta's id for the number; undefined for the offline mock directory. */
  onCreate: (agent: AgentInstanceSummary, phoneNumberId?: string, wabaId?: string) => void
  existingAgentNames: string[]
}) {
  const [agentName, setAgentName] = useState('')
  const [wabaId, setWabaId] = useState<string | null>(null)
  const [phoneId, setPhoneId] = useState<string | null>(null)
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle')
  const [forcedOutcome, setForcedOutcome] = useState<ForcedOutcome>('ready')
  const nameInputRef = useRef<HTMLInputElement>(null)

  useRegisterDevControls(
    'create-agent-modal',
    open ? (
      <DemoControlsGroup label="Create agent">
        <label htmlFor="demo-force-result" className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          Demo: force result
        </label>
        <select
          id="demo-force-result"
          value={forcedOutcome}
          onChange={(e) => setForcedOutcome(e.target.value as ForcedOutcome)}
          className="rounded border border-border bg-background"
          style={{ fontSize: 'var(--text-xs)' }}
        >
          <option value="ready">Ready</option>
          <option value="not_available">Not available</option>
          <option value="our_error">Our error (400/401/404)</option>
          <option value="meta_busy">Meta busy (429)</option>
          <option value="meta_down">Meta down (500)</option>
        </select>
      </DemoControlsGroup>
    ) : null,
  )

  const [wabas, setWabas] = useState<WabaOption[] | null>(null)
  const [source, setSource] = useState<DirectorySource>('meta')
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setWabas(null)
    listWabas().then(
      (list) => {
        if (cancelled) return
        setSource('meta')
        setWabas(list)
      },
      async (err) => {
        console.log('[listWabas]', errorText(err))
        const h = await getServerHealth()
        if (cancelled) return
        if (h?.wabaId && h.phoneNumberId) {
          setSource('env')
          setWabas([
            {
              id: h.wabaId,
              name: h.wabaName || h.businessName || `WABA ${h.wabaId}`,
              phoneNumbers: [
                {
                  id: h.phoneNumberId,
                  verifiedName: h.phoneName || 'Configured number',
                  phoneNumber: h.phoneNumber || `ID ${h.phoneNumberId}`,
                },
              ],
            },
          ])
        } else {
          setSource('mock')
          setWabas(MOCK_WABA_DIRECTORY)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [open])
  const selectedWaba = wabas?.find((w) => w.id === wabaId) ?? null

  // Numbers for the picked WABA, minus any that already have an agent (PRD 5.2 AC5a / V3a).
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneOption[] | null>(null)
  const [numbersFailed, setNumbersFailed] = useState(false)
  const [numbersAttempt, setNumbersAttempt] = useState(0)
  useEffect(() => {
    setNumbersFailed(false)
    if (!selectedWaba || selectedWaba.phoneNumbers) {
      setPhoneNumbers(selectedWaba?.phoneNumbers ?? null)
      return
    }
    let cancelled = false
    setPhoneNumbers(null)
    listPhoneNumbers(selectedWaba.id)
      .then((list) => Promise.all(list.map(async (n) => ((await getAgentOnNumber(n.id)) ? null : n))))
      .then(
        (free) => {
          if (cancelled) return
          setPhoneNumbers(
            free.flatMap((n) => (n ? [{ id: n.id, phoneNumber: n.displayPhoneNumber, verifiedName: n.verifiedName }] : [])),
          )
        },
        (err) => {
          if (cancelled) return
          console.log('[listPhoneNumbers]', errorText(err))
          setNumbersFailed(true)
        },
      )
    return () => {
      cancelled = true
    }
  }, [selectedWaba, numbersAttempt])
  const selectedPhone = phoneNumbers?.find((p) => p.id === phoneId) ?? null

  // Auto-select the WABA when the client only has one.
  useEffect(() => {
    if (open && wabas?.length === 1 && !wabaId) {
      setWabaId(wabas[0].id)
    }
  }, [open, wabaId, wabas])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => nameInputRef.current?.focus())
    }
  }, [open])

  function resetAll() {
    setAgentName('')
    setWabaId(null)
    setPhoneId(null)
    setCheckStatus('idle')
  }

  function handleClose() {
    resetAll()
    onClose()
  }

  function handleWabaChange(value: string) {
    setWabaId(value)
    setPhoneId(null)
    setCheckStatus('idle')
  }

  function handlePhoneChange(value: string) {
    setPhoneId(value)
    setCheckStatus('idle')
  }

  // Real call unless the Demo controls force a specific outcome.
  async function eligibilityCheck(): Promise<MockApiResult> {
    if (forcedOutcome !== 'ready' || source === 'mock' || !phoneId) return mockEligibilityCheck(forcedOutcome)
    try {
      const r = await checkEligibility(phoneId)
      return { ok: true, isEligible: r.is_eligible }
    } catch (err) {
      console.log('[agent_eligibility]', err instanceof Error ? err.message : err)
      return { ok: false, httpCode: err instanceof MetaError ? err.status : 500 }
    }
  }

  async function runCheck() {
    setCheckStatus('checking')
    let result = await eligibilityCheck()

    if (!result.ok && result.httpCode === 429) {
      console.log('[agent_eligibility] HTTP 429 — retrying once after 3s')
      await new Promise((r) => setTimeout(r, 3000))
      result = await eligibilityCheck()
    }

    if (result.ok) {
      setCheckStatus(result.isEligible ? 'ready' : 'not_available')
      return
    }

    console.log(`[agent_eligibility] HTTP ${result.httpCode}`)
    setCheckStatus(result.httpCode === 500 || result.httpCode === 429 ? 'meta_down' : 'our_error')
  }

  const trimmedName = agentName.trim()
  const isEmpty = trimmedName.length === 0
  const isDuplicate =
    !isEmpty && existingAgentNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())
  const nameError = isEmpty
    ? 'Please give your agent a name'
    : isDuplicate
      ? 'You already have an agent with this name'
      : null
  const canCreate = !isEmpty && !isDuplicate && checkStatus === 'ready' && Boolean(selectedWaba) && Boolean(selectedPhone)

  async function handleCreate() {
    if (!canCreate || !selectedWaba || !selectedPhone) return
    const realPhoneId = source === 'mock' ? undefined : selectedPhone.id
    if (realPhoneId) {
      setActivePhoneNumberId(realPhoneId)
      try {
        const { agent_id } = await onboardAgent(realPhoneId)
        toast.success('Agent created on Meta', { description: `agent_id ${agent_id}` })
      } catch (err) {
        // A number onboarded earlier (e.g. in WhatsApp Manager) rejects a second onboarding;
        // the existing agent is still usable, so carry on and say what Meta returned.
        toast.warning('Meta onboarding call failed', { description: err instanceof Error ? err.message : String(err) })
      }
    }
    if (realPhoneId) void putStoredAgent(realPhoneId, { wabaId: selectedWaba.id, displayName: trimmedName, createdAt: Date.now() })
    onCreate({
      id: newId('agent'),
      name: trimmedName,
      companyName: selectedWaba.name,
      phoneNumber: selectedPhone.phoneNumber,
      status: 'draft',
      connector: 'None',
      journeyProfile: '—',
      audienceMode: 'Allowlisted',
      allowlistCount: 0,
      evalScore: null,
      updatedAt: 'Just now',
    }, realPhoneId, source === 'mock' ? undefined : selectedWaba.id)
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create an AI agent</DialogTitle>
          <DialogDescription>
            Name it, pick the number it will answer on, then check that Meta allows it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="agent-name-modal">Agent name</Label>
              <InfoTooltip text="This is only for you. Customers never see it." />
            </span>
            <Input
              id="agent-name-modal"
              ref={nameInputRef}
              value={agentName}
              maxLength={60}
              aria-invalid={Boolean(nameError)}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Support agent"
            />
            {nameError && (
              <p className="text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>WhatsApp Business Account</Label>
            {!wabas ? (
              <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                <Loader2 className="size-4 animate-spin" />
                Loading your accounts&hellip;
              </div>
            ) : wabas.length === 1 ? (
              <div className="rounded-md border border-border px-3 py-2" style={{ fontSize: 'var(--text-sm)' }}>
                <TwoLineOption primary={wabas[0].name} secondary={wabas[0].id} />
              </div>
            ) : (
              <Select value={wabaId ?? undefined} onValueChange={handleWabaChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a WhatsApp Business Account">{selectedWaba?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {wabas.map((waba) => (
                    <SelectItem key={waba.id} value={waba.id}>
                      <TwoLineOption primary={waba.name} secondary={waba.id} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {source === 'env' && (
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Couldn&rsquo;t load your accounts from Meta; showing the number from settings.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Phone number</Label>
            <Select value={phoneId ?? undefined} onValueChange={handlePhoneChange} disabled={!wabaId || !phoneNumbers?.length}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    !wabaId
                      ? 'Select a WABA first'
                      : numbersFailed
                        ? 'Couldn’t load numbers'
                        : !phoneNumbers
                          ? 'Loading numbers…'
                          : phoneNumbers.length === 0
                            ? 'No numbers without an agent'
                            : 'Select a phone number'
                  }
                >
                  {selectedPhone?.phoneNumber}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {phoneNumbers?.map((num) => (
                  <SelectItem key={num.id} value={num.id}>
                    <TwoLineOption primary={num.phoneNumber} secondary={num.verifiedName} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {numbersFailed && (
              <div className="flex items-center gap-2">
                <p className="text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
                  Couldn&rsquo;t load this account&rsquo;s numbers from Meta.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setNumbersAttempt((n) => n + 1)}>
                  <RefreshCw className="size-3.5" />
                  Try again
                </Button>
              </div>
            )}
          </div>

          {selectedPhone && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              {checkStatus === 'idle' && <Button onClick={runCheck}>Check this number</Button>}

              {checkStatus === 'checking' && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span style={{ fontSize: 'var(--text-sm)' }}>Checking with Meta&hellip;</span>
                </div>
              )}

              {checkStatus === 'ready' && (
                <div className="flex items-center gap-2 rounded-md bg-success/10 p-2 text-success">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span style={{ fontSize: 'var(--text-sm)' }}>Number is eligible.</span>
                </div>
              )}

              {checkStatus === 'not_available' && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-destructive">
                    <XCircle className="mt-0.5 size-4 shrink-0" />
                    <span style={{ fontSize: 'var(--text-sm)' }}>
                      Number not eligible, please try another number or WABA profile.
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href="https://business.facebook.com/settings/" target="_blank" rel="noopener noreferrer">
                        Open Business Manager
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href="https://business.facebook.com/latest/whatsapp_manager/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open WhatsApp Manager
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={runCheck}>
                      <RefreshCw className="size-3.5" />
                      Check again
                    </Button>
                  </div>
                </div>
              )}

              {checkStatus === 'our_error' && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span style={{ fontSize: 'var(--text-sm)' }}>
                      Something went wrong on our end. Please try again.
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={runCheck}>
                      Try again
                    </Button>
                    <Button variant="ghost" size="sm" onClick={openHelpPlaceholder}>
                      Get help
                    </Button>
                  </div>
                </div>
              )}

              {checkStatus === 'meta_down' && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span style={{ fontSize: 'var(--text-sm)' }}>
                      Meta isn&rsquo;t responding right now. Try again shortly.
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={runCheck}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-md bg-muted p-3" style={{ fontSize: 'var(--text-sm)' }}>
            Once you switch this agent on, it becomes the main responder on this number. Meta
            charges for each message the AI sends. Nothing is charged until you switch it on.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canCreate}>
            Create agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
