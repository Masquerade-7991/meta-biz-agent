import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronRight, Headset, SearchX, UserRound, Building2, type LucideIcon } from 'lucide-react'
import { EmptyState, PageContainer, PageHeader } from '@/app/components/ui/page'
import { SearchInput } from '@/app/components/Filters'
import { useAuth } from '@/app/auth/AuthContext'
import { pathFor } from '@/app/nav'
import { matchesFilter, visibleAreas, type SettingsAreaId } from './areas'
import { confirmLeave } from './leaveGuard'

const ICON: Record<SettingsAreaId, LucideIcon> = { workspace: Building2, desk: Headset, you: UserRound }

/** /settings: every area as a card listing its tabs, filtered by name as you type. */
export function SettingsHome() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const areas = visibleAreas(me?.role)
    .map((a) => ({ ...a, tabs: a.tabs.filter((t) => matchesFilter(t, a, q)) }))
    .filter((a) => a.tabs.length > 0)

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Your workspace and its people, how the support desk works, and your own account."
        actions={<SearchInput value={q} onChange={setQ} placeholder="Find a setting" label="Find a setting" className="h-9 w-64 max-w-full" />}
      />
      {areas.length === 0 ? (
        <EmptyState icon={SearchX} title="No setting matches" description={`Nothing is called “${q}”. Try another word, like hours, invite or password.`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {areas.map((a) => {
            const Icon = ICON[a.id]
            return (
              <section key={a.id} aria-labelledby={`area-${a.id}`} className="rounded-lg border border-border bg-card">
                <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 id={`area-${a.id}`} className="text-section font-semibold">
                      {a.label}
                    </h2>
                    <p className="text-sm text-muted-foreground">{a.description}</p>
                  </div>
                </div>
                <ul className="p-2">
                  {a.tabs.map((t) => {
                    const href = pathFor('settings', t.slug)
                    return (
                      <li key={t.slug}>
                        <a
                          href={href}
                          onClick={(e) => {
                            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                            e.preventDefault()
                            void confirmLeave().then((ok) => ok && navigate(href))
                          }}
                          className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{t.label}</span>
                            <span className="block text-xs text-muted-foreground">{t.description}</span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
