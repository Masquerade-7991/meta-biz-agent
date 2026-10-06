import { cn } from '@/app/lib/utils'

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  disabled?: boolean
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-border p-1', disabled && 'opacity-50')}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
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
