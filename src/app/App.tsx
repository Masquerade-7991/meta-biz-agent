import { useState } from 'react'
import { Toaster } from '@/app/components/ui/sonner'
import { TooltipProvider } from '@/app/components/ui/tooltip'
import { WizardProvider, useWizard } from '@/app/wizard/WizardContext'
import { NavigationGuardProvider } from '@/app/wizard/NavigationGuardContext'
import { DevControlsProvider } from '@/app/wizard/DevControlsContext'
import { ExitProvider } from '@/app/wizard/ExitContext'
import { AgentStudioShell } from '@/app/components/shell/AgentStudioShell'
import { DevControlsButton } from '@/app/components/wizard/DevControlsButton'
import { GateScreen } from '@/app/components/GateScreen'
import { SetupFrontDoor } from '@/app/components/SetupFrontDoor'
import { ProductShell } from '@/app/components/shell/ProductShell'
import { isDummyMode } from '@/app/api/dummy'

function AgentBuilderFlow({ onExitToShell }: { onExitToShell: () => void }) {
  const { state } = useWizard()

  if (!state.gate.gatePassed) {
    return <GateScreen onBack={onExitToShell} />
  }

  return (
    <ExitProvider onExit={onExitToShell}>
      <NavigationGuardProvider>
        <AgentStudioShell onExit={onExitToShell} />
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
              // Dummy demos fill every field by hand, so the guided setup is skipped.
              onAgentCreated={() => setView(isDummyMode() ? 'agent-flow' : 'setup')}
              onOpenAgentActivity={() => setView('agent-flow')}
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
