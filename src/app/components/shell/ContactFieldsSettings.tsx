import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { listFields, saveFields, type FieldDef } from '@/app/api/contacts'
import { SECTION_TITLE, TEXT_SM_OPEN } from '@/app/lib/text'
import { can } from '@/app/lib/permissions'

type Row = { key: string; label: string; type: FieldDef['type']; options: string }

/** Settings → Contact fields: extra details kept on every contact (city, plan, renewal date…). */
export function ContactFieldsSettings() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    listFields().then(
      (f) => setRows(f.map((x) => ({ key: x.key, label: x.label, type: x.type, options: x.options?.join(', ') ?? '' }))),
      (err) => setError(errorDetail(err)),
    )
  }, [])
  const set = (i: number, patch: Partial<Row>) => setRows((prev) => prev!.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const saved = await saveFields(rows!.map((r) => ({ key: r.key, label: r.label, type: r.type, ...(r.type === 'select' && { options: r.options.split(',').map((o) => o.trim()).filter(Boolean) }) })))
      setRows(saved.map((x) => ({ key: x.key, label: x.label, type: x.type, options: x.options?.join(', ') ?? '' })))
      toast.success('Contact fields saved.')
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6 py-2">
      <div className="space-y-1">
        <h2 style={SECTION_TITLE}>Contact fields</h2>
        <p className="text-muted-foreground" style={TEXT_SM_OPEN}>
          Extra details you keep on every contact, like city or plan. They show in Contacts, can be filled from a CSV column with the same name, and can fill broadcast variables.
        </p>
      </div>
      {!rows ? (
        error ? <FormError>{error}</FormError> : <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <fieldset disabled={!canEdit} className="space-y-3">
          {!canEdit && (
            <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground" style={TEXT_SM_OPEN}>
              Only owners and admins can change contact fields.
            </p>
          )}
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground" style={TEXT_SM_OPEN}>
              No custom fields yet.
            </p>
          )}
          {rows.map((r, i) => (
            <div key={r.key || i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <Input value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Field name, e.g. City" className="h-9 w-48" aria-label="Field name" />
              <Select value={r.type} onValueChange={(v) => set(i, { type: v as Row['type'] })}>
                <SelectTrigger className="h-9 w-32" aria-label="Field type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="select">Choice</SelectItem>
                </SelectContent>
              </Select>
              {r.type === 'select' && <Input value={r.options} onChange={(e) => set(i, { options: e.target.value })} placeholder="Choices, separated by commas" className="h-9 min-w-48 flex-1" aria-label="Choices" />}
              <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-label={`Remove ${r.label || 'field'}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { key: '', label: '', type: 'text', options: '' }])}>
                <Plus className="size-4" />
                Add field
              </Button>
              <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Save fields
              </Button>
              {error && <FormError>{error}</FormError>}
            </div>
          )}
        </fieldset>
      )}
    </div>
  )
}
