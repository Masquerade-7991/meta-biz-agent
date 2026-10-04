import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Send, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Badge } from '@/app/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/app/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { WA } from '@/app/wizard/steps/whatsappTheme'
import { errorDetail } from '@/app/api/meta'
import { listFields, listSegments, type FieldDef, type Segment } from '@/app/api/contacts'
import {
  cancelBroadcast,
  createBroadcast,
  createTemplate,
  deleteTemplate,
  getBroadcast,
  listBroadcasts,
  listTemplates,
  type Broadcast,
  type BroadcastDetail,
  type NewTemplate,
  type SlotMapping,
  type WaTemplate,
} from '@/app/api/broadcasts'
import { renderTemplate, slotsOf } from '@/app/broadcasts/templates'
import { cn } from '@/app/lib/utils'
import { TEXT_SM, TEXT_XS } from '@/app/lib/text'
import { usePolling } from '@/app/lib/usePolling'

const LIVE_BROADCASTS = ['broadcast.']

const STATUS: Record<Broadcast['status'], { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-muted text-foreground' },
  sending: { label: 'Sending', cls: 'bg-primary text-primary-foreground' },
  completed: { label: 'Sent', cls: 'bg-success text-success-foreground' },
  cancelled: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground' },
}
const TPL_STATUS: Record<string, string> = { APPROVED: 'bg-success text-success-foreground', REJECTED: 'bg-destructive text-destructive-foreground', PENDING: 'bg-warning text-warning-foreground' }
const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')

/** A template as the customer sees it, in WhatsApp's bubble. */
export function TemplatePreview({ text }: { text: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: WA.wallpaper }}>
      <p className="max-w-sm rounded-lg px-2.5 py-1.5 whitespace-pre-wrap shadow-sm" style={{ background: WA.bubbleIn, color: WA.text, fontFamily: WA.font, fontSize: 14, lineHeight: '19px' }}>
        {text}
      </p>
    </div>
  )
}

