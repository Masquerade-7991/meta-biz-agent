import { useEffect, useMemo, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { FormError } from '@/app/auth/AuthLayout'
import { errorDetail } from '@/app/api/meta'
import { listTemplates, sendTemplateToChat, type WaTemplate } from '@/app/api/broadcasts'
import { renderTemplate, slotsOf } from '@/app/broadcasts/templates'
import { TemplatePreview } from './BroadcastsPage'

/** Reopens a chat after the 24-hour window with one approved template. */
export function SendTemplateDialog({ phone, name, onClose, onSent }: { phone: string; name?: string | null; onClose: () => void; onSent: () => void }) {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null)
  const [id, setId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    listTemplates().then((t) => setTemplates(t.filter((x) => x.status === 'APPROVED')), (err) => setError(errorDetail(err)))
  }, [])
  const tpl = templates?.find((t) => t.id === id)
  const slots = useMemo(() => (tpl ? slotsOf(tpl) : []), [tpl])
  async function go() {
    if (!tpl) return
    setBusy(true)
    setError(null)
    try {
      await sendTemplateToChat(phone, tpl, values)
      onSent()
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
          <DialogTitle>Send a template to {name || `+${phone}`}</DialogTitle>
          <DialogDescription>Outside the 24-hour window WhatsApp only allows approved templates. Once the customer replies, you can chat freely again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!templates ? (
            error ? null : <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select
                value={id}
                onValueChange={(v) => {
                  setId(v)
                  setValues({})
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={templates.length ? 'Pick an approved template' : 'No approved templates yet'} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {slots.map((s) => (
            <div key={s.id} className="space-y-1.5">
              <Label htmlFor={`slot-${s.id}`}>{s.label}</Label>
              <Input id={`slot-${s.id}`} value={values[s.id] ?? ''} onChange={(e) => setValues({ ...values, [s.id]: e.target.value })} placeholder={s.kind === 'media' ? 'https://…' : ''} />
            </div>
          ))}
          {tpl && <TemplatePreview text={renderTemplate(tpl, values)} />}
          {error && <FormError>{error}</FormError>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void go()} disabled={busy || !tpl || slots.some((s) => !values[s.id]?.trim())}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
