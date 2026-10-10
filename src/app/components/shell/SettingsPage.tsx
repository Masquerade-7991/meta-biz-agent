import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { Tabs, TabsContent } from '@/app/components/ui/tabs'
import { cn } from '@/app/lib/utils'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useAuth } from '@/app/auth/AuthContext'
import { Field, FormError } from '@/app/auth/AuthLayout'
import { CannedResponsesSettings } from './CannedResponsesSettings'
import { SupportSettingsTab } from './SupportSettings'
import { TeamsSettings } from './TeamsSettings'
import { RoutingRulesSettings } from './RoutingRulesSettings'
import { EscalationSettings } from './EscalationSettings'
import { BillingSettingsTab } from './BillingSettings'
import { ContactFieldsSettings } from './ContactFieldsSettings'
import { authApi, type Invite, type Member } from '@/app/auth/api'
import { Label } from '@/app/components/ui/label'
import { errorDetail } from '@/app/api/meta'
import { SettingsSection } from './SettingsSection'
import { WhatsAppSettings } from './WhatsAppSettings'
import { assignableRoles, can, canSetRole, roleLabel, ROLES, type Role } from '@/app/lib/permissions'
import { PageLoader } from '@/app/components/ui/wavy-loader'

export type SettingsTab = 'profile' | 'whatsapp' | 'billing' | 'members' | 'canned' | 'support' | 'fields' | 'teams' | 'routing' | 'escalation'


const days = (from: string, to = Date.now()) => Math.round((to - Date.parse(from)) / 86_400_000)
const ago = (iso: string) => {
  const d = days(iso)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}


