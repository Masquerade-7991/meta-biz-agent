import { cn } from '@/app/lib/utils'

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
  title,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  disabled?: boolean
  /** What the choice is, for screen readers. */
  label?: string
  /** Why it's disabled, on hover. */
  title?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} title={title} className={cn('inline-flex rounded-lg border border-border p-1', disabled && 'opacity-50')}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          disabled={disabled}
          onClick={() => onChange(option.id)}
          className={cn(
            'text-sm',
            'rounded-md px-3 py-1.5 transition-colors',
            value === option.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
