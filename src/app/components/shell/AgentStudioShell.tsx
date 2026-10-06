import { useEffect, useState } from 'react'
import { ArrowLeft, Eye, Loader2, Menu, MessageCircle, Rocket } from 'lucide-react'
import { TryItPanel } from '@/app/wizard/steps/TryItPanel'
import { StatusPill } from '@/app/components/ui/status'
import { Sheet, SheetContent, SheetTitle } from '@/app/components/ui/sheet'
import { AGENT_STATUS, agentStatusOf } from '@/app/lib/status'
import { toast } from 'sonner'
import { hydrateFromMeta, setActivePhoneNumberId } from '@/app/api/meta'
import { getDraft, keepLocalSecrets, ms, putStoredAgent, setDraftSyncPhone } from '@/app/api/store'
import { migrateRichReply } from '@/app/wizard/richReplies'
import type { SliceKey, WizardState } from '@/app/wizard/types'
import { Button } from '@/app/components/ui/button'
import { useWizard } from '@/app/wizard/WizardContext'
import { useNavigationGuard } from '@/app/wizard/NavigationGuardContext'
import { STUDIO_GROUP_LABEL, STUDIO_NAV_SECTIONS } from '@/app/wizard/studioNav'
import type { StudioSectionId } from '@/app/wizard/types'
import { OverviewPage } from '@/app/wizard/steps/OverviewPage'
import { AgentIdentityStep } from '@/app/wizard/steps/AgentIdentityStep'
import { AbilitiesStep } from '@/app/wizard/steps/AbilitiesStep'
import { KnowledgeStep } from '@/app/wizard/steps/KnowledgeStep'
import { ConnectionsStep } from '@/app/wizard/steps/ConnectionsStep'
import { SafetyHandoffStep } from '@/app/wizard/steps/SafetyHandoffStep'
import { TestEvalStep } from '@/app/wizard/steps/TestEvalStep'
import { PublishStep } from '@/app/wizard/steps/PublishStep'
import { ActivityPage } from '@/app/wizard/steps/ActivityPage'
import { AnalyticsPage } from '@/app/wizard/steps/AnalyticsPage'
import { cn } from '@/app/lib/utils'
import { useAuth } from '@/app/auth/AuthContext'
import { can } from '@/app/lib/permissions'

// Slices a stored draft may restore. Gate (which number is open) and demo controls stay local.
const DRAFT_SLICES = [
  'identity', 'business', 'knowledge', 'personalization', 'richReplies', 'routing', 'connectors',
  'connections', 'integrations', 'mcp', 'guardrails', 'replies', 'publish', 'qualityChecks', 'agentEvents',
] as const satisfies readonly SliceKey[]

/** The stored draft's slices, when it is newer than this browser's copy. The store holds secrets
 *  blanked, so the ones in this browser are kept; old drafts get the same defaults as localStorage. */
function draftPatch(local: WizardState, draft: Partial<WizardState>, updatedAt: number): Partial<WizardState> {
  // Identity is skipped: opening an agent from the list writes its name there just before this runs.
  // ponytail: identity edits made <2 s before a reload can lose to the draft; per-slice timestamps if that bites.
  const localEdit = Math.max(0, ...Object.entries(local.lastEditedAt).map(([k, t]) => (k === 'identity' ? 0 : t)))
  if (updatedAt < localEdit) return {}
  const out: Partial<WizardState> = {}
  for (const k of DRAFT_SLICES) if (draft[k]) Object.assign(out, { [k]: { ...local[k], ...draft[k] } })
  const kept = keepLocalSecrets(out, local)
  if (kept.richReplies) kept.richReplies = { richReplies: kept.richReplies.richReplies.map(migrateRichReply) }
  if (kept.knowledge) kept.knowledge = { ...kept.knowledge, websites: kept.knowledge.websites.map((w) => ({ ...w, subpages: w.subpages ?? [] })) }
  return kept
}

const SECTION_COMPONENTS: Record<StudioSectionId, () => React.ReactElement> = {
  overview: OverviewPage,
  identity: AgentIdentityStep,
  abilities: AbilitiesStep,
  knowledge: KnowledgeStep,
  connections: ConnectionsStep,
  safety: SafetyHandoffStep,
  testEval: TestEvalStep,
  publish: PublishStep,
  analytics: AnalyticsPage,
  activity: ActivityPage,
}

const GROUPS = ['build', 'deploy', 'monitor'] as const

