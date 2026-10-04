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
import { NAV_ITEMS, type NavId } from '@/app/nav'
import type { SettingsTab } from '@/app/components/shell/SettingsPage'
import { ProductShell } from '@/app/components/shell/ProductShell'
import { isDummyMode } from '@/app/api/dummy'
import { AuthProvider, useAuth } from '@/app/auth/AuthContext'
import { AuthScreen, CreateWorkspaceScreen } from '@/app/auth/AuthScreens'
import { AccountSetupScreen, NewPasswordScreen, VerifyScreen } from '@/app/auth/SetupScreen'

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

/** Who sees what: an emailed link verifies the email; signed out → log in or sign up; a verified
 *  account still being set up → in-app setup (or a new password after a reset); signed in
 *  without a workspace → create one; otherwise the console. */
function Gate() {
  const { me, setMe } = useAuth()
  const [view, setView] = useState<'shell' | 'setup' | 'agent-flow'>('shell')
  // Links in emails open a page or a Settings tab: /?page=broadcasts, /?settings=billing.
  const [start] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    const tab = q.get('settings') as SettingsTab | null
    const page = q.get('page') as NavId | null
    if (tab || page) window.history.replaceState(null, '', '/')
    return { nav: tab ? ('settings' as NavId) : page && NAV_ITEMS.some((i) => i.id === page) ? page : ('home' as NavId), tab: tab ?? undefined }
  })
  const [nav, setNav] = useState<NavId>(start.nav)
  const [linkToken, setLinkToken] = useState(() =>
    window.location.pathname === '/auth/verify' ? new URLSearchParams(window.location.search).get('token') : null,
  )

  if (linkToken !== null)
    return (
      <VerifyScreen
        token={linkToken}
        onDone={(signedIn) => {
          window.history.replaceState(null, '', '/') // the token never stays in the address bar
          setLinkToken(null)
          if (signedIn) setMe(signedIn)
        }}
      />
    )
  if (me === undefined) return null
  if (me === null) return <AuthScreen />
  if (me.setup === 'account') return <AccountSetupScreen />
  if (me.setup === 'password') return <NewPasswordScreen />
  if (!me.workspace) return <CreateWorkspaceScreen />

  return (
    <>
      {view === 'shell' && (
        <ProductShell
          active={nav}
          initialSettingsTab={start.tab}
          onNavigate={setNav}
          onOpenAgentBuilder={() => setView('agent-flow')}
          // Dummy demos fill every field by hand, so the guided setup is skipped.
          onAgentCreated={() => setView(isDummyMode() ? 'agent-flow' : 'setup')}
          onOpenAgentActivity={() => setView('agent-flow')}
        />
      )}
      {view === 'setup' && <SetupFrontDoor onFinish={() => setView('agent-flow')} />}
      {view === 'agent-flow' && <AgentBuilderFlow onExitToShell={() => setView('shell')} />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <WizardProvider>
        <TooltipProvider>
          <DevControlsProvider>
            <Gate />
            <DevControlsButton />
          </DevControlsProvider>
          <Toaster />
        </TooltipProvider>
      </WizardProvider>
    </AuthProvider>
  )
}
