import { useState } from 'react'
import { Toaster } from '@/app/components/ui/sonner'
import { TooltipProvider } from '@/app/components/ui/tooltip'
import { WizardProvider, useWizard } from '@/app/wizard/WizardContext'
import { NavigationGuardProvider } from '@/app/wizard/NavigationGuardContext'
import { DevControlsProvider } from '@/app/wizard/DevControlsContext'
import { ExitProvider } from '@/app/wizard/ExitContext'
import { WizardShell } from '@/app/components/wizard/WizardShell'
import { DevControlsButton } from '@/app/components/wizard/DevControlsButton'
import { GateScreen } from '@/app/components/GateScreen'
import { SetupFrontDoor } from '@/app/components/SetupFrontDoor'
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
    <ExitProvider onExit={onExitToShell}>
      <NavigationGuardProvider>
        <WizardShell onExit={onExitToShell}>
          <StepComponent />
        </WizardShell>
      </NavigationGuardProvider>
    </ExitProvider>
  )
}

export default function App() {
  const [view, setView] = useState<'shell' | 'setup' | 'agent-flow'>('shell')

  return (
    <WizardProvider>
      <TooltipProvider>
        <DevControlsProvider>
          {view === 'shell' && (
            <ProductShell
              onOpenAgentBuilder={() => setView('agent-flow')}
              onAgentCreated={() => setView('setup')}
            />
          )}
          {view === 'setup' && <SetupFrontDoor onFinish={() => setView('agent-flow')} />}
          {view === 'agent-flow' && <AgentBuilderFlow onExitToShell={() => setView('shell')} />}
          <DevControlsButton />
        </DevControlsProvider>
        <Toaster />
      </TooltipProvider>
    </WizardProvider>
  )
}
