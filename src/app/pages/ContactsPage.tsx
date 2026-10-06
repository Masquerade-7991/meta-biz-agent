import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2, MessageSquare, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Badge } from '@/app/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { errorDetail } from '@/app/api/meta'
import {
  createContact,
  createSegment,
  deleteContact,
  deleteSegment,
  importContacts,
  listContacts,
  listFields,
  listSegments,
  listTags,
  updateContact,
  type Contact,
  type FieldDef,
  type Segment,
} from '@/app/api/contacts'
import { parseCsv, toCsv, toImportRows, type ImportRow } from '@/app/contacts/csv'
import { TEXT_SM } from '@/app/lib/text'
import { SearchInput } from '@/app/components/Filters'
import { customerLabel, isBsuid } from '@/app/lib/customer'
import { can } from '@/app/lib/permissions'
import { useAuth } from '@/app/auth/AuthContext'

const tagList = (s: string) => [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
const ago = (iso?: string) => {
  if (!iso) return '—'
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Add or edit one contact: details, tags, custom fields, opt-out. */
function ContactDialog({
  initial,
  fields,
  onClose,
  onSaved,
  onDeleted,
  onOpenChat,
}: {
  initial: Contact | null
  fields: FieldDef[]
  onClose: () => void
  onSaved: (c: Contact) => void
  onDeleted: (phone: string) => void
  onOpenChat: (phone: string) => void
}) {
  const { me } = useAuth()
  const [phone, setPhone] = useState(initial ? `+${initial.phone}` : '')
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '')
  const [values, setValues] = useState<Record<string, string>>(initial?.fields ?? {})
  const [optedOut, setOptedOut] = useState(!!initial?.optedOut)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const hasChat = !!initial && (initial.source === 'whatsapp' || initial.source === 'sample' || !!initial.lastSeenAt)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const body = { name, email, tags: tagList(tags), fields: values, optedOut }
      onSaved(initial ? await updateContact(initial.phone, body) : await createContact({ ...body, phone }))
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? initial.name || customerLabel(initial.phone, initial.username) : 'Add a contact'}</DialogTitle>
          <DialogDescription>{initial ? `${customerLabel(initial.phone, initial.username)} · added ${ago(initial.createdAt).toLowerCase()}` : 'Phone number with country code, as on WhatsApp.'}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {!initial && (
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone number</Label>
              <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" autoFocus />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Name</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-tags">Tags</Label>
            <Input id="c-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, billing" />
            <p className="text-muted-foreground text-xs">
              Separate tags with commas.
            </p>
          </div>
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
              {f.type === 'select' ? (
                <Select value={values[f.key] ?? ''} onValueChange={(v) => setValues({ ...values, [f.key]: v === '__none' ? '' : v })}>
                  <SelectTrigger id={`f-${f.key}`}>
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Not set</SelectItem>
                    {f.options?.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`f-${f.key}`}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
          <label className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm">
            <span>
              Opted out of broadcasts
              <span className="block text-muted-foreground text-xs">
                Set automatically when the customer replies STOP. Chats still work.
              </span>
            </span>
            <Switch checked={optedOut} onCheckedChange={setOptedOut} />
          </label>
          {error && <FormError>{error}</FormError>}
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex gap-2">
              {initial && can(me?.role, 'contacts.manage') && (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              )}
              {hasChat && (
                <Button type="button" variant="outline" onClick={() => onOpenChat(initial!.phone)}>
                  <MessageSquare className="size-4" />
                  Open chat
                </Button>
              )}
            </div>
            <Button type="submit" disabled={busy || (!initial && !phone.trim())}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {initial ? 'Save changes' : 'Add contact'}
            </Button>
          </DialogFooter>
        </form>
        <ConfirmDialog
          open={confirming}
          title={`Delete ${initial?.name || customerLabel(initial?.phone ?? '', initial?.username)}?`}
          description="This also deletes their chat history and tickets. It can't be undone."
          confirmLabel="Delete contact"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            deleteContact(initial!.phone).then(
              () => onDeleted(initial!.phone),
              (err) => setError(errorDetail(err)),
            )
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** CSV upload: shows which columns were recognised and a preview, then imports. */
function ImportDialog({ fields, onClose, onDone }: { fields: FieldDef[]; onClose: () => void; onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<{ name: string; header: string[]; mapping: (string | null)[]; rows: ImportRow[] } | null>(null)
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof importContacts>> | null>(null)
  const label = (m: string | null) => (m === null ? 'Ignored' : m.startsWith('field:') ? (fields.find((f) => `field:${f.key}` === m)?.label ?? m) : { phone: 'Phone', name: 'Name', email: 'Email', tags: 'Tags' }[m])

  async function read(f: File) {
    setError(null)
    const table = parseCsv(await f.text())
    const { rows, mapping } = toImportRows(table, fields)
    if (!mapping.includes('phone')) return setError('No phone column found. Name a column “Phone”, “Mobile” or “WhatsApp number”.')
    setParsed({ name: f.name, header: table[0], mapping, rows })
  }
  async function go() {
    if (!parsed) return
    setBusy(true)
    try {
      setResult(await importContacts(parsed.rows, tags))
      onDone()
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>A CSV with a phone column. Name, email, tags and your custom fields are picked up by their column names. Existing numbers are updated, not duplicated.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p>
              Added {result.added}, updated {result.updated}
              {result.skippedCount ? `, skipped ${result.skippedCount}` : ''}.
            </p>
            {result.skipped.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-muted p-3 text-muted-foreground text-xs">
                {result.skipped.map((s) => (
                  <li key={s.row}>
                    Row {s.row}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
            <Button variant="outline" onClick={() => file.current?.click()}>
              <Upload className="size-4" />
              {parsed ? `Change file (${parsed.name})` : 'Choose a CSV file'}
            </Button>
            {parsed && (
              <>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        {parsed.header.map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left font-normal">
                            <span className="block">{h}</span>
                            <span className={parsed.mapping[i] ? 'text-primary' : 'text-muted-foreground'}>→ {label(parsed.mapping[i])}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                </div>
                <p className="text-muted-foreground text-sm">
                  {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} ready
                  {parsed.rows[0] ? `, starting with ${parsed.rows[0].name || parsed.rows[0].phone}` : ''}.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="imp-tags">Tag everyone in this file (optional)</Label>
                  <Input id="imp-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="diwali-2026" />
                </div>
              </>
            )}
            {error && <FormError>{error}</FormError>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void go()} disabled={!parsed || busy || !parsed.rows.length}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Import {parsed ? parsed.rows.length : ''} contacts
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SegmentDialog({ tag, onClose, onSaved }: { tag: string; onClose: () => void; onSaved: (s: Segment) => void }) {
  const [name, setName] = useState('')
  const [tags, setTags] = useState(tag)
  const [days, setDays] = useState('any')
  const [optedOut, setOptedOut] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>A saved group of contacts that updates itself. Use it to filter here or to send a broadcast.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="seg-name">Name</Label>
            <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Active VIPs" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seg-tags">Has all these tags</Label>
            <Input id="seg-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, billing" />
          </div>
          <div className="space-y-1.5">
            <Label>Last message from them</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any time</SelectItem>
                <SelectItem value="7">Within 7 days</SelectItem>
                <SelectItem value="30">Within 30 days</SelectItem>
                <SelectItem value="90">Within 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox checked={optedOut} onCheckedChange={(v) => setOptedOut(v === true)} />
            Include people who opted out
          </label>
          {error && <FormError>{error}</FormError>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={() => {
              setBusy(true)
              createSegment(name, { tags: tagList(tags), activeDays: days === 'any' ? null : Number(days), includeOptedOut: optedOut })
                .then(onSaved, (err) => setError(errorDetail(err)))
                .finally(() => setBusy(false))
            }}
          >
            Save segment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Everyone the business talks to, with tags, custom fields, segments and CSV in and out. */
export function ContactsPage({ onOpenChat }: { onOpenChat: (phone: string) => void }) {
  const { me } = useAuth()
  // Import, segments and deleting people are for supervisors and up; everyone can add and edit.
  const manage = can(me?.role, 'contacts.manage')
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('all')
  const [segment, setSegment] = useState('all')
  const [rows, setRows] = useState<Contact[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldDef[]>([])
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [savingSegment, setSavingSegment] = useState(false)
  const [removingSegment, setRemovingSegment] = useState<Segment | null>(null)

  const refresh = useCallback(() => {
    listContacts({ q, tag: tag === 'all' ? undefined : tag, segment: segment === 'all' ? undefined : segment }).then(
      (r) => {
        setRows(r)
        setError(null)
      },
      (err) => setError(errorDetail(err)),
    )
    listTags().then(setTags, () => {})
  }, [q, tag, segment])
  useEffect(() => {
    const t = setTimeout(refresh, 200)
    return () => clearTimeout(t)
  }, [refresh])
  useEffect(() => {
    listFields().then(setFields, () => {})
    listSegments().then(setSegments, () => {})
  }, [])
  const shownFields = useMemo(() => fields.slice(0, 3), [fields])
  const currentSegment = segments.find((s) => s.id === segment)

  function exportCsv() {
    const list = rows ?? []
    const csv = toCsv([
      ['Phone', 'Name', 'Email', 'Tags', ...fields.map((f) => f.label), 'Opted out', 'Last message'],
      ...list.map((c) => [isBsuid(c.phone) ? c.phone : `+${c.phone}`, c.name ?? '', c.email ?? '', c.tags.join(', '), ...fields.map((f) => c.fields[f.key] ?? ''), c.optedOut ? 'yes' : 'no', c.lastSeenAt ?? '']),
    ])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Contacts</h1>
          <p className="mt-1 text-muted-foreground">Everyone who has chatted with you, plus people you add or import.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manage && (
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="size-4" />
              Import CSV
            </Button>
          )}
          <Button variant="outline" onClick={exportCsv} disabled={!rows?.length}>
            <Download className="size-4" />
            Export CSV
          </Button>
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" />
            Add contact
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, number or email" label="Search contacts" className="h-9 w-64" />
        <Select value={segment} onValueChange={setSegment}>
          <SelectTrigger className="h-9 w-48" aria-label="Segment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contacts</SelectItem>
            {segments.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} ({s.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="h-9 w-40" aria-label="Tag">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any tag</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.tag} value={t.tag}>
                {t.tag} ({t.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {manage && (
          <Button variant="ghost" size="sm" onClick={() => setSavingSegment(true)}>
            <Plus className="size-4" />
            New segment
          </Button>
        )}
        {currentSegment && manage && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setRemovingSegment(currentSegment)}>
            Delete “{currentSegment.name}”
          </Button>
        )}
        <span className="ml-auto text-muted-foreground text-xs">
          {rows ? `${rows.length} contact${rows.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        {error ? (
          <p className="p-6 text-destructive text-sm">
            {error}
          </p>
        ) : !rows ? (
          <p className="flex items-center gap-2 p-6 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading contacts&hellip;
          </p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground text-sm">
            {q || tag !== 'all' || segment !== 'all' ? 'No contacts match.' : 'No contacts yet. They appear as customers chat with your agent, or import a CSV.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Tags</TableHead>
                {shownFields.map((f) => (
                  <TableHead key={f.key}>{f.label}</TableHead>
                ))}
                <TableHead>Last message</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.phone} className="cursor-pointer" onClick={() => setEditing(c)}>
                  <TableCell style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-medium)' }}>{c.name || <span className="text-muted-foreground">No name</span>}</TableCell>
                  <TableCell className="text-sm">{customerLabel(c.phone, c.username)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  {shownFields.map((f) => (
                    <TableCell key={f.key} className="text-sm">
                      {c.fields[f.key] ?? ''}
                    </TableCell>
                  ))}
                  <TableCell className="text-muted-foreground text-sm">
                    {ago(c.lastSeenAt)}
                  </TableCell>
                  <TableCell>
                    <span className="flex gap-1">
                      {c.openTicket && <Badge className="bg-warning/15 text-warning-foreground">Open ticket</Badge>}
                      {c.optedOut && <Badge variant="outline">Opted out</Badge>}
                      {c.source === 'sample' && <Badge variant="secondary">Sample</Badge>}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {editing && (
        <ContactDialog
          initial={editing === 'new' ? null : editing}
          fields={fields}
          onClose={() => setEditing(null)}
          onOpenChat={(phone) => {
            setEditing(null)
            onOpenChat(phone)
          }}
          onSaved={(c) => {
            toast.success(editing === 'new' ? 'Contact added.' : 'Contact saved.')
            setEditing(null)
            void c
            refresh()
          }}
          onDeleted={() => {
            toast.success('Contact deleted.')
            setEditing(null)
            refresh()
          }}
        />
      )}
      {importing && <ImportDialog fields={fields} onClose={() => setImporting(false)} onDone={refresh} />}
      {savingSegment && (
        <SegmentDialog
          tag={tag === 'all' ? '' : tag}
          onClose={() => setSavingSegment(false)}
          onSaved={(s) => {
            setSavingSegment(false)
            setSegments((prev) => [...prev, s].sort((a, z) => a.name.localeCompare(z.name)))
            setSegment(s.id)
            setTag('all')
            toast.success(`Segment “${s.name}” saved: ${s.count} contact${s.count === 1 ? '' : 's'}.`)
          }}
        />
      )}
      <ConfirmDialog
        open={removingSegment !== null}
        title={`Delete the segment “${removingSegment?.name}”?`}
        description="Only the saved filter goes. The contacts stay."
        confirmLabel="Delete segment"
        onCancel={() => setRemovingSegment(null)}
        onConfirm={() => {
          const s = removingSegment!
          setRemovingSegment(null)
          deleteSegment(s.id).then(() => {
            setSegments((prev) => prev.filter((x) => x.id !== s.id))
            setSegment('all')
          }, (err) => toast.error(errorDetail(err)))
        }}
      />
    </div>
  )
}