// The agent builder's chrome: a persistent left sidebar with free navigation between every
// section, replacing the old forced-order stepper. Content stays organised the way this app's
// own wizard already modeled it (Identity, Abilities, Knowledge, Connections, Safety & handoff,
// Test & Eval, Publish, Activity) — just no longer gated by Back/Next.
export function AgentStudioShell({ onExit }: { onExit: () => void }) {
  const { state, setSection, patch } = useWizard()
  const { runGuard, pending, status: saveStatus } = useNavigationGuard()
  const [navOpen, setNavOpen] = useState(false)
  const [tryOpen, setTryOpen] = useState(false)
  // Supervisors and agents may look at the agent, but only owners and admins change it (server/app.ts).
  const { me } = useAuth()
  const readOnly = !can(me?.role, 'agent.edit')

  // Meta is the source of truth: load everything it holds for this agent once, before any section
  // renders, so each section's "saved" snapshot is what Meta actually has.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    let cancelled = false
    const phone = state.gate.selectedPhoneNumberId ?? null
    setActivePhoneNumberId(phone)
    if (phone) void putStoredAgent(phone, { lastOpenedAt: Date.now() })
    // The stored draft first (so forms like rich-reply blanks survive a change of browser), then Meta,
    // which wins for everything it owns.
    void (async () => {
      const draft = phone ? await getDraft(phone) : null
      if (cancelled) return
      const fromDraft = draft?.state ? draftPatch(state, draft.state, ms(draft.updatedAt)) : {}
      for (const [slice, value] of Object.entries(fromDraft)) patch(slice as SliceKey, value as never)
      const { patch: slices, failed } = await hydrateFromMeta({ ...state, ...fromDraft })
      if (cancelled) return
      for (const [slice, value] of Object.entries(slices)) patch(slice as keyof typeof slices, value as never)
      if (failed.length >= 9) {
        toast.error("Couldn't load this agent from Meta", { description: 'Showing what was last saved in this browser. Is the local server running and the Helo.ai server reachable?' })
      } else if (failed.length > 0) {
        toast.warning(`Couldn't load from Meta: ${failed.join(', ')}`)
      }
      setHydrated(true)
      setDraftSyncPhone(phone)
    })()
    return () => {
      cancelled = true
      setDraftSyncPhone(null)
    }
    // Once per opening of the agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function navigate(id: StudioSectionId) {
    if (id === state.currentSection || pending) return
    const ok = await runGuard(readOnly ? 'discard' : 'save')
    if (!ok) return
    setNavOpen(false)
    setSection(id)
  }

  async function handleExit() {
    if (pending) return
    const ok = await runGuard('discard')
    if (!ok) return
    onExit()
  }

  const ungrouped = STUDIO_NAV_SECTIONS.filter((item) => !item.group)
  const ActiveComponent = SECTION_COMPONENTS[state.currentSection]
  const activeLabel = STUDIO_NAV_SECTIONS.find((item) => item.id === state.currentSection)?.label ?? ''
  const statusId = agentStatusOf(state.publish)
  const agentStatus = AGENT_STATUS[statusId]
  const saveText = readOnly
    ? 'View only'
    : saveStatus.saving
      ? 'Saving…'
      : saveStatus.dirty
        ? 'Unsaved changes'
        : saveStatus.savedAt
          ? 'Saved'
          : null

  const nav = (
    <nav aria-label="Agent sections" className="space-y-5 px-3 py-4">
      <ul className="space-y-0.5">
        {ungrouped.map((item) => (
          <NavRow key={item.id} item={item} active={state.currentSection === item.id} onClick={() => navigate(item.id)} />
        ))}
      </ul>
      {GROUPS.map((group) => (
        <div key={group}>
          <p className="px-2.5 pb-1.5 text-meta font-medium text-muted-foreground">{STUDIO_GROUP_LABEL[group]}</p>
          <ul className="space-y-0.5">
            {STUDIO_NAV_SECTIONS.filter((item) => item.group === group).map((item) => (
              <NavRow key={item.id} item={item} active={state.currentSection === item.id} onClick={() => navigate(item.id)} />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open agent sections"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
        >
          <Menu className="size-5" />
        </button>
        <Button variant="ghost" size="sm" onClick={handleExit} disabled={pending} className="hidden text-muted-foreground sm:inline-flex">
          <ArrowLeft className="size-4" />
          All agents
        </Button>
        <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
        <div className="flex min-w-0 items-center gap-2.5">
          <p className="truncate font-semibold">{state.identity.agentName.trim() || 'Untitled agent'}</p>
          <StatusPill tone={agentStatus.tone}>{agentStatus.label}</StatusPill>
          {state.gate.selectedPhoneNumber && (
            <span className="hidden truncate font-mono text-meta text-muted-foreground lg:inline">{state.gate.selectedPhoneNumber}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {saveText && (
            <span className="flex items-center gap-1.5 text-meta text-muted-foreground" aria-live="polite">
              {saveStatus.dirty && !readOnly && <span aria-hidden className="size-1.5 rounded-full bg-warning" />}
              {saveText}
            </span>
          )}
          {state.currentSection !== 'testEval' && (
            <Button variant="outline" size="sm" onClick={() => setTryOpen(true)}>
              <MessageCircle className="size-4" />
              <span className="hidden sm:inline">Try it</span>
            </Button>
          )}
          {!readOnly && (statusId === 'draft' || statusId === 'paused') && state.currentSection !== 'publish' && state.currentSection !== 'overview' && (
            <Button size="sm" onClick={() => navigate('publish')} disabled={pending}>
              <Rocket className="size-4" />
              {statusId === 'paused' ? 'Resume' : 'Go live'}
            </Button>
          )}
        </div>
      </header>

      <TryItPanel open={tryOpen} onOpenChange={setTryOpen} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar md:block">{nav}</aside>
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-72 overflow-y-auto bg-sidebar p-0 sm:max-w-72">
            <SheetTitle className="sr-only">Agent sections</SheetTitle>
            <div className="border-b border-sidebar-border p-3">
              <Button variant="ghost" size="sm" onClick={handleExit} disabled={pending}>
                <ArrowLeft className="size-4" />
                All agents
              </Button>
            </div>
            {nav}
          </SheetContent>
        </Sheet>

        <main className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
            <h1 className="mb-5 truncate text-title font-semibold">{activeLabel}</h1>
            {readOnly && (
              <p className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
                <Eye className="size-4 shrink-0" />
                View only. Owners and admins change this agent; anything you edit here isn&rsquo;t saved.
              </p>
            )}
            {!hydrated ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading your agent…
              </p>
            ) : state.currentSection === 'overview' || state.currentSection === 'publish' ? (
              <ActiveComponent />
            ) : (
              <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
                <ActiveComponent />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function NavRow({
  item,
  active,
  onClick,
}: {
  item: (typeof STUDIO_NAV_SECTIONS)[number]
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
        )}
      >
        {active && <span aria-hidden className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-brand" />}
        <Icon className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} />
        <span className="truncate">{item.label}</span>
      </button>
    </li>
  )
}
