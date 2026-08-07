import { useState } from 'react'
import { Toaster } from '@/app/components/ui/sonner'
import { TooltipProvider } from '@/app/components/ui/tooltip'
import { WizardProvider, useWizard } from '@/app/wizard/WizardContext'
import { NavigationGuardProvider } from '@/app/wizard/NavigationGuardContext'
import { DevControlsProvider } from '@/app/wizard/DevControlsContext'
import { WizardShell } from '@/app/components/wizard/WizardShell'
import { GateScreen } from '@/app/components/GateScreen'
import { ProductShell } from '@/app/components/shell/ProductShell'
import { YourAgentStep } from '@/app/wizard/steps/YourAgentStep'
import { KnowledgeStep } from '@/app/wizard/steps/KnowledgeStep'
import { ConnectionsStep } from '@/app/wizard/steps/ConnectionsStep'
import { SafetyHandoffStep } from '@/app/wizard/steps/SafetyHandoffStep'
import { ReviewPublishStep } from '@/app/wizard/steps/ReviewPublishStep'
import type { StepId } from '@/app/wizard/types'

const STEP_COMPONENTS: Record<StepId, () => React.ReactElement> = {
  agent: YourAgentStep,
  knowledge: KnowledgeStep,
  connections: ConnectionsStep,
  safety: SafetyHandoffStep,
  publish: ReviewPublishStep,
}

function AgentBuilderFlow({ onExitToShell }: { onExitToShell: () => void }) {
  const { state } = useWizard()

  if (!state.gate.gatePassed) {
    return <GateScreen onBack={onExitToShell} />
  }

  const StepComponent = STEP_COMPONENTS[state.currentStep]

  return (
    <NavigationGuardProvider>
      <DevControlsProvider>
        <WizardShell onExit={onExitToShell}>
          <StepComponent />
        </WizardShell>
      </DevControlsProvider>
    </NavigationGuardProvider>
  )
}

export default function App() {
  const [view, setView] = useState<'shell' | 'agent-flow'>('shell')

  return (
    <WizardProvider>
      <TooltipProvider>
        {view === 'shell' ? (
          <ProductShell onOpenAgentBuilder={() => setView('agent-flow')} />
        ) : (
          <AgentBuilderFlow onExitToShell={() => setView('shell')} />
        )}
        <Toaster />
      </TooltipProvider>
    </WizardProvider>
  )
}
