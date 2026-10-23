import { useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2, Users } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { EmptyState } from '@/app/components/ui/page'
import { Label } from '@/app/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useOmnibarScope } from '@/app/omnibar/OmnibarContext'
import { useAuth } from '@/app/auth/AuthContext'
import { Field, FormError } from '@/app/auth/AuthLayout'
import { authApi, type Invite, type Joining, type Member } from '@/app/auth/api'
import { MembersContext } from '@/app/auth/membersContext'
import { errorDetail } from '@/app/api/meta'
import { assignableRoles, can, canSetRole, roleLabel, ROLES, type Role } from '@/app/lib/permissions'
import { SettingsSection } from '../SettingsSection'
import { WorkspaceTokens } from '../ApiTokensSettings'
import { LoadGate } from './SettingsUi'

const days = (from: string, to = Date.now()) => Math.round((to - Date.parse(from)) / 86_400_000)
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`
  const d = days(iso)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
const ANY = 'any'

/** A role menu that says what each role can do. `roles` = the ones this person may give. */
function RolePicker({ id, label, value, roles, compact, disabled, onChange }: { id: string; label: string; value: Role; roles: typeof ROLES; compact?: boolean; disabled?: boolean; onChange: (r: Role) => void }) {
  return (
    <div className={compact ? '' : 'space-y-1.5'}>
      {!compact && <Label htmlFor={id}>{label}</Label>}
      <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
        <SelectTrigger id={id} className={compact ? 'w-36' : 'w-full'} aria-label={label}>
          <SelectValue>{roleLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-sm">
          {roles.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              <span className="block">{r.label}</span>
              <span className="block whitespace-normal text-xs text-muted-foreground">{r.description}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type Confirming =
  | { kind: 'remove'; member: Member }
  | { kind: 'revoke'; invite: Invite }
  | { kind: 'role'; member: Member; role: Role }
  | { kind: 'joining'; joining: Joining }

/** Workspace › Members: invite people, change roles, remove members, and everyone's API tokens. */
export function MembersSettings() {
  const { me } = useAuth()
  const shared = useContext(MembersContext)
  const manage = can(me?.role, 'members.manage')
  const roles = assignableRoles(me?.role)
  const [inviteRole, setInviteRole] = useState<Role>('agent')
  const [data, setData] = useState<{ members: Member[]; invites: Invite[]; joining: Joining[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | typeof ANY>(ANY)

  const load = useCallback(() => {
    setLoadError(null)
    authApi.members().then(setData, (err) => setLoadError(errorDetail(err)))
  }, [])
  useEffect(load, [load])
  // The omnibar searches the members list (name or email).
  useOmnibarScope(useMemo(() => ({ id: 'settings/members', placeholder: 'Search people by name or email', query: { value: q, onChange: setQ } }), [q]))
  if (!data) return <LoadGate error={loadError} onRetry={load} what="the members" />

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault()
    setInviting(true)
    setInviteError(null)
    try {
      await authApi.invite(email.trim(), inviteRole)
      toast.success('Invite sent', { description: `${email.trim()} can join as ${roleLabel(inviteRole)} with the link we emailed. It expires in 7 days.` })
      setEmail('')
      load()
    } catch (err) {
      setInviteError(errorDetail(err))
    } finally {
      setInviting(false)
    }
  }
  /** Runs one row's action with that row busy, then reloads the list (and Settings' shared people). */
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(done)
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setBusy(null)
      load()
      shared?.reload()
    }
  }

  const counts = ROLES.map((r) => ({ ...r, n: data.members.filter((m) => m.role === r.id).length })).filter((r) => r.n > 0)
  const needle = q.trim().toLowerCase()
  const shown = data.members.filter((m) => (roleFilter === ANY || m.role === roleFilter) && (!needle || `${m.name} ${m.email}`.toLowerCase().includes(needle)))
  const live = data.invites.filter((i) => !i.expired)
  const expired = data.invites.filter((i) => i.expired)

  return (
    <div>
      {manage && (
        <SettingsSection title="Invite people" description="They get an email to join with the role you pick. People who already use Helo.ai keep their other workspaces and accept in the app. Invites expire after 7 days.">
          <form onSubmit={sendInvite} className="space-y-4">
            <Field label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            <RolePicker id="invite-role" label="Role" value={inviteRole} roles={roles} onChange={setInviteRole} />
            {inviteError && <FormError>{inviteError}</FormError>}
            <Button type="submit" disabled={inviting || !email.trim()}>
              {inviting && <Loader2 className="size-4 animate-spin" />}
              Send invite
            </Button>
          </form>
        </SettingsSection>
      )}

      <SettingsSection
        stacked
        title={`Members of ${me?.workspace?.name ?? 'this workspace'}`}
        description={
          manage
            ? `${me?.role === 'owner' ? 'Owners' : 'Admins'} invite people, change roles and remove members${me?.role === 'owner' ? '' : ', except owners'}. Every workspace needs at least one owner.`
            : 'Owners and admins invite people, change roles and remove members.'
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as Role | typeof ANY)}>
            <SelectTrigger className="h-9 w-40" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-meta text-muted-foreground sm:ml-auto">
            {data.members.length} {data.members.length === 1 ? 'member' : 'members'}: {counts.map((r) => `${r.n} ${r.label.toLowerCase()}${r.n === 1 ? '' : 's'}`).join(', ')}
          </p>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={Users} title="Nobody matches" description="Try another name, or all roles." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
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
                {shown.map((m) => {
                  const self = m.userId === me?.user.id
                  // Admins manage everyone but owners; nobody changes their own role here.
                  const editable = manage && !self && canSetRole(me?.role, m.role, 'agent')
                  return (
                    <TableRow key={m.userId} data-density-row>
                      <TableCell>
                        <div className="font-medium">
                          {m.name}
                          {self && <span className="text-muted-foreground"> (you)</span>}
                        </div>
                        <div className="text-sm text-muted-foreground">{m.email}</div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <span className="flex items-center gap-2">
                            <RolePicker id={`role-${m.userId}`} label={`Role for ${m.name}`} value={m.role} roles={roles} compact disabled={busy === m.userId} onChange={(role) => role !== m.role && setConfirming({ kind: 'role', member: m, role })} />
                            {busy === m.userId && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                          </span>
                        ) : (
                          <Badge variant="outline">{roleLabel(m.role)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.joinedAt ? ago(m.joinedAt) : ''}</TableCell>
                      {manage && (
                        <TableCell>
                          {editable && (
                            <Button variant="ghost" size="sm" className="text-destructive" disabled={busy === m.userId} onClick={() => setConfirming({ kind: 'remove', member: m })}>
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
      </SettingsSection>

      {manage && (data.invites.length > 0 || data.joining.length > 0) && (
        <SettingsSection stacked title="Pending invites" description="Expired invites stay here until you resend or revoke them.">
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableBody>
                {data.joining.map((j) => (
                  <TableRow key={j.email} data-density-row>
                    <TableCell>
                      <div className="font-medium">{j.email}</div>
                      <div className="text-sm text-muted-foreground">
                        {j.role ? `${roleLabel(j.role)} · ` : ''}Email verified {ago(j.verifiedAt)}, finishing account setup
                      </div>
                    </TableCell>
                    <TableCell className="w-0 whitespace-nowrap">
                      {j.userId && (
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy === j.userId} onClick={() => setConfirming({ kind: 'joining', joining: j })}>
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {[...live, ...expired].map((i) => {
                  const left = Math.max(0, -days(i.expiresAt))
                  // An owner invite is the owners' to resend or revoke.
                  const mine = canSetRole(me?.role, i.role, i.role)
                  return (
                    <TableRow key={i.id} data-density-row>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          {i.email}
                          {i.expired && <Badge variant="warning">Expired</Badge>}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {roleLabel(i.role)} &middot; sent {ago(i.sentAt ?? i.invitedAt)}
                          {i.expired ? ', the link no longer works' : `, expires ${left <= 1 ? 'within a day' : `in ${left} days`}`}
                        </div>
                      </TableCell>
                      <TableCell className="w-0 whitespace-nowrap">
                        {mine ? (
                          <>
                            <Button variant="ghost" size="sm" disabled={busy === i.id} onClick={() => void act(i.id, () => authApi.resendInvite(i.id), `Invite resent to ${i.email}`)}>
                              {busy === i.id && <Loader2 className="size-3.5 animate-spin" />}
                              Resend
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" disabled={busy === i.id} onClick={() => setConfirming({ kind: 'revoke', invite: i })}>
                              Revoke
                            </Button>
                          </>
                        ) : (
                          <span className="text-meta text-muted-foreground">Owners manage this invite</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </SettingsSection>
      )}

      {can(me?.role, 'tokens.manage') && <WorkspaceTokens />}

      <ConfirmDialog
        open={!!confirming}
        tone={confirming?.kind === 'role' && confirming.role !== 'owner' ? 'default' : 'danger'}
        title={
          confirming?.kind === 'remove'
            ? `Remove ${confirming.member.name}?`
            : confirming?.kind === 'role'
              ? confirming.role === 'owner'
                ? `Make ${confirming.member.name} an owner?`
                : `Make ${confirming.member.name} ${/^[aeiou]/i.test(roleLabel(confirming.role)) ? 'an' : 'a'} ${roleLabel(confirming.role)}?`
              : confirming?.kind === 'joining'
                ? `Cancel ${confirming.joining.email}’s sign-up?`
                : `Revoke the invite to ${confirming?.kind === 'revoke' ? confirming.invite.email : ''}?`
        }
        description={
          confirming?.kind === 'remove'
            ? `They’ll be logged out and lose access to ${me?.workspace?.name}. Their account stays, and you can invite them again later.`
            : confirming?.kind === 'role'
              ? confirming.role === 'owner'
                ? 'Owners control WhatsApp accounts, billing and other owners. Admins can’t undo this.'
                : `${ROLES.find((r) => r.id === confirming.role)?.description} They’ll see the change the next time a page loads.`
              : confirming?.kind === 'joining'
                ? 'They won’t join this workspace when they finish setting up. You can invite them again later.'
                : 'The link in their email will stop working, and if they already opened it they can’t finish joining. You can invite them again later.'
        }
        confirmLabel={confirming?.kind === 'remove' ? 'Remove' : confirming?.kind === 'role' ? 'Change role' : confirming?.kind === 'joining' ? 'Cancel sign-up' : 'Revoke invite'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const c = confirming
          setConfirming(null)
          if (c?.kind === 'remove') void act(c.member.userId, () => authApi.removeMember(c.member.userId), `${c.member.name} was removed`)
          if (c?.kind === 'role') void act(c.member.userId, () => authApi.setRole(c.member.userId, c.role), `${c.member.name} is now ${roleLabel(c.role)}`)
          if (c?.kind === 'revoke') void act(c.invite.id, () => authApi.revokeInvite(c.invite.id), `Invite to ${c.invite.email} revoked`)
          if (c?.kind === 'joining' && c.joining.userId) void act(c.joining.userId, () => authApi.cancelJoining(c.joining.userId!), `${c.joining.email} won’t join`)
        }}
      />
    </div>
  )
}
