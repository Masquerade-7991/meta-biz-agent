import type { NavItem } from '@/app/nav'

export function PlaceholderPage({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h3>{item.label}</h3>
      <p className="max-w-sm text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
        This section isn&rsquo;t part of the prototype. The AI Agents entry in the sidebar opens
        the fully built agent creation wizard.
      </p>
    </div>
  )
}
