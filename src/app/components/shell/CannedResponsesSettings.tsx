import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Textarea } from '@/app/components/ui/textarea'
import { Badge } from '@/app/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { deleteCanned, listCanned, saveCanned, type CannedResponse } from '@/app/api/inbox'
import { errorDetail } from '@/app/api/meta'
import { TEXT_SM_OPEN } from '@/app/lib/text'
import { can } from '@/app/lib/permissions'
import { useAuth } from '@/app/auth/AuthContext'
import { cn } from '@/app/lib/utils'

type Draft = Omit<CannedResponse, 'id'>
const EMPTY: Draft = { title: '', shortcut: '', body: '', shared: true }

function Editor({ initial, onClose, onSaved }: { initial: CannedResponse | null; onClose: () => void; onSaved: (c: CannedResponse) => void }) {
  const { me } = useAuth()
  // Shared responses are the team's: owners and admins share them; others keep their own.
  const admin = can(me?.role, 'settings.manage')
  const [d, setD] = useState<Draft>(initial ? { title: initial.title, shortcut: initial.shortcut, body: initial.body, shared: initial.shared } : { ...EMPTY, shared: admin })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }))
  async function save() {
    setBusy(true)
    setError(null)
    try {
      onSaved(await saveCanned(d, initial?.id))
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit canned response' : 'New canned response'}</DialogTitle>
          <DialogDescription>Type its shortcut in the inbox reply box to insert it.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="cr-title">Name</Label>
              <Input id="cr-title" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Refund timeline" maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-shortcut">Shortcut</Label>
              <Input id="cr-shortcut" value={d.shortcut} onChange={(e) => set({ shortcut: e.target.value })} placeholder="/refund" maxLength={40} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-body">Message</Label>
            <Textarea id="cr-body" value={d.body} onChange={(e) => set({ body: e.target.value })} rows={5} placeholder="Hi {{name}}, refunds reach your account in 3 to 5 working days." />
            <p className="text-muted-foreground text-xs">
              {'{{name}}'} becomes the customer&rsquo;s first name and {'{{phone}}'} their number. WhatsApp formatting works: *bold*, _italic_.
            </p>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
            <span>
              Share with the whole team
              <span className="block text-muted-foreground text-xs">
                {admin ? 'Off: only you see it.' : 'Owners and admins share responses with the team. Yours are only for you.'}
              </span>
            </span>
            <Switch checked={d.shared} onCheckedChange={(v) => set({ shared: v })} disabled={!admin} />
          </label>
          {error && <FormError>{error}</FormError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !d.title.trim() || !d.shortcut.trim() || !d.body.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {initial ? 'Save changes' : 'Create response'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Settings → Canned responses: saved replies the team inserts with a /shortcut. */
export function CannedResponsesSettings() {
  const { me } = useAuth()
  const admin = can(me?.role, 'settings.manage')
  const [rows, setRows] = useState<CannedResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CannedResponse | 'new' | null>(null)
  const [removing, setRemoving] = useState<CannedResponse | null>(null)
  useEffect(() => {
    listCanned().then(setRows, (err) => setError(errorDetail(err)))
  }, [])

  return (
    <div className="space-y-6 py-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl space-y-1">
          <h2 className="text-section font-semibold">Canned responses</h2>
          <p className="text-muted-foreground text-sm">
            Answers your team sends often. In the inbox, type / and the shortcut to drop one in, then edit it before sending.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" />
          New response
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-sm">
          {error}
        </p>
      ) : !rows ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading&hellip;
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
          No canned responses yet. Create one for the answer you type most.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-4 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span style={{ ...TEXT_SM_OPEN, fontWeight: 'var(--font-weight-semi-bold)' }}>{c.shortcut}</span>
                  <span className="text-muted-foreground text-sm">
                    {c.title}
                  </span>
                  {!c.shared && <Badge variant="secondary">Only you</Badge>}
                </p>
                <p className="line-clamp-2 text-muted-foreground text-xs">
                  {c.body}
                </p>
              </div>
              <div className={cn('flex shrink-0 gap-1', c.shared && !admin && 'hidden')}>
                <Button variant="ghost" size="sm" aria-label={`Edit ${c.shortcut}`} onClick={() => setEditing(c)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Delete ${c.shortcut}`} onClick={() => setRemoving(c)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <Editor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setRows((prev) => (editing === 'new' ? [...(prev ?? []), c] : (prev ?? []).map((x) => (x.id === c.id ? c : x))).sort((a, z) => a.shortcut.localeCompare(z.shortcut)))
            toast.success(editing === 'new' ? 'Canned response created.' : 'Changes saved.')
            setEditing(null)
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.shortcut}?`}
        description="Your team can no longer insert it. Messages already sent aren't affected."
        confirmLabel="Delete"
        onConfirm={() => {
          const c = removing!
          setRemoving(null)
          deleteCanned(c.id).then(
            () => {
              setRows((prev) => prev?.filter((x) => x.id !== c.id) ?? prev)
              toast.success('Canned response deleted.')
            },
            (err) => toast.error(errorDetail(err)),
          )
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
