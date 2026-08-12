import { useMemo, type ReactNode } from 'react'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { CompiledConfigViewer } from '@/app/components/wizard/CompiledConfigViewer'
import { Card } from '@/app/components/ui/card'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/app/components/ui/hover-card'
import { useWizard } from '@/app/wizard/WizardContext'
import { compileConfig } from '@/app/wizard/compiler'
import { STUDIO_NAV_SECTIONS } from '@/app/wizard/studioNav'
import type { StepId, StudioSectionId } from '@/app/wizard/types'

// One line of what each section covers, shown only on this page's nav cards — the sidebar itself
// stays label-only, so this lives here rather than on the shared STUDIO_NAV_SECTIONS entry.
const SECTION_BLURB: Partial<Record<StudioSectionId, string>> = {
  identity: 'Name and role',
  personality: 'Tone and language',
  skills: 'Custom skills',
  richReplies: 'Buttons, images, menus',
  knowledge: 'FAQs, docs, website',
  connections: 'Other systems',
  safety: 'Words and handoff',
  publish: 'Test and go live',
  activity: 'Health and logs',
}

// The studio's landing page: what Test & publish used to show at the very end ("Your agent's
// configuration") promoted to the front, plus a real stats-and-navigation hub above it so
// Overview does the job of a landing page rather than only a leftover review panel.
export function OverviewPage() {
  const { state, setSection, setPendingStepFocus } = useWizard()
  const compiled = useMemo(() => compileConfig(state), [state])

  // CompiledConfigViewer only ever calls onNavigate with a handful of (step, tab) combinations —
  // knowledge's own inner tabs need pendingStepFocus, everything else maps straight to a section.
  function onNavigate(step: StepId, tab?: string) {
    if (step === 'knowledge') {
      if (tab) setPendingStepFocus({ step, tab })
      setSection('knowledge')
      return
    }
    if (step === 'agent' && tab === 'richReplies') {
      setSection('richReplies')
      return
    }
    const bySection: Partial<Record<StepId, StudioSectionId>> = {
      connections: 'connections',
      safety: 'safety',
      publish: 'publish',
    }
    setSection(bySection[step] ?? 'identity')
  }

  const faqCount = state.knowledge.faqs.length
  const docCount = state.knowledge.documents.length
  const siteCount = state.knowledge.websites.length
  const connectionCount = state.connections.connections.length

  return (
    <div className="space-y-10">
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Status" value={compiled.settings.rollout.enabled ? 'Live' : 'Draft'} />
        <MetricCard label="Skills" value={String(compiled.skills.length)} />
        <MetricCard
          label="Connections"
          value={String(connectionCount)}
          hoverContent={
            connectionCount === 0 ? (
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                No connections yet.
              </p>
            ) : (
              <ul className="space-y-1" style={{ fontSize: 'var(--text-sm)' }}>
                {state.connections.connections.map((conn) => (
                  <li key={conn.id}>{conn.name}</li>
                ))}
              </ul>
            )
          }
        />
        <MetricCard
          label="Knowledge"
          value={String(faqCount + docCount + siteCount)}
          hoverContent={
            <ul className="space-y-1" style={{ fontSize: 'var(--text-sm)' }}>
              <li>
                {faqCount} FAQ{faqCount === 1 ? '' : 's'}
              </li>
              <li>
                {docCount} document{docCount === 1 ? '' : 's'}
              </li>
              <li>
                {siteCount} website{siteCount === 1 ? '' : 's'} crawled
              </li>
            </ul>
          }
        />
        <MetricCard label="Rich replies" value={String(state.richReplies.richReplies.length)} />
      </section>

      <section className="space-y-3">
        <h3>Jump to a section</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STUDIO_NAV_SECTIONS.filter((item) => item.group).map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" onClick={() => setSection(item.id)} className="h-full text-left">
                <Card className="h-full gap-2 p-4 transition-colors hover:bg-accent">
                  <div className="flex items-start gap-3">
                    <Icon className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{item.label}</p>
                      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        {SECTION_BLURB[item.id]}
                      </p>
                    </div>
                  </div>
                </Card>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <span className="flex items-center gap-1.5">
          <h3>Your agent&rsquo;s configuration</h3>
          <InfoTooltip text="Everything you’ve set up, already saved as you went. This is a review, not a preview." />
        </span>
        <div className="rounded-lg border border-border bg-card p-8">
          <CompiledConfigViewer config={compiled} state={state} onNavigate={onNavigate} />
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, hoverContent }: { label: string; value: string; hoverContent?: ReactNode }) {
  const card = (
    <div className="rounded-lg bg-muted p-4">
      <p className="text-muted-foreground" style={{ fontSize: '0.8125rem' }}>
        {label}
      </p>
      <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-medium)' }}>{value}</p>
    </div>
  )
  if (!hoverContent) return card
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent>{hoverContent}</HoverCardContent>
    </HoverCard>
  )
}
