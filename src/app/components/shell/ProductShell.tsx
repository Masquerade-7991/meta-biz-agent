import { useState } from 'react'
import { Bell } from 'lucide-react'
import { AppSidebar } from './AppSidebar'
import { PlaceholderPage } from './PlaceholderPage'
import { AgentsListPage } from './AgentsListPage'
import { NAV_ITEMS, type NavId } from '@/app/nav'

export function ProductShell({ onOpenAgentBuilder }: { onOpenAgentBuilder: () => void }) {
  const [active, setActive] = useState<NavId>('ai-agents')

  const activeItem = NAV_ITEMS.find((item) => item.id === active)!

  function renderContent() {
    switch (active) {
      case 'ai-agents':
        return <AgentsListPage onOpenBuilder={onOpenAgentBuilder} />
      default:
        return <PlaceholderPage item={activeItem} />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar active={active} onNavigate={setActive} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{activeItem.label}</p>
          <Bell className="size-4 text-muted-foreground" />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{renderContent()}</main>
      </div>
    </div>
  )
}
