import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Badge } from '@/app/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { createTemplate, deleteTemplate, listTemplates, type NewTemplate, type WaTemplate } from '@/app/api/templates'
import { renderTemplate, slotsOf } from '@/app/templates/templates'
import { can } from '@/app/lib/permissions'
import { TemplatePreview } from './TemplatePreview'

const TPL_STATUS: Record<string, string> = { APPROVED: 'bg-success text-success-foreground', REJECTED: 'bg-destructive text-destructive-foreground', PENDING: 'bg-warning/15 text-warning-foreground' }

/** WhatsApp › Message templates: the account's templates, Meta's review status, new ones and deletes.
 *  Templates are the only messages WhatsApp allows outside the 24-hour window (the Inbox sends them). */
export function TemplatesTab() {
  const { me } = useAuth()
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<WaTemplate | null>(null)

  const load = useCallback(() => {
    listTemplates().then(setTemplates, (err) => setError(errorDetail(err)))
  }, [])
  useEffect(load, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Approved templates are the only messages WhatsApp lets you send more than 24 hours after a customer last wrote. Send one from a chat in the Inbox. Meta reviews each new template, usually within minutes.
        </p>
        {can(me?.role, 'templates.create') && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New template
          </Button>
        )}
      </div>
      {error && <FormError>{error}</FormError>}
      {!templates && !error ? (
        <PageLoader context="whatsapp" className="min-h-[30vh]" />
      ) : templates?.length === 0 ? (
        <p className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates?.map((t) => (
            <li key={t.id} className="space-y-2 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.category.toLowerCase()} &middot; {t.language}
                  </p>
                </div>
                <span className="flex items-center gap-1">
                  <Badge className={TPL_STATUS[t.status] ?? 'bg-muted text-foreground'}>{t.status.toLowerCase()}</Badge>
                  {can(me?.role, 'templates.delete') && (
                    <Button variant="ghost" size="sm" className="h-7 px-1.5" aria-label={`Delete ${t.name}`} onClick={() => setRemoving(t)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </span>
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{renderTemplate(t, {})}</p>
              {t.rejectedReason && <p className="text-xs text-destructive">Rejected: {t.rejectedReason.toLowerCase().replace(/_/g, ' ')}</p>}
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewTemplateDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete the template ${removing?.name}?`}
        description="It's deleted from your WhatsApp Business Account in every language. Messages already sent aren't affected."
        confirmLabel="Delete template"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const t = removing!
          setRemoving(null)
          deleteTemplate(t.name).then(load, (err) => toast.error(errorDetail(err)))
        }}
      />
    </div>
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
                <Input id="t-name" aria-describedby="t-name-hint" value={t.name} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="diwali_offer" />
                <p id="t-name-hint" className="text-xs text-muted-foreground">Lowercase letters, numbers and _ (WhatsApp&rsquo;s rule)</p>
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
                    <span className="w-24 shrink-0 text-sm">
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
            <p className="text-muted-foreground text-xs">
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
