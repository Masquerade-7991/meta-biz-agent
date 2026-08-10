import { useRef, type KeyboardEvent } from 'react'
import { Check, Rocket } from 'lucide-react'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { Button } from '@/app/components/ui/button'
import { STEP_ORDER } from '@/app/wizard/mockData'
import type { StepId } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

type CircleState = 'not-visited' | 'current' | 'visited' | 'live'

const CIRCLE_CLASS: Record<CircleState, string> = {
  'not-visited': 'border border-border bg-background text-muted-foreground',
  current: 'border-2 border-primary bg-background text-primary',
  visited: 'border border-success bg-success text-success-foreground',
  live: 'border border-success bg-success text-success-foreground',
}

const CAPTION_CLASS: Record<CircleState, string> = {
  'not-visited': 'text-muted-foreground',
  current: 'text-foreground',
  visited: 'text-foreground',
  live: 'text-foreground',
}

export function Stepper() {
  const { state, setStep, setStepComplete, patch } = useWizard()
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])

  function circleState(stepId: StepId): CircleState {
    const isCurrent = state.currentStep === stepId
    if (stepId === 'publish') {
      if (state.publish.activated) return 'live'
      return isCurrent ? 'current' : 'not-visited'
    }
    if (isCurrent) return 'current'
    return state.completedSteps[stepId] ? 'visited' : 'not-visited'
  }

  function goToStep(targetId: StepId) {
    const currentIndex = STEP_ORDER.findIndex((s) => s.id === state.currentStep)
    const targetIndex = STEP_ORDER.findIndex((s) => s.id === targetId)
    if (targetIndex > currentIndex) setStepComplete(state.currentStep, true)
    setStep(targetId)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      btnRefs.current[(index + 1) % STEP_ORDER.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      btnRefs.current[(index - 1 + STEP_ORDER.length) % STEP_ORDER.length]?.focus()
    }
  }

  useRegisterDevControls(
    'stepper',
    <DemoControlsGroup label="Stepper">
      {STEP_ORDER.map((step) => (
        <Button
          key={step.id}
          variant="outline"
          size="sm"
          onClick={() => setStepComplete(step.id, !state.completedSteps[step.id])}
        >
          {step.label}: {state.completedSteps[step.id] ? 'Visited' : 'Not visited'}
        </Button>
      ))}
      <Button variant="outline" size="sm" onClick={() => patch('publish', { activated: !state.publish.activated })}>
        {state.publish.activated ? 'Agent live (on)' : 'Agent live (off)'}
      </Button>
    </DemoControlsGroup>,
  )

  return (
    <ol className="flex h-full flex-col items-stretch">
      {STEP_ORDER.map((step, i) => {
        const cState = circleState(step.id)
        return (
          <li key={step.id} className="relative flex flex-1 items-start last:flex-none">
            {i > 0 && (
              <div
                aria-hidden
                className={cn(
                  'absolute left-4 top-0 h-full w-0 border-l-2',
                  circleState(STEP_ORDER[i - 1].id) === 'visited' ? 'border-solid border-success' : 'border-dotted border-border',
                )}
                style={{ top: '-50%' }}
              />
            )}
            <button
              ref={(el) => {
                btnRefs.current[i] = el
              }}
              type="button"
              tabIndex={step.id === state.currentStep ? 0 : -1}
              onClick={() => goToStep(step.id)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className="relative z-10 flex items-center gap-3 text-left"
              aria-current={step.id === state.currentStep ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full font-medium transition-colors',
                  CIRCLE_CLASS[cState],
                )}
                style={{ fontSize: 'var(--text-sm)' }}
              >
                {cState === 'visited' ? <Check className="size-4" /> : cState === 'live' ? <Rocket className="size-4" /> : step.index}
              </span>
              <span
                className={cn('flex items-center gap-1.5', CAPTION_CLASS[cState])}
                style={{ fontSize: 'var(--text-sm)', fontWeight: cState === 'current' ? 'var(--font-weight-semi-bold)' : 'var(--font-weight-regular)' }}
              >
                {step.label}
                {step.optionalTag && (
                  <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    Optional
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
