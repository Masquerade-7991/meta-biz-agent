import { useMemo, useState } from 'react'
import { HomePage } from '@/app/pages/HomePage'
import { InboxPage } from '@/app/pages/InboxPage'
import { TicketsPage } from '@/app/pages/TicketsPage'
import { ContactsPage } from '@/app/pages/ContactsPage'
import { BroadcastsPage } from '@/app/pages/BroadcastsPage'
import { SupportAnalyticsPage } from '@/app/pages/SupportAnalyticsPage'
import { WhatsAppPage } from '@/app/pages/WhatsAppPage'
import { NotificationsBell } from './NotificationsBell'
import { AppSidebar } from './AppSidebar'
import { AgentsListPage } from './AgentsListPage'
import { navFor, type NavId } from '@/app/nav'
import { useAuth } from '@/app/auth/AuthContext'
import { isDummyMode } from '@/app/api/dummy'
import { Button } from '@/app/components/ui/button'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { ROLES } from '@/app/lib/permissions'
import { SettingsPage, type SettingsTab } from './SettingsPage'

export function ProductShell({
  active,
  initialSettingsTab = 'profile',
  onNavigate: setActive,
  onOpenAgentBuilder,
  onAgentCreated,
  onOpenAgentActivity,
}: {
  /** Kept by the caller, so leaving the agent builder returns to the same page. */
  active: NavId
  /** The Settings tab to show first, e.g. from a link in an alert email. */
  initialSettingsTab?: SettingsTab
  onNavigate: (id: NavId) => void
  onOpenAgentBuilder: () => void
  onAgentCreated: () => void
  onOpenAgentActivity: () => void
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialSettingsTab)
  // A chat to open when switching to the inbox (from a ticket or a notification).
  const [chatPhone, setChatPhone] = useState<string | null>(null)
  const openChat = (phone: string) => {
    setChatPhone(phone)
    setActive('inbox')
  }

  const { me, setMe } = useAuth()
  // A page this role can't see (e.g. after a role change) falls back to Home.
  const pages = navFor(me?.role)
  const activeItem = pages.find((item) => item.id === active) ?? pages[0]
  const page = activeItem.id

  // Dummy mode: try the console as each role. The server enforces roles; here only the UI changes.
  const demo = useMemo(
    () =>
      isDummyMode() && me ? (
        <DemoControlsGroup label="Role">
          {ROLES.map((r) => (
            <Button key={r.id} size="sm" variant={me.role === r.id ? 'default' : 'outline'} onClick={() => setMe({ ...me, role: r.id })}>
              {r.label}
            </Button>
          ))}
        </DemoControlsGroup>
      ) : null,
    [me, setMe],
  )
  useRegisterDevControls('role', demo)

  function renderContent() {
    switch (page) {
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
      case 'whatsapp':
        return (
          <WhatsAppPage
            onOpenSettings={() => {
              setSettingsTab('whatsapp')
              setActive('settings')
            }}
          />
        )
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
        return <SettingsPage tab={settingsTab} onTabChange={setSettingsTab} onManageNumbers={() => setActive('whatsapp')} />
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
          <NotificationsBell
            onOpenChat={openChat}
            onOpenTarget={(target) => {
              // Number alerts (quality, names) open the WhatsApp page; billing opens Settings.
              if (target === 'broadcasts' || target === 'whatsapp') return setActive(target)
              setSettingsTab(target)
              setActive('settings')
            }}
          />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{renderContent()}</main>
      </div>
    </div>
  )
}
