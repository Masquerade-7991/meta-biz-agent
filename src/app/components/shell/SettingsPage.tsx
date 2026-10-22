import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { PageContainer, PageHeader } from '@/app/components/ui/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { useAuth } from '@/app/auth/AuthContext'
import { authApi, type Member } from '@/app/auth/api'
import { MembersContext } from '@/app/auth/membersContext'
import { pathFor } from '@/app/nav'
import { ActivitySettings } from '@/app/activity/ActivitySettings'
import { CannedResponsesSettings } from './CannedResponsesSettings'
import { SupportSettingsTab } from './SupportSettings'
import { TeamsSettings } from './TeamsSettings'
import { RoutingRulesSettings } from './RoutingRulesSettings'
import { EscalationSettings } from './EscalationSettings'
import { BillingSettingsTab } from './BillingSettings'
import { ContactFieldsSettings } from './ContactFieldsSettings'
import { ApiTokensSettings } from './ApiTokensSettings'
import { GeneralSettings } from './settings/GeneralSettings'
import { MembersSettings } from './settings/MembersSettings'
import { ProfileSettings } from './settings/ProfileSettings'
import { NotificationsSettings } from './settings/NotificationsSettings'
import { SecuritySettings } from './settings/SecuritySettings'
import { SettingsHome } from './settings/SettingsHome'
import { areaOf, canOpenTab, resolveSettings, type SettingsTab } from './settings/areas'
import { confirmLeave } from './settings/leaveGuard'

export type { SettingsTab } from './settings/areas'

/** Each tab's page, by its address. */
const TABS: Record<SettingsTab, () => ReactNode> = {
  general: () => <GeneralSettings />,
  members: () => <MembersSettings />,
  activity: () => <ActivitySettings />,
  billing: () => <BillingSettingsTab />,
  support: () => <SupportSettingsTab />,
  teams: () => <TeamsSettings />,
  routing: () => <RoutingRulesSettings />,
  escalation: () => <EscalationSettings />,
  canned: () => <CannedResponsesSettings />,
  fields: () => <ContactFieldsSettings />,
  profile: () => <ProfileSettings />,
  notifications: () => <NotificationsSettings />,
  security: () => <SecuritySettings />,
  tokens: () => <ApiTokensSettings />,
}

/** The workspace's people, loaded once for every Settings tab. */
function MembersProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const reload = useCallback(() => {
    authApi.members().then(
      (r) => setMembers(r.members),
      () => me && setMembers([{ userId: me.user.id, name: me.user.name, email: me.user.email, role: me.role ?? 'owner', joinedAt: '' }]),
    )
  }, [me])
  useEffect(reload, [reload])
  const value = useMemo(() => ({ members, reload }), [members, reload])
  return <MembersContext.Provider value={value}>{children}</MembersContext.Provider>
}

/** /settings is the home; /settings/<tab> is one area's page with its tabs along the top. */
export function SettingsPage({ slug }: { slug?: string }) {
  const { me } = useAuth()
  const route = resolveSettings(slug, me?.role)
  // App.tsx redirects before this page loads; a role change while here lands on the home.
  if (route.kind === 'redirect') return <SettingsHome />
  if (route.kind === 'home') return <SettingsHome />
  return (
    <MembersProvider>
      <AreaPage tab={route.tab} />
    </MembersProvider>
  )
}

function AreaPage({ tab }: { tab: SettingsTab }) {
  const { me } = useAuth()
  const navigate = useNavigate()
  const area = areaOf(tab)
  const tabs = area.tabs.filter((t) => canOpenTab(me?.role, t.slug))
  const go = (t: string) => void confirmLeave().then((ok) => ok && navigate(pathFor('settings', t)))
  const active = useRef<HTMLAnchorElement>(null)
  // A deep link (or a narrow screen) can start with the tab off to the side: bring it into view.
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [tab])

  return (
    <PageContainer>
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="flex items-center gap-1 text-sm text-muted-foreground">
          <li>
            <a
              href="/settings"
              className="hover:text-foreground hover:underline"
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                e.preventDefault()
                go('')
              }}
            >
              Settings
            </a>
          </li>
          <li aria-hidden>
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="text-foreground">
            {area.label}
          </li>
        </ol>
      </nav>
      <PageHeader title={area.label} description={area.description} className="mb-4" />
      <Tabs value={tab} onValueChange={go}>
        <div className="relative">
          <TabsList aria-label={`${area.label} settings`}>
            {tabs.map((t) => (
              <TabsTrigger key={t.slug} value={t.slug} asChild>
                <a
                  href={pathFor('settings', t.slug)}
                  ref={t.slug === tab ? active : undefined}
                  // One click is one history entry: Radix would also change tabs on mousedown and on the
                  // focus that follows (even on a ⌘-click), so a press skips both and the click navigates.
                  // Arrow keys still move focus, and Radix's onValueChange (go) changes the tab.
                  onMouseDown={(e) => {
                    if (e.button === 0) e.preventDefault()
                  }}
                  onClick={(e) => {
                    // A plain click goes through the unsaved-changes check; a middle- or modifier-click
                    // opens the tab's address on its own.
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                    e.preventDefault()
                    if (t.slug !== tab) go(t.slug)
                  }}
                >
                  {t.label}
                </a>
              </TabsTrigger>
            ))}
          </TabsList>
          {/* More tabs to the side on a narrow screen: the strip fades out at the edge. */}
          <span aria-hidden className="pointer-events-none absolute top-0 right-0 bottom-px w-8 bg-linear-to-l from-background md:hidden" />
        </div>
        <TabsContent value={tab} className="pt-2">
          {TABS[tab]()}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
