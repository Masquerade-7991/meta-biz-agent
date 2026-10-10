import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, useLocation, useNavigate } from 'react-router'
import { Toaster } from '@/app/components/ui/sonner'
import { TooltipProvider } from '@/app/components/ui/tooltip'
import { WizardProvider, useWizard } from '@/app/wizard/WizardContext'
import { NavigationGuardProvider, useNavigationGuard } from '@/app/wizard/NavigationGuardContext'
import { DevControlsProvider } from '@/app/wizard/DevControlsContext'
import { ExitProvider } from '@/app/wizard/ExitContext'
import { DevControlsButton } from '@/app/components/wizard/DevControlsButton'
import { LoaderPreview } from '@/app/components/wizard/LoaderPreview'
import { navFromPath, NAV_ITEMS, pathFor, type NavId } from '@/app/nav'
import { sectionFromSlug, STUDIO_BASE, studioPath } from '@/app/wizard/studioPaths'
import type { SettingsTab } from '@/app/components/shell/SettingsPage'
import { CommandPalette } from '@/app/components/shell/CommandPalette'
import { isDummyMode } from '@/app/api/dummy'
import { AuthProvider, useAuth } from '@/app/auth/AuthContext'
import { PageLoader } from '@/app/components/ui/wavy-loader'

// Only the screen someone is on downloads: the console, the agent studio, setup or sign-in.
const ProductShell = lazy(() => import('@/app/components/shell/ProductShell').then((m) => ({ default: m.ProductShell })))
const AgentStudioShell = lazy(() => import('@/app/components/shell/AgentStudioShell').then((m) => ({ default: m.AgentStudioShell })))
const GateScreen = lazy(() => import('@/app/components/GateScreen').then((m) => ({ default: m.GateScreen })))
const SetupFrontDoor = lazy(() => import('@/app/components/SetupFrontDoor').then((m) => ({ default: m.SetupFrontDoor })))
const AuthScreen = lazy(() => import('@/app/auth/AuthScreens').then((m) => ({ default: m.AuthScreen })))
const CreateWorkspaceScreen = lazy(() => import('@/app/auth/AuthScreens').then((m) => ({ default: m.CreateWorkspaceScreen })))
const AccountSetupScreen = lazy(() => import('@/app/auth/SetupScreen').then((m) => ({ default: m.AccountSetupScreen })))
const NewPasswordScreen = lazy(() => import('@/app/auth/SetupScreen').then((m) => ({ default: m.NewPasswordScreen })))
const ReportPrint = lazy(() => import('@/app/reports/ReportPrint').then((m) => ({ default: m.ReportPrint })))
const VerifyScreen = lazy(() => import('@/app/auth/SetupScreen').then((m) => ({ default: m.VerifyScreen })))

function AgentBuilderFlow({ onExitToShell }: { onExitToShell: (page?: NavId) => void }) {
  const { state } = useWizard()

  if (!state.gate.gatePassed) {
    return <GateScreen onBack={() => onExitToShell()} />
  }

  return (
    <ExitProvider onExit={onExitToShell}>
      <NavigationGuardProvider>
        <StudioUrlSync />
        <AgentStudioShell onExit={() => onExitToShell('ai-agents')} />
      </NavigationGuardProvider>
    </ExitProvider>
  )
}

/** Keeps /agents/studio/<section> and the open section in step. The section is the wizard's state
 *  (every in-app jump goes through setSection); the address follows it, and the browser's back and
 *  forward buttons move the section, through the same unsaved-changes check as the studio nav. */
function StudioUrlSync() {
  const { state, setSection } = useWizard()
  const { runGuard } = useNavigationGuard()
  const location = useLocation()
  const navigate = useNavigate()
  const slug = location.pathname.split('/')[3]
  const current = state.currentSection
  // A section the address asked for that the studio hasn't switched to yet. While it is pending the
  // address is left alone, so a link straight to a section (or Back) isn't overwritten on the way.
  const target = useRef(sectionFromSlug(slug))

  // Section → address.
  useEffect(() => {
    if (target.current && target.current !== current) return
    target.current = null
    if (sectionFromSlug(slug) !== current) navigate(studioPath(current), { replace: !sectionFromSlug(slug) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  // Address → section (back / forward, or a link straight to a section).
  useEffect(() => {
    const wanted = sectionFromSlug(slug)
    if (!wanted || wanted === current) return
    target.current = wanted
    void runGuard('save').then((ok) => {
      if (ok) return setSection(wanted)
      target.current = null
      navigate(studioPath(current), { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])
  return null
}

/** Who sees what: an emailed link verifies the email; signed out → log in or sign up; a verified
 *  account still being set up → in-app setup (or a new password after a reset); signed in
 *  without a workspace → create one; otherwise the console. */
function Gate() {
  const { me, setMe } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
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

  // Older links in emails open a page or a Settings tab by query: /?page=broadcasts, /?settings=billing.
  const q = new URLSearchParams(location.search)
  const legacyTab = q.get('settings')
  const legacyPage = q.get('page') as NavId | null
  if (legacyTab) return <Navigate to={pathFor('settings', legacyTab)} replace />
  if (legacyPage && NAV_ITEMS.some((i) => i.id === legacyPage)) return <Navigate to={pathFor(legacyPage)} replace />

  const path = location.pathname
  // The print view of a report: no console around it, so the page prints (or saves as PDF) cleanly.
  if (path === '/reports/print') return <ReportPrint />
  if (path === '/agents/setup') return <SetupFrontDoor onFinish={() => navigate(STUDIO_BASE)} />
  if (path === STUDIO_BASE || path.startsWith(STUDIO_BASE + '/'))
    return <AgentBuilderFlow onExitToShell={(page) => navigate(pathFor(page ?? 'ai-agents'))} />

  const nav = navFromPath(path)
  if (!nav) return <Navigate to="/" replace />
  const tab = nav === 'settings' ? (path.split('/')[2] as SettingsTab | undefined) : undefined
  return (
    <ProductShell
      active={nav}
      settingsTab={tab ?? 'profile'}
      onNavigate={(id, settingsTab) => navigate(pathFor(id, settingsTab))}
      onOpenAgentBuilder={() => navigate(STUDIO_BASE)}
      // Dummy demos fill every field by hand, so the guided setup is skipped.
      onAgentCreated={() => navigate(isDummyMode() ? STUDIO_BASE : '/agents/setup')}
      onOpenAgentActivity={() => navigate(STUDIO_BASE)}
    />
  )
}

export default function App() {
  return (
    <BrowserRouter>
    <AuthProvider>
      <WizardProvider>
        <TooltipProvider>
          <DevControlsProvider>
            <Suspense fallback={<PageLoader fullscreen />}>
              <Gate />
            </Suspense>
            <CommandPalette />
            {(isDummyMode() || import.meta.env.DEV) && (
              <>
                <DevControlsButton />
                <LoaderPreview />
              </>
            )}
          </DevControlsProvider>
          <Toaster />
        </TooltipProvider>
      </WizardProvider>
    </AuthProvider>
    </BrowserRouter>
  )
}
