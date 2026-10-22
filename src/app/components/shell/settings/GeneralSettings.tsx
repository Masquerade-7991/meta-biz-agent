import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Copy, Crown, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { Field, FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { authApi, type WorkspaceInfo } from '@/app/auth/api'
import { useMembers } from '@/app/auth/useMembers'
import { errorDetail } from '@/app/api/meta'
import { can } from '@/app/lib/permissions'
import { SettingsSection } from '../SettingsSection'
import { FormFooter, LoadGate, ReadOnlyNote } from './SettingsUi'
import { NO_STAMP } from './formCore'
import { useSettingsForm } from './useSettingsForm'
import { copyText } from './clipboard'

const fullDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/** Workspace › General: the name, the ID support asks for, and handing ownership to someone else. */
export function GeneralSettings() {
  const { me, setMe } = useAuth()
  const owner = me?.role === 'owner'
  const [info, setInfo] = useState<WorkspaceInfo | null>(null)
  const [transferring, setTransferring] = useState(false)
  const form = useSettingsForm<{ name: string }>({
    load: () =>
      authApi.workspace().then((w) => {
        setInfo(w)
        return { value: { name: w.name }, stamp: NO_STAMP }
      }),
    save: async (v) => {
      const next = await authApi.renameWorkspace(v.name.trim())
      setMe(next)
      return { value: { name: next.workspace?.name ?? v.name.trim() }, stamp: NO_STAMP }
    },
    validate: (v) => (!v.name.trim() ? { name: 'Enter a name.' } : v.name.trim().length > 80 ? { name: 'Keep it to 80 characters.' } : {}),
  })
  if (form.state !== 'ready' || !form.draft || !info) return <LoadGate error={form.loadError} onRetry={form.reload} what="the workspace" />

  return (
    <div>
      {!owner && <ReadOnlyNote>Only owners can rename the workspace or hand it to someone else.</ReadOnlyNote>}
      <SettingsSection title="Workspace name" description="Shown in the sidebar, in invite emails and to everyone in the workspace.">
        <fieldset disabled={!owner} className="space-y-1">
          <Field label="Name" maxLength={80} value={form.draft.name} onChange={(e) => form.set({ name: e.target.value })} aria-invalid={!!form.liveErrors.name} />
          {form.liveErrors.name && form.dirty && <p className="text-xs text-destructive">{form.liveErrors.name}</p>}
        </fieldset>
        {owner && <FormFooter form={form} can="whatsapp.manage" label="Save name" />}
      </SettingsSection>

      <SettingsSection title="Details" description="Helo.ai support may ask for the workspace ID.">
        <dl className="space-y-3 text-sm">
          <div className="space-y-1">
            <dt className="text-muted-foreground">Workspace ID</dt>
            <dd className="flex items-center gap-2">
              <code className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs select-all">{info.id}</code>
              <Button variant="ghost" size="icon-sm" aria-label="Copy workspace ID" onClick={() => void copyText(info.id, 'Workspace ID copied')}>
                <Copy className="size-4" />
              </Button>
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Created</dt>
            <dd>{fullDate(info.createdAt)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">Your role</dt>
            <dd className="capitalize">{me?.role}</dd>
          </div>
        </dl>
      </SettingsSection>

      {owner && (
        <SettingsSection title="Transfer ownership" description="Make someone else an owner. You can stay an owner too, or step down to admin. Only another owner can undo this.">
          <Button variant="outline" onClick={() => setTransferring(true)}>
            <Crown className="size-4" /> Transfer ownership…
          </Button>
        </SettingsSection>
      )}
      <TransferDialog
        open={transferring}
        onClose={() => setTransferring(false)}
        onDone={(next, name) => {
          setTransferring(false)
          setMe(next)
          toast.success(`${name} is now an owner`, { description: can(next.role, 'whatsapp.manage') ? 'You’re still an owner too.' : 'You’re an admin now.' })
        }}
      />
    </div>
  )
}

function TransferDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (me: NonNullable<ReturnType<typeof useAuth>['me']>, name: string) => void }) {
  const { me } = useAuth()
  const members = useMembers().filter((m) => m.userId !== me?.user.id)
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [stepDown, setStepDown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const to = members.find((m) => m.userId === userId)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      onDone(await authApi.transferOwnership(to.userId, password, stepDown), to.name)
      setPassword('')
      setUserId('')
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Transfer ownership</DialogTitle>
            <DialogDescription>Owners control WhatsApp accounts, billing and other owners. Admins can’t undo this.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-to">New owner</Label>
            <Select value={userId || undefined} onValueChange={setUserId}>
              <SelectTrigger id="transfer-to" className="w-full">
                <SelectValue placeholder="Pick someone in the workspace" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId} disabled={m.role === 'owner'}>
                    {m.name} <span className="text-muted-foreground">· {m.role === 'owner' ? 'already an owner' : m.email}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
            <span>
              Step down to admin
              <span className="block text-xs text-muted-foreground">Off: you both stay owners.</span>
            </span>
            <Switch checked={stepDown} onCheckedChange={setStepDown} />
          </label>
          <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <FormError>{error}</FormError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !to || !password}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {to ? `Make ${to.name.split(' ')[0]} an owner` : 'Transfer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
