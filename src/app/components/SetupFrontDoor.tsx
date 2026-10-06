import { useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { SelectableCard } from '@/app/components/wizard/SelectableCard'
import { addWebsite, errorText, trackCrawl, websiteFields } from '@/app/api/meta'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useWizard } from '@/app/wizard/WizardContext'
import {
  BUSINESS_CATEGORY_OPTIONS,
  CATEGORY_SUGGESTIONS,
  FAQ_STARTER_SUGGESTIONS,
  PERSONA_OPTIONS,
  composeBusinessDescription,
  composeSentence,
  getCapabilityCards,
  newId,
  type CapabilityCard,
  type SignalId,
} from '@/app/wizard/mockData'
import type { IdentityState, PersonaId, WebsiteSource } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

const TOTAL_SCREENS = 5

function normalizeWebsiteUrl(input: string): string {
  return /^https?:\/\//i.test(input) ? input : `https://${input}`
}

function isWebsiteShapeValid(url: string): boolean {
  return /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}([/:?#].*)?$/.test(url)
}

function getHostname(url: string): string {
  try {
    return new URL(normalizeWebsiteUrl(url)).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function CategorySelect({ value, onChange }: { value: string | null; onChange: (value: string) => void }) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pick a category" />
      </SelectTrigger>
      <SelectContent>
        {BUSINESS_CATEGORY_OPTIONS.filter((c) => c !== 'No category').map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ScreenPersona({ onSelect }: { onSelect: (id: PersonaId) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h2>Quick question before we start</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          This just helps us show you the right things first. You can explore everything either way.
        </p>
      </div>
      <div className="space-y-3">
        {PERSONA_OPTIONS.map((option) => (
          <SelectableCard
            key={option.id}
            title={option.title}
            helper={option.helper}
            selected={false}
            onClick={() => onSelect(option.id)}
            large
          />
        ))}
      </div>
    </div>
  )
}

function ScreenBusiness({
  businessName,
  onBusinessNameChange,
  website,
  onWebsiteChange,
  onContinue,
}: {
  businessName: string
  onBusinessNameChange: (value: string) => void
  website: string
  onWebsiteChange: (value: string) => void
  onContinue: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2>Tell us about your business</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          We&rsquo;ll use this to suggest a starting point. Nothing here is final.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fd-business-name">Business name</Label>
        <Input
          id="fd-business-name"
          value={businessName}
          onChange={(e) => onBusinessNameChange(e.target.value)}
          placeholder="e.g. Aurora Home Goods"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="fd-website">
          Website <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="fd-website"
          value={website}
          onChange={(e) => onWebsiteChange(e.target.value)}
          placeholder="https://yourbusiness.com"
        />
        <p className="text-muted-foreground text-xs">
          If you have one, we&rsquo;ll use it to suggest what your agent should know and do.
        </p>
      </div>
      <Button onClick={onContinue} className="w-full">
        Continue
      </Button>
    </div>
  )
}

function ScreenFound({
  businessName,
  displayCategory,
  onCategoryChange,
  website,
  onContinue,
}: {
  businessName: string
  displayCategory: string | null
  onCategoryChange: (value: string) => void
  website: string
  onContinue: () => void
}) {
  const [changingCategory, setChangingCategory] = useState(false)
  const hasWebsite = website.trim().length > 0

  if (displayCategory) {
    return (
      <div className="space-y-5">
        <h2>Here&rsquo;s what we&rsquo;re starting with</h2>
        <div className="space-y-1.5 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Business:</span>
            <span>{businessName.trim() || 'Not provided'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Category:</span>
            <span>{displayCategory}</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            This comes from your account. Not what you expected?{' '}
            <button type="button" onClick={() => setChangingCategory(true)} className="text-primary underline">
              Change category
            </button>
          </p>
          {changingCategory && (
            <CategorySelect
              value={displayCategory}
              onChange={(v) => {
                onCategoryChange(v)
                setChangingCategory(false)
              }}
            />
          )}
        </div>
        {hasWebsite && (
          <p className="text-sm">
            We&rsquo;ll suggest adding {getHostname(website)} as a knowledge source in step 2, once you confirm at
            the end.
          </p>
        )}
        <Button onClick={onContinue} className="w-full">
          Continue
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm">
        We don&rsquo;t have enough to suggest a category yet. That&rsquo;s fine, pick what fits best:
      </p>
      <CategorySelect value={null} onChange={onCategoryChange} />
      <Button onClick={onContinue} className="w-full">
        Continue
      </Button>
    </div>
  )
}

function ScreenCapabilities({
  cards,
  selectedIds,
  onToggle,
  onContinue,
}: {
  cards: CapabilityCard[]
  selectedIds: string[]
  onToggle: (id: string) => void
  onContinue: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2>What should your agent handle?</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Pick what applies. This sets your starting point in step 1 and step 2, you can add or remove anything
          later.
        </p>
      </div>
      <div className="space-y-3">
        {cards.map((card) => (
          <SelectableCard
            key={card.id}
            title={card.title}
            helper={card.helper}
            selected={selectedIds.includes(card.id)}
            onClick={() => onToggle(card.id)}
            large
          />
        ))}
      </div>
      {selectedIds.length === 0 && (
        <p className="text-muted-foreground text-xs">
          That&rsquo;s fine, you can start from scratch in the wizard.
        </p>
      )}
      <Button onClick={onContinue} className="w-full">
        Continue
      </Button>
    </div>
  )
}

interface SummaryRow {
  label: string
  lines: string[]
}

function ScreenSummary({
  rows,
  onBack,
  onStartBuilding,
}: {
  rows: SummaryRow[]
  onBack: () => void
  onStartBuilding: () => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2>Here&rsquo;s your starting point</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Review what we&rsquo;ll set up. Everything here can be changed once you&rsquo;re in the wizard.
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-border p-4">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,140px)_1fr] gap-3 text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <div>
              {row.lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        This is a starting point, not a finished agent. Review and adjust anything in the steps ahead.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button onClick={onStartBuilding} className="flex-1">
          Start building
        </Button>
      </div>
    </div>
  )
}

export function SetupFrontDoor({ onFinish }: { onFinish: () => void }) {
  const { state, patch } = useWizard()
  const [screenIndex, setScreenIndex] = useState(0)
  const [persona, setPersona] = useState<PersonaId | null>(null)
  const [businessName, setBusinessName] = useState(state.identity.companyName || '')
  const [website, setWebsite] = useState('')
  const [categoryOverride, setCategoryOverride] = useState<string | null>(null)
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<string[]>([])

  const knownCategory = state.demo.businessCategory !== 'No category' ? state.demo.businessCategory : null
  const displayCategory = categoryOverride ?? knownCategory
  const workingCategory = displayCategory ?? 'Retail'

  const websiteTrimmed = website.trim()
  const websiteUrl = websiteTrimmed ? normalizeWebsiteUrl(websiteTrimmed) : null
  const websiteValid = websiteUrl !== null && isWebsiteShapeValid(websiteUrl)

  const capabilityCards = getCapabilityCards(workingCategory)
  const selectedCards = capabilityCards.filter((c) => selectedCapabilityIds.includes(c.id))

  useRegisterDevControls(
    'setup-front-door',
    <DemoControlsGroup label="Setup front door">
      <Button
        variant="outline"
        size="sm"
        onClick={() => patch('demo', { businessCategory: state.demo.businessCategory === 'No category' ? 'Retail' : 'No category' })}
      >
        Demo: set known category ({state.demo.businessCategory === 'No category' ? 'off' : 'on'})
      </Button>
      {BUSINESS_CATEGORY_OPTIONS.filter((c) => c !== 'No category').map((c) => (
        <Button key={c} variant="outline" size="sm" onClick={() => setCategoryOverride(c)}>
          Demo: preview capability cards for {c}
        </Button>
      ))}
    </DemoControlsGroup>,
  )

  function next() {
    setScreenIndex((i) => Math.min(i + 1, TOTAL_SCREENS - 1))
  }
  function back() {
    setScreenIndex((i) => Math.max(i - 1, 0))
  }

  function toggleCapability(id: string) {
    setSelectedCapabilityIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleStartBuilding() {
    // 1. Website — the one real action this experience performs, exactly as WebsiteTab's own Add.
    if (websiteUrl && websiteValid) {
      const id = newId('site')
      const shouldFail = state.demo.forceNextFailure
      if (shouldFail) patch('demo', { forceNextFailure: false })
      const newSite: WebsiteSource = { id, url: websiteUrl, status: 'not_started', pagesRead: 0, subpages: [], updatedAt: Date.now() }
      patch('knowledge', (prev) => ({ websites: [newSite, ...prev.websites] }))
      // Real crawl on Meta; the Website tab polls it to completion from here.
      const setSite = (fields: Partial<WebsiteSource>) =>
        patch('knowledge', (prev) => ({ websites: prev.websites.map((w) => (w.id === id ? { ...w, ...fields } : w)) }))
      void (async () => {
        try {
          if (shouldFail) throw new Error('Could not add this website.')
          const fields = websiteFields(await addWebsite(websiteUrl))
          setSite(fields)
          trackCrawl(fields.metaId!, (fn) => patch('knowledge', fn))
        } catch (err) {
          setSite({ status: 'failed', crawlError: errorText(err) })
        }
      })()
    }

    // 2 & 3. Business description + agent role — land unsaved and editable, Step 1's own
    // save-on-Next model, exactly as if the suggestion chips had been clicked there.
    const identityPatch: Partial<IdentityState> = { persona }
    if (businessName.trim()) identityPatch.companyName = businessName.trim()
    const signalIds = selectedCards.map((c) => c.signalId).filter((s): s is SignalId => Boolean(s))
    const roleSignals = signalIds.length > 0 ? signalIds : CATEGORY_SUGGESTIONS[workingCategory] ?? []
    const roleText = composeSentence(roleSignals)
    if (roleText) identityPatch.agentRole = roleText
    patch('identity', identityPatch)

    if (businessName.trim()) {
      const description = composeBusinessDescription(workingCategory)
      if (description) patch('business', { businessDescription: description })
    }

    // Ensure the category signal actually carries through to Knowledge's FAQ starters etc.
    if (displayCategory) patch('demo', { businessCategory: displayCategory })

    onFinish()
  }

  const summaryRows: SummaryRow[] = []
  if (businessName.trim()) {
    summaryRows.push({
      label: 'Business details',
      lines: [
        displayCategory ? `${businessName.trim()}, ${displayCategory}` : businessName.trim(),
        "We'll pre-fill your business description",
      ],
    })
  }
  if (websiteUrl && websiteValid) {
    summaryRows.push({
      label: 'Website',
      lines: [`${getHostname(websiteUrl)} will be added as a knowledge source in Knowledge > Website`],
    })
  }
  if (selectedCards.length > 0) {
    summaryRows.push({ label: 'Agent will help with', lines: selectedCards.map((c) => c.title) })
  }
  const faqBucket = selectedCards.find((c) => c.faqBucket)?.faqBucket
  if (faqBucket) {
    summaryRows.push({
      label: 'Starter questions',
      lines: [`${FAQ_STARTER_SUGGESTIONS[faqBucket].length} suggested FAQ questions, ready for you to answer, in Knowledge > FAQ`],
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent px-6 py-10">
      <div className="w-full max-w-xl space-y-6 rounded-lg border border-border bg-card p-12">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: TOTAL_SCREENS }).map((_, i) => (
              <span key={i} className={cn('size-1.5 rounded-full', i <= screenIndex ? 'bg-primary' : 'bg-border')} />
            ))}
          </div>
          <button type="button" onClick={onFinish} className="text-muted-foreground text-sm">
            Skip, I&rsquo;ll set it up myself
          </button>
        </div>

        {screenIndex === 0 && (
          <ScreenPersona
            onSelect={(id) => {
              setPersona(id)
              next()
            }}
          />
        )}
        {screenIndex === 1 && (
          <ScreenBusiness
            businessName={businessName}
            onBusinessNameChange={setBusinessName}
            website={website}
            onWebsiteChange={setWebsite}
            onContinue={next}
          />
        )}
        {screenIndex === 2 && (
          <ScreenFound
            businessName={businessName}
            displayCategory={displayCategory}
            onCategoryChange={setCategoryOverride}
            website={website}
            onContinue={next}
          />
        )}
        {screenIndex === 3 && (
          <ScreenCapabilities
            cards={capabilityCards}
            selectedIds={selectedCapabilityIds}
            onToggle={toggleCapability}
            onContinue={next}
          />
        )}
        {screenIndex === 4 && <ScreenSummary rows={summaryRows} onBack={back} onStartBuilding={handleStartBuilding} />}
      </div>
    </div>
  )
}