function NewBroadcastDialog({ templates, segments, fields, onClose, onCreated }: { templates: WaTemplate[]; segments: Segment[]; fields: FieldDef[]; onClose: () => void; onCreated: (b: BroadcastDetail) => void }) {
  const approved = templates.filter((t) => t.status === 'APPROVED')
  const [name, setName] = useState('')
  const [tplId, setTplId] = useState('')
  const [segmentId, setSegmentId] = useState('all')
  const [mapping, setMapping] = useState<Record<string, SlotMapping>>({})
  const [later, setLater] = useState(false)
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tpl = approved.find((t) => t.id === tplId)
  const slots = useMemo(() => (tpl ? slotsOf(tpl) : []), [tpl])
  const sample = Object.fromEntries(slots.map((s) => [s.id, mapping[s.id]?.source === 'text' ? mapping[s.id]?.text || s.label : mapping[s.id] ? `[${mapping[s.id].source === 'name' ? 'first name' : mapping[s.id].source.replace('field:', '')}]` : s.label]))
  const seg = segments.find((s) => s.id === segmentId)

  async function go() {
    if (!tpl) return
    setBusy(true)
    setError(null)
    try {
      onCreated(await createBroadcast({ name, template: { name: tpl.name, language: tpl.language }, segmentId: segmentId === 'all' ? null : segmentId, mapping, scheduledAt: later && at ? new Date(at).toISOString() : null }))
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New broadcast</DialogTitle>
          <DialogDescription>Send an approved template to a group of contacts. People who opted out are always left out.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="b-name">Name (only your team sees it)</Label>
              <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali offer, VIPs" />
            </div>
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select
                value={tplId}
                onValueChange={(v) => {
                  setTplId(v)
                  setMapping({})
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={approved.length ? 'Pick an approved template' : 'No approved templates yet'} />
                </SelectTrigger>
                <SelectContent>
                  {approved.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Send to</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger>
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
              {segmentId === 'all' && <p className="text-muted-foreground" style={TEXT_XS}>Every contact who hasn&rsquo;t opted out. Make a segment in Contacts to narrow it.</p>}
            </div>
            {slots.length > 0 && (
              <div className="space-y-3">
                <Label>Fill in the template</Label>
                {slots.map((s) => {
                  const m = mapping[s.id] ?? { source: '' }
                  const set = (patch: Partial<SlotMapping>) => setMapping({ ...mapping, [s.id]: { ...m, ...patch } as SlotMapping })
                  return (
                    <div key={s.id} className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                      <span style={TEXT_SM}>{s.label}</span>
                      <Select value={m.source} onValueChange={(v) => set({ source: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Comes from…" />
                        </SelectTrigger>
                        <SelectContent>
                          {s.kind === 'text' && <SelectItem value="name">Customer&rsquo;s first name</SelectItem>}
                          {s.kind === 'text' && <SelectItem value="phone">Customer&rsquo;s number</SelectItem>}
                          {s.kind === 'text' &&
                            fields.map((f) => (
                              <SelectItem key={f.key} value={`field:${f.key}`}>
                                {f.label}
                              </SelectItem>
                            ))}
                          <SelectItem value="text">{s.kind === 'media' ? 'A link' : 'The same text for everyone'}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input className="h-9" value={m.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder={m.source === 'text' ? (s.kind === 'media' ? 'https://…' : 'Text') : 'If empty, use…'} />
                    </div>
                  )
                })}
              </div>
            )}
            <RadioGroup value={later ? 'later' : 'now'} onValueChange={(v) => setLater(v === 'later')} className="space-y-2">
              <label className="flex items-center gap-2.5" style={TEXT_SM}>
                <RadioGroupItem value="now" /> Send now
              </label>
              <label className="flex flex-wrap items-center gap-2.5" style={TEXT_SM}>
                <RadioGroupItem value="later" /> Schedule for
                {later && <Input type="datetime-local" className="h-9 w-56" value={at} onChange={(e) => setAt(e.target.value)} />}
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <p className="text-muted-foreground" style={TEXT_XS}>
              Preview
            </p>
            {tpl ? <TemplatePreview text={renderTemplate(tpl, sample)} /> : <p className="text-muted-foreground" style={TEXT_SM}>Pick a template to see it.</p>}
          </div>
        </div>
        {error && <FormError>{error}</FormError>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void go()} disabled={busy || !name.trim() || !tpl || (later && !at)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {later ? 'Schedule broadcast' : `Send${seg ? ` to ${seg.count}` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BroadcastDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [b, setB] = useState<BroadcastDetail | null>(null)
  const [confirm, setConfirm] = useState(false)
  usePolling(() => void getBroadcast(id).then(setB, (err) => toast.error(errorDetail(err))), 4000, [id], true, LIVE_BROADCASTS)
  const s = b?.stats
  const done = s ? s.sent + s.delivered + s.read : 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {!b || !s ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{b.name}</DialogTitle>
              <DialogDescription>
                {b.template.name} to {b.segmentName} &middot; {b.status === 'scheduled' ? `scheduled for ${when(b.scheduledAt)}` : `started ${when(b.startedAt ?? b.createdAt)}`} &middot; by {b.createdByName}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {(
                [
                  ['Audience', b.audienceCount],
                  ['Sent', done],
                  ['Delivered', s.delivered + s.read],
                  ['Read', s.read],
                  ['Replied', s.replied],
                  ['Failed', s.failed + s.skipped],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="rounded-lg border border-border p-2.5">
                  <p className="text-muted-foreground" style={TEXT_XS}>
                    {label}
                  </p>
                  <p style={{ fontSize: '1.25rem', fontWeight: 'var(--font-weight-semi-bold)' }}>{n}</p>
                  {label !== 'Audience' && label !== 'Sent' && <p className="text-muted-foreground" style={TEXT_XS}>{pct(n, done || 1)}</p>}
                </div>
              ))}
            </div>
            <p className="text-muted-foreground" style={TEXT_XS}>
              Delivered and read ticks arrive once WhatsApp webhooks are connected to this app.
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.recipients.map((r) => (
                    <TableRow key={r.phone}>
                      <TableCell style={TEXT_SM}>{r.name || `+${r.phone}`}</TableCell>
                      <TableCell style={TEXT_SM} className={cn(r.status === 'failed' && 'text-destructive')}>
                        {r.status}
                        {r.repliedAt ? ' · replied' : ''}
                      </TableCell>
                      <TableCell className="text-muted-foreground" style={TEXT_XS}>
                        {r.error ?? ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              {(b.status === 'scheduled' || b.status === 'sending') && (
                <Button variant="outline" onClick={() => setConfirm(true)}>
                  Cancel broadcast
                </Button>
              )}
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
            <ConfirmDialog
              open={confirm}
              title="Cancel this broadcast?"
              description="Messages already sent stay sent. Everyone still waiting is skipped."
              confirmLabel="Cancel broadcast"
              onCancel={() => setConfirm(false)}
              onConfirm={() => {
                setConfirm(false)
                cancelBroadcast(b.id).then((x) => {
                  setB(x)
                  onChanged()
                }, (err) => toast.error(errorDetail(err)))
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const EMPTY_TEMPLATE: NewTemplate = { name: '', category: 'MARKETING', language: 'en', header: '', body: '', footer: '', buttons: [], examples: {} }

function NewTemplateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [t, setT] = useState<NewTemplate>(EMPTY_TEMPLATE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<NewTemplate>) => setT({ ...t, ...patch })
  const draft = { name: t.name, language: t.language, components: [...(t.header ? [{ type: 'HEADER' as const, format: 'TEXT' as const, text: t.header }] : []), { type: 'BODY' as const, text: t.body }, ...(t.footer ? [{ type: 'FOOTER' as const, text: t.footer }] : []), ...(t.buttons.length ? [{ type: 'BUTTONS' as const, buttons: t.buttons }] : [])] }
  const slots = slotsOf(draft).filter((s) => !s.id.startsWith('button:'))
  async function go() {
    setBusy(true)
    setError(null)
    try {
      await createTemplate(t)
      toast.success('Template sent to Meta for review.')
      onCreated()
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>Meta reviews every template before it can be sent, usually within minutes and at most a day. Use {'{{1}}'}, {'{{2}}'}… where each customer&rsquo;s details go.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem]">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Name</Label>
                <Input id="t-name" value={t.name} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="diwali_offer" />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={t.category} onValueChange={(v) => set({ category: v as NewTemplate['category'] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utility</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={t.language} onValueChange={(v) => set({ language: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="en_US">English (US)</SelectItem>
                    <SelectItem value="hi">Hindi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-header">Header (optional)</Label>
              <Input id="t-header" value={t.header} onChange={(e) => set({ header: e.target.value })} maxLength={60} placeholder="Festive offer" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-body">Message</Label>
              <Textarea id="t-body" rows={4} value={t.body} onChange={(e) => set({ body: e.target.value })} maxLength={1024} placeholder="Hi {{1}}, get 20% off this Diwali. Offer ends {{2}}." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-footer">Footer (optional)</Label>
              <Input id="t-footer" value={t.footer} onChange={(e) => set({ footer: e.target.value })} maxLength={60} placeholder="Reply STOP to opt out" />
            </div>
            {slots.length > 0 && (
              <div className="space-y-2">
                <Label>Examples for review</Label>
                {slots.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0" style={TEXT_SM}>
                      {s.label}
                    </span>
                    <Input className="h-9" value={t.examples[s.id] ?? ''} onChange={(e) => set({ examples: { ...t.examples, [s.id]: e.target.value } })} placeholder="Priya" />
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label>Buttons (up to 3)</Label>
              {t.buttons.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select value={b.type} onValueChange={(v) => set({ buttons: t.buttons.map((x, j) => (j === i ? { ...x, type: v as 'QUICK_REPLY' | 'URL' } : x)) })}>
                    <SelectTrigger className="h-9 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QUICK_REPLY">Quick reply</SelectItem>
                      <SelectItem value="URL">Link</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="h-9 w-40" value={b.text} maxLength={25} onChange={(e) => set({ buttons: t.buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} placeholder="Button text" />
                  {b.type === 'URL' && <Input className="h-9 min-w-40 flex-1" value={b.url ?? ''} onChange={(e) => set({ buttons: t.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} placeholder="https://" />}
                  <Button variant="ghost" size="sm" aria-label="Remove button" onClick={() => set({ buttons: t.buttons.filter((_, j) => j !== i) })}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {t.buttons.length < 3 && (
                <Button variant="outline" size="sm" onClick={() => set({ buttons: [...t.buttons, { type: 'QUICK_REPLY', text: '' }] })}>
                  <Plus className="size-4" />
                  Add button
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-muted-foreground" style={TEXT_XS}>
              Preview
            </p>
            <TemplatePreview text={renderTemplate(draft, t.examples) || 'Your message'} />
          </div>
        </div>
        {error && <FormError>{error}</FormError>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void go()} disabled={busy || !t.name || !t.body.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Submit for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Template broadcasts to contact segments, plus the WhatsApp templates they use. */
export function BroadcastsPage() {
  const { me } = useAuth()
  const [tab, setTab] = useState('broadcasts')
  const [rows, setRows] = useState<Broadcast[] | null>(null)
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [fields, setFields] = useState<FieldDef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [creatingTpl, setCreatingTpl] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [removing, setRemoving] = useState<WaTemplate | null>(null)

  const load = useCallback(() => {
    listBroadcasts().then(setRows, (err) => setError(errorDetail(err)))
  }, [])
  const loadTemplates = useCallback(() => {
    listTemplates().then(setTemplates, (err) => setError(errorDetail(err)))
  }, [])
  useEffect(() => {
    load()
    loadTemplates()
    listSegments().then(setSegments, () => {})
    listFields().then(setFields, () => {})
  }, [load, loadTemplates])
  const sending = rows?.some((r) => r.status === 'sending' || r.status === 'scheduled')
  usePolling(load, 5000, [], !!sending, LIVE_BROADCASTS)

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Broadcasts</h1>
          <p className="mt-1 text-muted-foreground">Send approved WhatsApp templates to groups of contacts, now or later.</p>
        </div>
        {tab === 'broadcasts' ? (
          <Button onClick={() => setCreating(true)} disabled={!templates}>
            <Plus className="size-4" />
            New broadcast
          </Button>
        ) : (
          <Button onClick={() => setCreatingTpl(true)}>
            <Plus className="size-4" />
            New template
          </Button>
        )}
      </div>
      {error && (
        <div className="mt-4">
          <FormError>{error}</FormError>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="broadcasts" className="pt-2">
          <div className="overflow-x-auto rounded-lg border border-border">
            {!rows ? (
              <p className="flex items-center gap-2 p-6 text-muted-foreground" style={TEXT_SM}>
                <Loader2 className="size-4 animate-spin" /> Loading&hellip;
              </p>
            ) : rows.length === 0 ? (
              <p className="p-10 text-center text-muted-foreground" style={TEXT_SM}>
                No broadcasts yet. Pick a template and a segment to send your first one.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Broadcast</TableHead>
                    <TableHead>Audience</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Read</TableHead>
                    <TableHead className="text-right">Replied</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => {
                    const sent = b.stats.sent + b.stats.delivered + b.stats.read
                    return (
                      <TableRow key={b.id} className="cursor-pointer" onClick={() => setOpen(b.id)}>
                        <TableCell>
                          <p style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-semi-bold)' }}>{b.name}</p>
                          <p className="text-muted-foreground" style={TEXT_XS}>
                            {b.template.name}
                          </p>
                        </TableCell>
                        <TableCell style={TEXT_SM}>
                          {b.segmentName} ({b.audienceCount})
                        </TableCell>
                        <TableCell>
                          <span className={cn('rounded px-2 py-0.5', STATUS[b.status].cls)} style={TEXT_XS}>
                            {STATUS[b.status].label}
                          </span>
                        </TableCell>
                        <TableCell className="text-right" style={TEXT_SM}>
                          {sent}
                        </TableCell>
                        <TableCell className="text-right" style={TEXT_SM}>
                          {pct(b.stats.read, sent)}
                        </TableCell>
                        <TableCell className="text-right" style={TEXT_SM}>
                          {pct(b.stats.replied, sent)}
                        </TableCell>
                        <TableCell className="text-right" style={TEXT_SM}>
                          {b.stats.failed + b.stats.skipped}
                        </TableCell>
                        <TableCell className="text-muted-foreground" style={TEXT_SM}>
                          {when(b.status === 'scheduled' ? b.scheduledAt : (b.startedAt ?? b.createdAt))}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
        <TabsContent value="templates" className="pt-2">
          {!templates ? (
            <p className="flex items-center gap-2 p-6 text-muted-foreground" style={TEXT_SM}>
              <Loader2 className="size-4 animate-spin" /> Loading templates from WhatsApp&hellip;
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {templates.map((t) => (
                <li key={t.id} className="space-y-2 rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate" style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-semi-bold)' }}>
                        {t.name}
                      </p>
                      <p className="text-muted-foreground" style={TEXT_XS}>
                        {t.category.toLowerCase()} &middot; {t.language}
                      </p>
                    </div>
                    <span className="flex items-center gap-1">
                      <Badge className={TPL_STATUS[t.status] ?? 'bg-muted text-foreground'}>{t.status.toLowerCase()}</Badge>
                      {me?.role === 'owner' && (
                        <Button variant="ghost" size="sm" className="h-7 px-1.5" aria-label={`Delete ${t.name}`} onClick={() => setRemoving(t)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground" style={TEXT_XS}>
                    {renderTemplate(t, {})}
                  </p>
                  {t.rejectedReason && (
                    <p className="text-destructive" style={TEXT_XS}>
                      Rejected: {t.rejectedReason.toLowerCase().replace(/_/g, ' ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {creating && templates && (
        <NewBroadcastDialog
          templates={templates}
          segments={segments}
          fields={fields}
          onClose={() => setCreating(false)}
          onCreated={(b) => {
            setCreating(false)
            toast.success(b.status === 'scheduled' && Date.parse(b.scheduledAt) > Date.now() + 60_000 ? `Scheduled for ${when(b.scheduledAt)}.` : `Sending to ${b.audienceCount} contact${b.audienceCount === 1 ? '' : 's'}.`)
            load()
            setOpen(b.id)
          }}
        />
      )}
      {creatingTpl && (
        <NewTemplateDialog
          onClose={() => setCreatingTpl(false)}
          onCreated={() => {
            setCreatingTpl(false)
            loadTemplates()
          }}
        />
      )}
      {open && <BroadcastDetailDialog id={open} onClose={() => setOpen(null)} onChanged={load} />}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete the template ${removing?.name}?`}
        description="It's deleted from your WhatsApp Business Account in every language. Broadcasts already sent aren't affected."
        confirmLabel="Delete template"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const t = removing!
          setRemoving(null)
          deleteTemplate(t.name).then(loadTemplates, (err) => toast.error(errorDetail(err)))
        }}
      />
    </div>
  )
}
