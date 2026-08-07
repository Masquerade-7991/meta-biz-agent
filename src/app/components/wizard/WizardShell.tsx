import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, LogOut } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { StepNav } from './StepNav'
import { DevControlsButton } from './DevControlsButton'
import { useWizard } from '@/app/wizard/WizardContext'
import { useNavigationGuard } from '@/app/wizard/NavigationGuardContext'
import { STEP_ORDER } from '@/app/wizard/mockData'
import { isStepValid } from '@/app/wizard/validation'

export function WizardShell({ children, onExit }: { children: ReactNode; onExit: () => void }) {
  const { state, setStep, setStepComplete } = useWizard()
  const { runGuard, pending } = useNavigationGuard()

  const currentIndex = STEP_ORDER.findIndex((step) => step.id === state.currentStep)
  const currentMeta = STEP_ORDER[currentIndex]
  const isFirst = currentIndex === 0
  const isLast = currentIndex === STEP_ORDER.length - 1
  const canProceed = isStepValid(state, state.currentStep)
  // Your agent and Knowledge each mix an immediate-save part with a save-on-Next part — the
  // footer says so, but Save and close and Next stay normal buttons either way.
  const splitSaveNote =
    state.currentStep === 'agent'
      ? 'Custom skills and rich replies are already saved. Next saves everything else on this page.'
      : state.currentStep === 'knowledge'
        ? 'The FAQ, Documents and Website tabs are already saved. Next saves Business details.'
        : null

  async function handleBack() {
    if (isFirst || pending) return
    const ok = await runGuard('discard')
    if (!ok) return
    setStep(STEP_ORDER[currentIndex - 1].id)
  }

  async function handleNext() {
    if (!canProceed || isLast || pending) return
    const ok = await runGuard('save')
    if (!ok) return
    setStepComplete(state.currentStep, true)
    setStep(STEP_ORDER[currentIndex + 1].id)
  }

  async function handleSaveAndClose() {
    if (pending) return
    const ok = await runGuard('save')
    if (!ok) return
    onExit()
  }

  async function handleExit() {
    if (pending) return
    const ok = await runGuard('discard')
    if (!ok) return
    onExit()
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3 min-w-0">
          <p className="truncate" style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>
            {state.identity.agentName.trim() || 'Untitled agent'}
          </p>
          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Step {currentMeta.index} of {STEP_ORDER.length}
          </span>
        </div>
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
        <StepNav />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[820px] px-6 py-10">
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Step {currentMeta.index}
              </p>
              <h2 className="mt-1">{currentMeta.label}</h2>
              <div className="mt-8">{children}</div>
            </div>
          </main>

          <footer className="flex shrink-0 items-center justify-between border-t border-border bg-card px-6 py-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleBack} disabled={isFirst || pending}>
                <ArrowLeft className="size-4" />
                Back
              </Button>
              <DevControlsButton />
            </div>
            <div className="flex items-center gap-3">
              {splitSaveNote && (
                <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  {splitSaveNote}
                </span>
              )}
              <Button variant="ghost" onClick={handleSaveAndClose} disabled={pending}>
                Save and close
              </Button>
              {!isLast && (
                <Button onClick={handleNext} disabled={!canProceed || pending}>
                  Next
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
