import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { useWizard } from '@/app/wizard/WizardContext'
import { AgentIdentityStep } from './AgentIdentityStep'
import { PersonalitySection } from './PersonalitySection'
import { SkillsSection } from './SkillsSection'
import { RichRepliesSection } from './RichRepliesSection'

type TabId = 'identity' | 'personality' | 'skills' | 'richReplies'

// Each tab forceMounts and hides via CSS rather than Radix's default unmount-when-inactive, so
// Identity and Personality keep their own save/load state (and nav guard) registered no matter
// which tab is showing — otherwise switching tabs mid-edit would silently drop unsaved changes.
export function YourAgentStep() {
  const { state, setPendingStepFocus } = useWizard()
  const [activeTab, setActiveTab] = useState<TabId>('identity')

  // Arriving here via Safety & handoff's "Customise handoff rules" pre-fills a skill on the
  // Skills tab — switch to it so the user actually sees the editor it opens.
  useEffect(() => {
    if (state.pendingSkillPrefill) setActiveTab('skills')
  }, [state.pendingSkillPrefill])

  // Arriving here via a "Compiled configuration" link on Test & publish — jump to the tab it named.
  useEffect(() => {
    if (state.pendingStepFocus?.step === 'agent' && state.pendingStepFocus.tab) {
      setActiveTab(state.pendingStepFocus.tab as TabId)
      setPendingStepFocus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingStepFocus])

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
      <TabsList>
        <TabsTrigger value="identity">Identity</TabsTrigger>
        <TabsTrigger value="personality">Personality</TabsTrigger>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="richReplies">Rich replies</TabsTrigger>
      </TabsList>

      <TabsContent value="identity" forceMount className="mt-6 data-[state=inactive]:hidden">
        <AgentIdentityStep />
      </TabsContent>

      <TabsContent value="personality" forceMount className="mt-6 data-[state=inactive]:hidden">
        <PersonalitySection />
      </TabsContent>

      <TabsContent value="skills" forceMount className="mt-6 data-[state=inactive]:hidden">
        <SkillsSection />
      </TabsContent>

      <TabsContent value="richReplies" forceMount className="mt-6 data-[state=inactive]:hidden">
        <RichRepliesSection />
      </TabsContent>
    </Tabs>
  )
}
