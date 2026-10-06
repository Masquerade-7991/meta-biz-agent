import { Search } from 'lucide-react'
import { Input } from '@/app/components/ui/input'
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
          className={cn('rounded-full px-3 text-xs', compact ? 'py-1' : 'py-1.5', value === o.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A search box with its magnifier icon; `label` names it for screen readers. */
export function SearchInput({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn('pl-9', className)} aria-label={label} />
    </div>
  )
}
