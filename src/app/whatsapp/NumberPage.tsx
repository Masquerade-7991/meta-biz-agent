import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { errorDetail } from '@/app/api/meta'
import { getNumber, type NumberDetail } from '@/app/api/numbers'
import { cn } from '@/app/lib/utils'
import { MANAGER_URL, statusHelp } from './profileRules'
import { ProfileTab } from './ProfileTab'
import { AutomationTab, DisplayNameTab } from './NumberSettingsTabs'
import { SecurityTab } from './SecurityTab'
import { BlockedTab } from './BlockedTab'
import { PageLoader } from '@/app/components/ui/wavy-loader'

export type NumberTab = 'profile' | 'name' | 'automation' | 'security' | 'blocked' | 'activity'
/** What every tab gets: the number, a way to show what Meta now says, and the dirty flag for the guard. */
export interface TabProps {
  detail: NumberDetail
  onSaved: (d: NumberDetail) => void
  onDirty: (dirty: boolean) => void
}

const QUALITY: Record<string, { label: string; dot: string }> = {
  GREEN: { label: 'High quality', dot: 'bg-success' },
  YELLOW: { label: 'Medium quality', dot: 'bg-amber-500' },
  RED: { label: 'Low quality', dot: 'bg-destructive' },
}
const ACTIVITY: Record<string, string> = {
  profile_updated: 'Updated the profile',
  photo_updated: 'Changed the profile photo',
  name_requested: 'Asked for a new display name',
  name_reviewed: 'Display name review finished',
  automation_updated: 'Changed ice breakers or commands',
  pin_changed: 'Changed the two-step PIN',
  pin_viewed: 'Looked at the two-step PIN',
  registered: 'Registered the number',
  deregistered: 'Deregistered the number',
  code_requested: 'Asked for a verification code',
  verified: 'Verified ownership',
  blocked: 'Blocked a customer',
  unblocked: 'Unblocked a customer',
  webhook_changed: 'Changed where webhooks go',
}

export function NumberAvatar({ photo, name, size = 'md' }: { photo: string | null; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const px = { sm: 'size-8', md: 'size-12', lg: 'size-24' }[size]
  return photo ? (
    <img src={photo} alt="" className={cn(px, 'shrink-0 rounded-full object-cover')} />
  ) : (
    <span className={cn('font-semibold', px, 'flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground')}>
      {name.trim().slice(0, 1).toUpperCase() || '#'}
    </span>
  )
}

/** One number, managed like WhatsApp Manager does it: profile, name, ice breakers, security, blocks. */
export function NumberPage({ id, showBack, onBack, backLabel = 'All numbers', initialTab = 'profile' }: { id: string; showBack: boolean; onBack: () => void; backLabel?: string; initialTab?: NumberTab }) {
  const [d, setD] = useState<NumberDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<NumberTab>(initialTab)
  const [dirty, setDirty] = useState(false)
  // Leaving a tab (or the page) with unsaved changes asks first.
  const [leaving, setLeaving] = useState<(() => void) | null>(null)
  const guard = (go: () => void) => (dirty ? setLeaving(() => go) : go())

  const load = useCallback(() => {
    setError(null)
    getNumber(id).then(setD, (err) => setError(errorDetail(err)))
  }, [id])
  useEffect(load, [load])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (error)
    return (
      <div className="space-y-3">
        <FormError>{error}</FormError>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCw className="size-4" /> Try again
          </Button>
          {showBack && (
            <Button variant="ghost" onClick={onBack}>
              {backLabel}
            </Button>
          )}
        </div>
      </div>
    )
  if (!d)
    return (
      <PageLoader context="whatsapp" />
    )

  const n = d.number
  const st = statusHelp(n.status)
  const q = QUALITY[n.quality]
  const props: TabProps = { detail: d, onSaved: (x) => (setD(x), setDirty(false)), onDirty: setDirty }

  return (
    <div className="space-y-6">
      {showBack && (
        <button type="button" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm" onClick={() => guard(onBack)}>
          <ArrowLeft className="size-4" /> {backLabel}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <NumberAvatar photo={d.profile.photo} name={n.verifiedName} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="flex flex-wrap items-center gap-2">
            {n.verifiedName || n.display}
            {d.official && <Badge className="bg-success text-success-foreground">Official business</Badge>}
          </h1>
          <p className="text-muted-foreground text-sm">
            {n.display} &middot; {n.wabaName}
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', st.tone === 'ok' ? 'bg-success' : st.tone === 'warn' ? 'bg-amber-500' : 'bg-destructive')} />
              {st.label}
            </span>
            <span className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', q?.dot ?? 'bg-muted-foreground')} />
              {q?.label ?? 'Quality not rated yet'}
            </span>
            {n.limit && <span>Daily limit: {n.limit.replace('TIER_', '').replace('UNLIMITED', 'unlimited')} new conversations</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={MANAGER_URL} target="_blank" rel="noreferrer">
            WhatsApp Manager <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>

      {st.tone !== 'ok' && (
        <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm', st.tone === 'bad' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/40 bg-amber-500/5')}>
          <span className="min-w-60 flex-1">
            <strong>{st.label}.</strong> {st.help}
          </span>
          {(st.action === 'verify' || st.action === 'register') && (
            <Button size="sm" onClick={() => guard(() => setTab('security'))}>
              {st.action === 'verify' ? 'Verify the number' : 'Register it'}
            </Button>
          )}
          {st.action === 'manager' && (
            <Button size="sm" variant="outline" asChild>
              <a href={MANAGER_URL} target="_blank" rel="noreferrer">
                Open WhatsApp Manager <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => guard(() => setTab(v as NumberTab))}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="name">Display name</TabsTrigger>
          <TabsTrigger value="automation">Ice breakers</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="blocked">Blocked</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab {...props} />
        </TabsContent>
        <TabsContent value="name">
          <DisplayNameTab {...props} onRegister={() => setTab('security')} />
        </TabsContent>
        <TabsContent value="automation">
          <AutomationTab {...props} />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab {...props} />
        </TabsContent>
        <TabsContent value="blocked">
          <BlockedTab {...props} />
        </TabsContent>
        <TabsContent value="activity">
          {d.activity.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
              No changes from this console yet. Changes made here, and WhatsApp&rsquo;s reviews, show up in this list.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {d.activity.map((a, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>
                    {ACTIVITY[a.kind] ?? a.kind}
                    {typeof a.data.name === 'string' && <span className="text-muted-foreground"> &ldquo;{a.data.name}&rdquo;</span>}
                    {typeof a.data.decision === 'string' && <span className="text-muted-foreground"> ({a.data.decision.toLowerCase()})</span>}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {a.by} &middot; {new Date(a.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={leaving !== null}
        title="Leave without saving?"
        description="Your changes on this tab haven’t been sent to WhatsApp yet."
        confirmLabel="Leave without saving"
        onCancel={() => setLeaving(null)}
        onConfirm={() => {
          const go = leaving
          setLeaving(null)
          setDirty(false)
          go?.()
        }}
      />
    </div>
  )
}
