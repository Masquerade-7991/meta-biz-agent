import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { useWizard } from '@/app/wizard/WizardContext'
import { SkillsSection } from './SkillsSection'
import { RichRepliesSection } from './RichRepliesSection'

type TabId = 'skills' | 'richReplies'

// Each tab forceMounts and hides via CSS rather than Radix's default unmount-when-inactive, so each
// keeps its own state registered no matter which tab is showing. Personality lives under Identity.
export function AbilitiesStep() {
  const { state, setPendingStepFocus } = useWizard()
  // The tab is part of the address (?tab=rich-replies), so links and the back button land on it.
  const [params, setParams] = useSearchParams()
  const activeTab: TabId = params.get('tab') === 'rich-replies' ? 'richReplies' : 'skills'
  const setActiveTab = useCallback((t: TabId) => setParams(t === 'richReplies' ? { tab: 'rich-replies' } : {}, { replace: true }), [setParams])
  const replyCount = state.richReplies.richReplies.length

  // Arriving here via Safety & handoff's "Customise handoff rules" pre-fills a skill on the
  // Skills tab — switch to it so the user actually sees the editor it opens.
  useEffect(() => {
    if (state.pendingSkillPrefill) setActiveTab('skills')
  }, [state.pendingSkillPrefill, setActiveTab])

  // Arriving here via a "Compiled configuration" link on Overview — jump to the tab it named.
  useEffect(() => {
    if (state.pendingStepFocus?.step === 'agent' && (state.pendingStepFocus.tab === 'skills' || state.pendingStepFocus.tab === 'richReplies')) {
      setActiveTab(state.pendingStepFocus.tab as TabId)
      setPendingStepFocus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingStepFocus])

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
      <TabsList>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="richReplies">
          Rich replies
          {replyCount > 0 && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-meta text-muted-foreground tabular-nums">{replyCount}</span>}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="skills" forceMount className="data-[state=inactive]:hidden">
        <SkillsSection />
      </TabsContent>

      <TabsContent value="richReplies" forceMount className="data-[state=inactive]:hidden">
        <RichRepliesSection onOpenSkills={() => setActiveTab('skills')} />
      </TabsContent>
    </Tabs>
  )
}
