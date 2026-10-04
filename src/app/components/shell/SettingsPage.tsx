import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useAuth } from '@/app/auth/AuthContext'
import { Field, FormError } from '@/app/auth/AuthLayout'
import { CannedResponsesSettings } from './CannedResponsesSettings'
import { SupportSettingsTab } from './SupportSettings'
import { ContactFieldsSettings } from './ContactFieldsSettings'
import { authApi, type Invite, type Member, type Role } from '@/app/auth/api'
import { errorDetail } from '@/app/api/meta'
import { SECTION_TITLE } from '@/app/lib/text'
import { SettingsSection } from './SettingsSection'

export type SettingsTab = 'profile' | 'members' | 'canned' | 'support' | 'fields'


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
function Members() {
  const { me } = useAuth()
  const owner = me?.role === 'owner'
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
      await authApi.invite(email)
      toast.success('Invite sent', { description: `${email} can join with the link we emailed. It expires in 7 days.` })
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
      {owner && (
        <SettingsSection title="Invite people" description="They get an email with a link to set up their account and join as a member. Invites expire after 7 days.">
          <form onSubmit={sendInvite} className="space-y-4">
            <Field label="Email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
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
          <h2 style={SECTION_TITLE}>Members of {me?.workspace?.name}</h2>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            {owner
              ? 'Owners can invite people, change roles and remove members. Members work on the agents. Every workspace needs at least one owner.'
              : 'Only owners can invite people, change roles or remove members.'}
          </p>
        </div>
        {loadError && <FormError>{loadError}</FormError>}
        {!data && !loadError && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status" style={{ fontSize: 'var(--text-sm)' }}>
            <Loader2 className="size-4 animate-spin" /> Loading members…
          </p>
        )}
        {data && (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  {owner && <TableHead className="w-0" aria-label="Actions" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((m) => {
                  const self = m.userId === me?.user.id
                  return (
                    <TableRow key={m.userId}>
                      <TableCell>
                        <div style={{ fontWeight: 'var(--font-weight-medium)' }}>
                          {m.name}
                          {self && <span className="text-muted-foreground"> (you)</span>}
                        </div>
                        <div className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                          {m.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        {owner ? (
                          <Select value={m.role} onValueChange={(role) => void act(() => authApi.setRole(m.userId, role as Role), `${m.name} is now ${role === 'owner' ? 'an owner' : 'a member'}`)}>
                            <SelectTrigger className="w-32" aria-label={`Role for ${m.name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="owner">Owner</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">{m.role === 'owner' ? 'Owner' : 'Member'}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ago(m.joinedAt)}</TableCell>
                      {owner && (
                        <TableCell>
                          {!self && (
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

      {owner && data && (data.invites.length > 0 || data.joining.length > 0) && (
        <section className="space-y-3 border-t border-border py-8">
          <h2 style={SECTION_TITLE}>Pending invites</h2>
          <div className="rounded-lg border border-border">
            <Table>
              <TableBody>
                {data.joining.map((j) => (
                  <TableRow key={j.email}>
                    <TableCell colSpan={2}>
                      <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{j.email}</div>
                      <div className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
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
                        <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{i.email}</div>
                        <div className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                          Sent {ago(i.invitedAt)}, expires {left <= 1 ? 'within a day' : `in ${left} days`}
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

export function SettingsPage({ tab, onTabChange }: { tab: SettingsTab; onTabChange: (t: SettingsTab) => void }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="mb-6">Settings</h1>
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as SettingsTab)}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="canned">Canned responses</TabsTrigger>
          <TabsTrigger value="support">Support rules</TabsTrigger>
          <TabsTrigger value="fields">Contact fields</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="pt-2">
          <Profile />
        </TabsContent>
        <TabsContent value="members" className="pt-2">
          <Members />
        </TabsContent>
        <TabsContent value="canned" className="pt-2">
          <CannedResponsesSettings />
        </TabsContent>
        <TabsContent value="support" className="pt-2">
          <SupportSettingsTab />
        </TabsContent>
        <TabsContent value="fields" className="pt-2">
          <ContactFieldsSettings />
        </TabsContent>
      </Tabs>
    </div>
  )
}
