import { useMemo, useState } from 'react'
import { HomePage } from '@/app/pages/HomePage'
import { InboxPage } from '@/app/pages/InboxPage'
import { TicketsPage } from '@/app/pages/TicketsPage'
import { ContactsPage } from '@/app/pages/ContactsPage'
import { BroadcastsPage } from '@/app/pages/BroadcastsPage'
import { SupportAnalyticsPage } from '@/app/pages/SupportAnalyticsPage'
import { WhatsAppPage } from '@/app/pages/WhatsAppPage'
import { CircleHelp, ExternalLink, Menu } from 'lucide-react'
import { NotificationsBell } from './NotificationsBell'
import { Sheet, SheetContent, SheetTitle } from '@/app/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { HELP_GROUPS } from '@/app/home/helpLinks'
import mark from '@/assets/helo-mark.svg'
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
  settingsTab,
  onNavigate,
  onOpenAgentBuilder,
  onAgentCreated,
  onOpenAgentActivity,
}: {
  /** The page in the address bar (App.tsx). */
  active: NavId
  /** The Settings tab in the address bar (/settings/<tab>). */
  settingsTab: SettingsTab
  onNavigate: (id: NavId, settingsTab?: SettingsTab) => void
  onOpenAgentBuilder: () => void
  onAgentCreated: () => void
  onOpenAgentActivity: () => void
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const setActive = (id: NavId) => {
    setDrawerOpen(false)
    onNavigate(id)
  }
  const openSettings = (tab: SettingsTab) => {
    setDrawerOpen(false)
    onNavigate('settings', tab)
  }
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
            onOpenSettings={openSettings}
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
            onOpenSettings={() => openSettings('whatsapp')}
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
        return <SettingsPage tab={settingsTab} onTabChange={openSettings} onManageNumbers={() => setActive('whatsapp')} />
    }
  }

  return (
    <div className="flex h-dvh bg-background">
      <div className="hidden md:flex">
        <AppSidebar active={active} onNavigate={setActive} onOpenSettings={openSettings} />
      </div>
      {/* Phones: the same navigation in a drawer. */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 p-0 sm:max-w-72">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <AppSidebar drawer active={active} onNavigate={setActive} onOpenSettings={openSettings} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <img src={mark} alt="Helo.ai" className="size-6 md:hidden" />
          <span className="truncate text-sm font-medium md:hidden">{activeItem.label}</span>
          <div className="ml-auto flex items-center gap-1">
            <HelpMenu />
            <NotificationsBell
              onOpenChat={openChat}
              onOpenTarget={(target) => {
                // Number alerts (quality, names) open the WhatsApp page; billing opens Settings.
                if (target === 'broadcasts' || target === 'whatsapp') return setActive(target)
                openSettings(target)
              }}
            />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{renderContent()}</main>
      </div>
    </div>
  )
}

/** Product guides and support, one click away from any page. */
function HelpMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Help and guides" className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <CircleHelp className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
        {HELP_GROUPS.map((g, i) => (
          <div key={g.title}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-meta font-medium text-muted-foreground">{g.title}</DropdownMenuLabel>
            {g.links.map((l) => (
              <DropdownMenuItem key={l.href} asChild>
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{l.title}</span>
                    <span className="block text-meta text-muted-foreground">{l.description}</span>
                  </span>
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                </a>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
