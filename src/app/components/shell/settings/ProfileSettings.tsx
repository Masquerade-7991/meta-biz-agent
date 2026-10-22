import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Loader2, LogOut, MailCheck } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useAuth } from '@/app/auth/AuthContext'
import { Field, FormError } from '@/app/auth/AuthLayout'
import { authApi } from '@/app/auth/api'
import { leaveWorkspace } from '@/app/auth/workspaceSwitch'
import { errorDetail } from '@/app/api/meta'
import { SettingsSection } from '../SettingsSection'
import { FormFooter } from './SettingsUi'
import { NO_STAMP } from './formCore'
import { useSettingsForm } from './useSettingsForm'

const MIN_PASSWORD = 8

/** Shared busy/error handling for one action form. */
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
  return { busy, error, setError, run }
}

/** You › Profile: your name, login email, password, and leaving this workspace. */
export function ProfileSettings() {
  const { me, setMe } = useAuth()
  const name = useSettingsForm<{ name: string }>({
    load: () => Promise.resolve({ value: { name: me?.user.name ?? '' }, stamp: NO_STAMP }),
    save: async (v) => {
      const next = await authApi.updateName(v.name.trim())
      setMe(next)
      return { value: { name: next.user.name }, stamp: NO_STAMP }
    },
    validate: (v) => (!v.name.trim() ? { name: 'Enter your name.' } : {}),
  })
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const emailAction = useAction()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const pwAction = useAction()
  const [leaving, setLeaving] = useState(false)
  const pending = me?.pendingEmail ?? null
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && next !== confirm

  const sendEmailLink = (e: FormEvent) => {
    e.preventDefault()
    void emailAction.run(async () => {
      const email = newEmail.trim()
      await authApi.changeEmail(email, emailPassword)
      if (me) setMe({ ...me, pendingEmail: email })
      toast.success('Confirmation link sent', { description: `Open the link we sent to ${email}. Your email changes when you do.` })
      setNewEmail('')
      setEmailPassword('')
    })
  }
  const cancelEmail = () =>
    void emailAction.run(async () => {
      await authApi.cancelEmailChange()
      if (me) setMe({ ...me, pendingEmail: null })
      toast.success('Email change cancelled', { description: `You still log in with ${me?.user.email}.` })
    })
  const changePassword = (e: FormEvent) => {
    e.preventDefault()
    if (next.length < MIN_PASSWORD) return pwAction.setError(`Use at least ${MIN_PASSWORD} characters.`)
    if (next !== confirm) return pwAction.setError('The two new passwords don’t match.')
    void pwAction.run(async () => {
      const r = await authApi.changePassword(current, next)
      const n = r.tokensRevoked ?? 0
      toast.success('Password changed', { description: `Other devices were logged out${n ? ` and ${n} API token${n === 1 ? ' was' : 's were'} revoked` : ''}.` })
      setCurrent('')
      setNext('')
      setConfirm('')
    })
  }

  return (
    <div>
      <SettingsSection title="Your name" description="Shown to people in your workspace and in invite emails.">
        {name.draft && (
          <div className="space-y-1">
            <Field label="Full name" autoComplete="name" maxLength={80} value={name.draft.name} onChange={(e) => name.set({ name: e.target.value })} aria-invalid={!!name.errors.name} />
            {name.errors.name && <p className="text-xs text-destructive">{name.errors.name}</p>}
          </div>
        )}
        <FormFooter form={name} can={null} label="Save name" />
      </SettingsSection>

      <SettingsSection title="Email" description={`You log in with ${me?.user.email}. To change it, we send a confirmation link to the new address.`}>
        {pending && (
          <div className="mb-4 space-y-2 rounded-lg border border-border bg-muted/50 p-3 text-sm" role="status">
            <p className="flex items-start gap-2">
              <MailCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                Email change pending: confirm from <strong>{pending}</strong>. Until then you keep logging in with {me?.user.email}.
              </span>
            </p>
            <div className="flex flex-wrap gap-2 pl-6">
              <Button size="sm" variant="outline" onClick={() => setNewEmail(pending)}>
                Resend the link
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={emailAction.busy} onClick={cancelEmail}>
                Cancel the change
              </Button>
            </div>
          </div>
        )}
        <form onSubmit={sendEmailLink} className="space-y-4">
          <Field label="New email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <Field label="Current password" type="password" autoComplete="current-password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} />
          {emailAction.error && <FormError>{emailAction.error}</FormError>}
          <Button type="submit" disabled={emailAction.busy || !newEmail.trim() || !emailPassword}>
            {emailAction.busy && <Loader2 className="size-4 animate-spin" />}
            Send confirmation link
          </Button>
          <p className="text-xs text-muted-foreground">Once you confirm, other devices are logged out.</p>
        </form>
      </SettingsSection>

      <SettingsSection title="Password" description="Changing it logs you out on every other device and revokes your API tokens.">
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <div className="space-y-1">
            <Field label="New password" type="password" autoComplete="new-password" hint={`At least ${MIN_PASSWORD} characters.`} value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={tooShort} />
            {tooShort && <p className="text-xs text-destructive">{MIN_PASSWORD - next.length} more character{MIN_PASSWORD - next.length === 1 ? '' : 's'} to go.</p>}
          </div>
          <div className="space-y-1">
            <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
            {mismatch && <p className="text-xs text-destructive">Doesn’t match the new password yet.</p>}
          </div>
          {pwAction.error && <FormError>{pwAction.error}</FormError>}
          <Button type="submit" disabled={pwAction.busy || !current || next.length < MIN_PASSWORD || next !== confirm}>
            {pwAction.busy && <Loader2 className="size-4 animate-spin" />}
            Change password
          </Button>
        </form>
      </SettingsSection>

      {me?.workspace && (
        <SettingsSection title="Leave this workspace" description="You lose access to its chats, tickets and agents. Your account and your other workspaces stay. An owner can invite you again.">
          <Button variant="outline" className="text-destructive" onClick={() => setLeaving(true)}>
            <LogOut className="size-4" /> Leave {me.workspace.name}
          </Button>
        </SettingsSection>
      )}
      <ConfirmDialog
        open={leaving}
        title={`Leave ${me?.workspace?.name ?? 'this workspace'}?`}
        description="You’ll lose access to its chats, tickets and agents. An owner can invite you again. Your other workspaces aren’t affected."
        confirmLabel="Leave workspace"
        onConfirm={() => {
          setLeaving(false)
          void leaveWorkspace()
        }}
        onCancel={() => setLeaving(false)}
      />
    </div>
  )
}
