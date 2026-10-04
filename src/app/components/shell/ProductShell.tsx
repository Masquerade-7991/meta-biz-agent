import { useState } from 'react'
import { HomePage } from '@/app/pages/HomePage'
import { InboxPage } from '@/app/pages/InboxPage'
import { TicketsPage } from '@/app/pages/TicketsPage'
import { ContactsPage } from '@/app/pages/ContactsPage'
import { BroadcastsPage } from '@/app/pages/BroadcastsPage'
import { SupportAnalyticsPage } from '@/app/pages/SupportAnalyticsPage'
import { NotificationsBell } from './NotificationsBell'
import { AppSidebar } from './AppSidebar'
import { AgentsListPage } from './AgentsListPage'
import { NAV_ITEMS, type NavId } from '@/app/nav'
import { SettingsPage, type SettingsTab } from './SettingsPage'

export function ProductShell({
  active,
  onNavigate: setActive,
  onOpenAgentBuilder,
  onAgentCreated,
  onOpenAgentActivity,
}: {
  /** Kept by the caller, so leaving the agent builder returns to the same page. */
  active: NavId
  onNavigate: (id: NavId) => void
  onOpenAgentBuilder: () => void
  onAgentCreated: () => void
  onOpenAgentActivity: () => void
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile')
  // A chat to open when switching to the inbox (from a ticket or a notification).
  const [chatPhone, setChatPhone] = useState<string | null>(null)
  const openChat = (phone: string) => {
    setChatPhone(phone)
    setActive('inbox')
  }

  const activeItem = NAV_ITEMS.find((item) => item.id === active)!

  function renderContent() {
    switch (active) {
      case 'home':
        return (
          <HomePage
            onNavigate={setActive}
            onOpenSettings={(tab) => {
              setSettingsTab(tab)
              setActive('settings')
            }}
          />
        )
      case 'inbox':
        return <InboxPage initialPhone={chatPhone} />
      case 'tickets':
        return <TicketsPage onOpenChat={openChat} />
      case 'contacts':
        return <ContactsPage onOpenChat={openChat} />
      case 'broadcasts':
        return <BroadcastsPage />
      case 'analytics':
        return <SupportAnalyticsPage />
      case 'ai-agents':
        return (
          <AgentsListPage
            onOpenBuilder={onOpenAgentBuilder}
            onAgentCreated={onAgentCreated}
            onOpenActivity={onOpenAgentActivity}
          />
        )
      case 'settings':
        return <SettingsPage tab={settingsTab} onTabChange={setSettingsTab} />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar
        active={active}
        onNavigate={setActive}
        onOpenSettings={(tab) => {
          setSettingsTab(tab)
          setActive('settings')
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{activeItem.label}</p>
          <NotificationsBell onOpenChat={openChat} />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{renderContent()}</main>
      </div>
    </div>
  )
}
