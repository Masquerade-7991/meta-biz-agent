import type { KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { InfoTooltip } from './InfoTooltip'
import { cn } from '@/app/lib/utils'

/** A short bold label, one short line beneath it, nothing more — used for both single-select
 *  (persona, message choice) and multi-select (capability) card rows across the product. Longer
 *  explanatory text that used to sit next to a radio option goes in `info`, verbatim, shown on
 *  demand via the same InfoTooltip everywhere else uses. A div with role="button", not a native
 *  button, since the optional info icon is itself an interactive trigger and can't nest inside one. */
export function SelectableCard({
  title,
  helper,
  info,
  selected,
  onClick,
  large,
}: {
  title: string
  helper?: string
  info?: string
  selected: boolean
  onClick: () => void
  /** Front-door-only: bigger padding for the one-decision-at-a-time setup screens. */
  large?: boolean
}) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg border text-left transition-colors',
        large ? 'p-4' : 'p-3',
        selected ? 'border-primary bg-accent' : 'border-border hover:border-primary/50',
      )}
    >
      <div className="min-w-0">
        <span className="flex items-center gap-1.5">
          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{title}</p>
          {info && (
            <span onClick={(e) => e.stopPropagation()}>
              <InfoTooltip text={info} />
            </span>
          )}
        </span>
        {helper && (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            {helper}
          </p>
        )}
      </div>
      {selected && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
    </div>
  )
}
