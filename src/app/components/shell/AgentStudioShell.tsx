import { useEffect, useState } from 'react'
import { Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { hydrateFromMeta, setActivePhoneNumberId } from '@/app/api/meta'
import { getDraft, keepLocalSecrets, ms, putStoredAgent, setDraftSyncPhone } from '@/app/api/store'
import { migrateRichReply } from '@/app/wizard/richReplies'
import type { SliceKey, WizardState } from '@/app/wizard/types'
import { Button } from '@/app/components/ui/button'
import { Avatar, AvatarFallback } from '@/app/components/ui/avatar'
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
  const { runGuard, pending } = useNavigationGuard()

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
    const ok = await runGuard('save')
    if (!ok) return
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

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <p className="truncate" style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>
          {state.identity.agentName.trim() || 'Untitled agent'}
        </p>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            All changes saved
          </span>
          <Button variant="ghost" size="sm" onClick={handleExit} disabled={pending}>
            <LogOut className="size-4" />
            Exit
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-60 shrink-0 space-y-4 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4">
          <ul className="space-y-0.5">
            {ungrouped.map((item) => (
              <NavRow key={item.id} item={item} active={state.currentSection === item.id} onClick={() => navigate(item.id)} />
            ))}
          </ul>

          {GROUPS.map((group) => (
            <div key={group}>
              <p
                className="px-2 pb-1 text-muted-foreground uppercase"
                style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-semi-bold)', letterSpacing: '0.04em' }}
              >
                {STUDIO_GROUP_LABEL[group]}
              </p>
              <ul className="space-y-0.5">
                {STUDIO_NAV_SECTIONS.filter((item) => item.group === group).map((item) => (
                  <NavRow key={item.id} item={item} active={state.currentSection === item.id} onClick={() => navigate(item.id)} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto bg-muted">
          <div className="mx-auto w-full max-w-5xl px-10 py-10">
            <div className="mb-6 flex min-w-0 items-center gap-3">
              <h2 className="truncate">{activeLabel}</h2>
              {state.currentSection === 'overview' && (
                <Avatar>
                  <AvatarFallback className="bg-muted text-muted-foreground">
                    {agentInitials(state.identity.agentName)}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
            {!hydrated ? (
              <p className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                <Loader2 className="size-4 animate-spin" /> Loading your agent from Meta...
              </p>
            ) : state.currentSection === 'overview' || state.currentSection === 'publish' ? (
              <ActiveComponent />
            ) : (
              <div className="rounded-lg border border-border bg-card p-8">
                <ActiveComponent />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
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
          'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
          active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
        )}
        style={{ fontSize: 'var(--text-sm)', fontWeight: active ? 'var(--font-weight-medium)' : 'var(--font-weight-regular)' }}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    </li>
  )
}
