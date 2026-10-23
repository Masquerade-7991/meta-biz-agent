import { cn } from '@/app/lib/utils'

/** A row of pill buttons that picks one option: a filter, a status, a date range. */
export function PillTabs<T extends string | number>({
  label,
  options,
  value,
  onChange,
  compact,
}: {
  label: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
  compact?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn('rounded-full px-3 text-xs', compact ? 'py-1' : 'py-1.5', value === o.id ? 'bg-foreground font-medium text-background' : 'bg-muted text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
