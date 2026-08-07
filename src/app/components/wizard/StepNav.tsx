import { Check } from 'lucide-react'
import { useWizard } from '@/app/wizard/WizardContext'
import { STEP_ORDER } from '@/app/wizard/mockData'
import { cn } from '@/app/lib/utils'

export function StepNav() {
  const { state, setStep } = useWizard()

  return (
    <nav className="hidden w-[260px] shrink-0 border-r border-border bg-sidebar px-3 py-4 md:block">
      <ol className="flex flex-col gap-1">
        {STEP_ORDER.map((step) => {
          const isCurrent = state.currentStep === step.id
          const isComplete = state.completedSteps[step.id]
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => setStep(step.id)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                  isCurrent
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                    isComplete
                      ? 'border-primary bg-primary text-primary-foreground'
                      : isCurrent
                        ? 'border-primary text-primary'
                        : 'border-border text-muted-foreground',
                  )}
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  {isComplete ? <Check className="size-3" /> : step.index}
                </span>
                <span className="min-w-0 flex items-center gap-1.5">
                  <span className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                    {step.label}
                  </span>
                  {step.optionalTag && (
                    <span className="shrink-0 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                      Optional
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
