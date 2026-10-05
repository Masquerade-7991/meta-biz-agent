import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { useWizard } from '@/app/wizard/WizardContext'
import { SkillsSection } from './SkillsSection'
import { RichRepliesSection } from './RichRepliesSection'

type TabId = 'skills' | 'richReplies'

// Each tab forceMounts and hides via CSS rather than Radix's default unmount-when-inactive, so each
// keeps its own state registered no matter which tab is showing. Personality lives under Identity.
export function AbilitiesStep() {
  const { state, setPendingStepFocus } = useWizard()
  const [activeTab, setActiveTab] = useState<TabId>('skills')

  // Arriving here via Safety & handoff's "Customise handoff rules" pre-fills a skill on the
  // Skills tab — switch to it so the user actually sees the editor it opens.
  useEffect(() => {
    if (state.pendingSkillPrefill) setActiveTab('skills')
  }, [state.pendingSkillPrefill])

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
        <TabsTrigger value="richReplies">Rich replies</TabsTrigger>
      </TabsList>

      <TabsContent value="skills" forceMount className="mt-6 data-[state=inactive]:hidden">
        <SkillsSection />
      </TabsContent>

      <TabsContent value="richReplies" forceMount className="mt-6 data-[state=inactive]:hidden">
        <RichRepliesSection />
      </TabsContent>
    </Tabs>
  )
}