/** Shared busy/error handling for one settings form. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function Spinner({ on }: { on: boolean }) {
  return on ? <Loader2 className="size-4 animate-spin" /> : null
}

// ---- Profile ----
function Profile() {
  const { me, setMe } = useAuth()
  const [name, setName] = useState(me?.user.name ?? '')
  const nameAction = useAction()
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const emailAction = useAction()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const pwAction = useAction()

  const saveName = (e: FormEvent) => {
    e.preventDefault()
    void nameAction.run(async () => {
      setMe(await authApi.updateName(name))
      toast.success('Name updated')
    })
  }
  const sendEmailLink = (e: FormEvent) => {
    e.preventDefault()
    void emailAction.run(async () => {
      await authApi.changeEmail(newEmail, emailPassword)
      toast.success('Confirmation link sent', { description: `Open the link we sent to ${newEmail}. Your email changes when you do.` })
      setNewEmail('')
      setEmailPassword('')
    })
  }
  const changePassword = (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return void pwAction.run(() => Promise.reject(new Error('The two new passwords don’t match.')))
    void pwAction.run(async () => {
      await authApi.changePassword(current, next)
      toast.success('Password changed', { description: 'Other devices were logged out.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    })
  }

  return (
    <div>
      <SettingsSection title="Your name" description="Shown to people in your workspace and in invite emails.">
        <form onSubmit={saveName} className="space-y-4">
          <Field label="Full name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          {nameAction.error && <FormError>{nameAction.error}</FormError>}
          <Button type="submit" disabled={nameAction.busy || !name.trim() || name.trim() === me?.user.name}>
            <Spinner on={nameAction.busy} />
            Save name
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection title="Email" description={`You log in with ${me?.user.email}. To change it, we send a confirmation link to the new address.`}>
        <form onSubmit={sendEmailLink} className="space-y-4">
          <Field label="New email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <Field label="Current password" type="password" autoComplete="current-password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} />
          {emailAction.error && <FormError>{emailAction.error}</FormError>}
          <Button type="submit" disabled={emailAction.busy || !newEmail || !emailPassword}>
            <Spinner on={emailAction.busy} />
            Send confirmation link
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection title="Password" description="Changing it logs you out on every other device.">
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Field label="New password" type="password" autoComplete="new-password" hint="At least 8 characters." value={next} onChange={(e) => setNext(e.target.value)} />
          <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {pwAction.error && <FormError>{pwAction.error}</FormError>}
          <Button type="submit" disabled={pwAction.busy || !current || !next || !confirm}>
            <Spinner on={pwAction.busy} />
            Change password
          </Button>
        </form>
      </SettingsSection>
    </div>
  )
}

// ---- Members ----
/** A role menu that says what each role can do. `roles` = the ones this person may give. */
function RolePicker({ id, label, value, roles, compact, onChange }: { id: string; label: string; value: Role; roles: typeof ROLES; compact?: boolean; onChange: (r: Role) => void }) {
  return (
    <div className={compact ? '' : 'space-y-1.5'}>
      {!compact && <Label htmlFor={id}>{label}</Label>}
      <Select value={value} onValueChange={(v) => onChange(v as Role)}>
        <SelectTrigger id={id} className={compact ? 'w-36' : 'w-full'} aria-label={label}>
          <SelectValue>{roleLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-sm">
          {roles.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              <span className="block">{r.label}</span>
              <span className="block whitespace-normal text-muted-foreground text-xs">
                {r.description}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Members() {
  const { me } = useAuth()
  const manage = can(me?.role, 'members.manage')
  const roles = assignableRoles(me?.role)
  const [inviteRole, setInviteRole] = useState<Role>('agent')
  const [data, setData] = useState<{ members: Member[]; invites: Invite[]; joining: { email: string; verifiedAt: string }[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const inviteAction = useAction()
  const [confirming, setConfirming] = useState<{ kind: 'remove'; member: Member } | { kind: 'revoke'; invite: Invite } | null>(null)

  const load = useCallback(() => {
    authApi.members().then(
      (d) => {
        setData(d)
        setLoadError(null)
      },
      (err) => setLoadError(errorDetail(err)),
    )
  }, [])
  useEffect(load, [load])

  const sendInvite = (e: FormEvent) => {
    e.preventDefault()
    void inviteAction.run(async () => {
      await authApi.invite(email, inviteRole)
      toast.success('Invite sent', { description: `${email} can join as ${roleLabel(inviteRole)} with the link we emailed. It expires in 7 days.` })
      setEmail('')
      load()
    })
  }
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast.success(done)
    } catch (err) {
      toast.error(errorDetail(err))
    }
    load()
  }

  return (
    <div>
      {manage && (
        <SettingsSection title="Invite people" description="They get an email with a link to set up their account and join with the role you pick. Invites expire after 7 days.">
          <form onSubmit={sendInvite} className="space-y-4">
            <Field label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            <RolePicker id="invite-role" label="Role" value={inviteRole} roles={roles} onChange={setInviteRole} />
            {inviteAction.error && <FormError>{inviteAction.error}</FormError>}
            <Button type="submit" disabled={inviteAction.busy || !email}>
              <Spinner on={inviteAction.busy} />
              Send invite
            </Button>
          </form>
        </SettingsSection>
      )}

      <section className="space-y-3 py-8">
        <div className="space-y-1">
          <h2 className="text-section font-semibold">Members of {me?.workspace?.name}</h2>
          <p className="text-muted-foreground text-sm">
            {manage
              ? `${me?.role === 'owner' ? 'Owners' : 'Admins'} invite people, change roles and remove members${me?.role === 'owner' ? '' : ', except owners'}. Every workspace needs at least one owner.`
              : 'Owners and admins invite people, change roles and remove members.'}
          </p>
        </div>
        {loadError && <FormError>{loadError}</FormError>}
        {!data && !loadError && (
          <PageLoader context="settings" className="min-h-[30vh] py-10" />
        )}
        {data && (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  {manage && <TableHead className="w-0" aria-label="Actions" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((m) => {
                  const self = m.userId === me?.user.id
                  // Admins manage everyone but owners; nobody changes their own role here.
                  const editable = manage && !self && canSetRole(me?.role, m.role, 'agent')
                  return (
                    <TableRow key={m.userId}>
                      <TableCell>
                        <div className="font-medium">
                          {m.name}
                          {self && <span className="text-muted-foreground"> (you)</span>}
                        </div>
                        <div className="text-muted-foreground text-sm">
                          {m.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <RolePicker
                            id={`role-${m.userId}`}
                            label={`Role for ${m.name}`}
                            value={m.role}
                            roles={roles}
                            compact
                            onChange={(role) => void act(() => authApi.setRole(m.userId, role), `${m.name} is now ${roleLabel(role)}`)}
                          />
                        ) : (
                          <Badge variant="outline">{roleLabel(m.role)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ago(m.joinedAt)}</TableCell>
                      {manage && (
                        <TableCell>
                          {editable && (
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming({ kind: 'remove', member: m })}>
                              Remove
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {manage && data && (data.invites.length > 0 || data.joining.length > 0) && (
        <section className="space-y-3 border-t border-border py-8">
          <h2 className="text-section font-semibold">Pending invites</h2>
          <div className="rounded-lg border border-border">
            <Table>
              <TableBody>
                {data.joining.map((j) => (
                  <TableRow key={j.email}>
                    <TableCell colSpan={2}>
                      <div className="font-medium">{j.email}</div>
                      <div className="text-muted-foreground text-sm">
                        Email verified {ago(j.verifiedAt)}, finishing account setup
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {data.invites.map((i) => {
                  const left = Math.max(0, -days(i.expiresAt))
                  return (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="font-medium">{i.email}</div>
                        <div className="text-muted-foreground text-sm">
                          {roleLabel(i.role)} &middot; sent {ago(i.invitedAt)}, expires {left <= 1 ? 'within a day' : `in ${left} days`}
                        </div>
                      </TableCell>
                      <TableCell className="w-0 whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => void act(() => authApi.resendInvite(i.id), `Invite resent to ${i.email}`)}>
                          Resend
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming({ kind: 'revoke', invite: i })}>
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={!!confirming}
        title={confirming?.kind === 'remove' ? `Remove ${confirming.member.name}?` : `Revoke the invite to ${confirming?.kind === 'revoke' ? confirming.invite.email : ''}?`}
        description={
          confirming?.kind === 'remove'
            ? `They’ll be logged out and lose access to ${me?.workspace?.name}. Their account stays, and you can invite them again later.`
            : 'The link in their email will stop working. You can invite them again later.'
        }
        confirmLabel={confirming?.kind === 'remove' ? 'Remove' : 'Revoke invite'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const c = confirming
          setConfirming(null)
          if (c?.kind === 'remove') void act(() => authApi.removeMember(c.member.userId), `${c.member.name} was removed`)
          if (c?.kind === 'revoke') void act(() => authApi.revokeInvite(c.invite.id), `Invite to ${c.invite.email} revoked`)
        }}
      />
    </div>
  )
}

const SETTINGS_GROUPS: { label: string; items: { id: SettingsTab; label: string }[] }[] = [
  {
    label: 'Workspace',
    items: [
      { id: 'members', label: 'Members' },
      { id: 'billing', label: 'Billing' },
      { id: 'whatsapp', label: 'WhatsApp' },
    ],
  },
  {
    label: 'Support desk',
    items: [
      { id: 'support', label: 'Hours & response targets' },
      { id: 'teams', label: 'Teams & people' },
      { id: 'routing', label: 'Routing rules' },
      { id: 'escalation', label: 'Escalation' },
      { id: 'canned', label: 'Canned responses' },
      { id: 'fields', label: 'Contact fields' },
    ],
  },
  { label: 'You', items: [{ id: 'profile', label: 'Profile' }] },
]

export function SettingsPage({ tab, onTabChange, onManageNumbers }: { tab: SettingsTab; onTabChange: (t: SettingsTab) => void; onManageNumbers?: () => void }) {
  const { me } = useAuth()
  const billing = can(me?.role, 'billing.view')
  // WhatsApp accounts and webhook details are the owner's alone.
  const whatsapp = can(me?.role, 'whatsapp.manage')
  // A link (email, notification) can name a tab this role can't open; show Profile instead.
  const shown = (tab === 'billing' && !billing) || (tab === 'whatsapp' && !whatsapp) ? 'profile' : tab
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="mb-6">Settings</h1>
      <Tabs value={shown} onValueChange={(v) => onTabChange(v as SettingsTab)} className="gap-6 md:flex-row md:items-start">
        {/* Grouped by whose settings they are: the workspace, the support desk, and you. */}
        <nav aria-label="Settings sections" className="shrink-0 md:w-52">
          <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:gap-4 md:overflow-visible md:pb-0">
            {SETTINGS_GROUPS.map((g) => (
              <li key={g.label} className="contents md:block">
                <p className="hidden px-2.5 pb-1.5 text-xs font-medium text-muted-foreground md:block">{g.label}</p>
                <ul className="contents md:block md:space-y-0.5">
                  {g.items
                    .filter((i) => (i.id !== 'billing' || billing) && (i.id !== 'whatsapp' || whatsapp))
                    .map((i) => (
                      <li key={i.id} className="shrink-0">
                        <button
                          type="button"
                          onClick={() => onTabChange(i.id)}
                          aria-current={shown === i.id ? 'page' : undefined}
                          className={cn(
                            'w-full rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors',
                            shown === i.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          {i.label}
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 [&>[data-slot=tabs-content]]:pt-0">
        <TabsContent value="profile">
          <Profile />
        </TabsContent>
        {whatsapp && (
          <TabsContent value="whatsapp">
            <WhatsAppSettings onManageNumbers={onManageNumbers} />
          </TabsContent>
        )}
        {billing && (
          <TabsContent value="billing">
            <BillingSettingsTab />
          </TabsContent>
        )}
        <TabsContent value="members">
          <Members />
        </TabsContent>
        <TabsContent value="canned">
          <CannedResponsesSettings />
        </TabsContent>
        <TabsContent value="support">
          <SupportSettingsTab />
        </TabsContent>
        <TabsContent value="teams">
          <TeamsSettings />
        </TabsContent>
        <TabsContent value="routing">
          <RoutingRulesSettings />
        </TabsContent>
        <TabsContent value="escalation">
          <EscalationSettings />
        </TabsContent>
        <TabsContent value="fields">
          <ContactFieldsSettings />
        </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
