import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Tags, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { EmptyState } from '@/app/components/ui/page'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { FIELD_LIMITS, fieldKey, fieldUsage, getFields, saveFields, type FieldDef } from '@/app/api/contacts'
import { can } from '@/app/lib/permissions'
import { SettingsSection } from './SettingsSection'
import { FormFooter, LoadGate, ReadOnlyNote } from './settings/SettingsUi'
import { useSettingsForm } from './settings/useSettingsForm'

/** One row as edited: `key` is empty until the server names a new field. `uid` keeps React's rows apart. */
type Row = { uid: string; key: string; label: string; type: FieldDef['type']; options: string }
let uid = 0
const rowOf = (x: FieldDef): Row => ({ uid: `f${++uid}`, key: x.key, label: x.label, type: x.type, options: x.options?.join(', ') ?? '' })
const TYPE_LABEL: Record<FieldDef['type'], string> = { text: 'Text', number: 'Number', date: 'Date', select: 'Choice' }
const choices = (r: Row) => r.options.split(',').map((o) => o.trim()).filter(Boolean)

function validate(rows: Row[]) {
  const e: Record<string, string> = {}
  const keys = new Map<string, string>()
  for (const r of rows) {
    const label = r.label.trim()
    if (!label) e[r.uid] = 'Give the field a name.'
    else if (label.length > FIELD_LIMITS.label) e[r.uid] = `Keep the name to ${FIELD_LIMITS.label} characters.`
    else if (r.type === 'select' && !choices(r).length) e[r.uid] = 'Add the choices, separated by commas.'
    const k = r.key || fieldKey(label)
    if (k && keys.has(k)) e[r.uid] = `“${label}” would share the CSV column ${k} with “${keys.get(k)}”.`
    if (k) keys.set(k, label)
  }
  if (rows.length > FIELD_LIMITS.fields) e.count = `Keep it to ${FIELD_LIMITS.fields} fields.`
  return e
}

/** Settings › Contact fields: extra details kept on every contact (city, plan, renewal date…). */
export function ContactFieldsSettings() {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'settings.manage')
  // A removed field or a new type clears contacts' values: ask first, with how many it touches.
  const [asking, setAsking] = useState<{ title: string; description: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const form = useSettingsForm<Row[]>({
    load: () => getFields().then((r) => ({ value: r.fields.map(rowOf), stamp: r.stamp })),
    save: async (rows, since) => {
      const r = await saveFields(rows.map((x) => ({ ...(x.key && { key: x.key }), label: x.label.trim(), type: x.type, ...(x.type === 'select' && { options: choices(x) }) })), since)
      return { value: r.fields.map(rowOf), stamp: r.stamp }
    },
    validate,
  })
  if (form.state !== 'ready' || !form.draft || !form.saved) return <LoadGate error={form.loadError} onRetry={form.reload} what="the contact fields" />
  const rows = form.draft
  const before = form.saved
  const set = (u: string, patch: Partial<Row>) => form.set((prev) => prev.map((r) => (r.uid === u ? { ...r, ...patch } : r)))

  /** Works out what the save would clear, asks if anything, then saves. */
  async function save(): Promise<boolean> {
    if (form.invalid) return form.save()
    const removed = before.filter((b) => b.key && !rows.some((r) => r.key === b.key))
    const retyped = before.filter((b) => rows.some((r) => r.key === b.key && (r.type !== b.type || (r.type === 'select' && choices(r).join() !== choices(b).join()))))
    if (!removed.length && !retyped.length) return form.save()
    setChecking(true)
    try {
      const usage = await Promise.all([...removed, ...retyped].map((f) => fieldUsage(f.key).then((u) => ({ f, u }))))
      const touched = usage.filter((x) => x.u.contacts > 0 || x.u.segments.length > 0)
      if (!touched.length) return form.save()
      const lines = touched.map(({ f, u }) => {
        const gone = removed.includes(f)
        const what = gone ? `Remove ${f.label} from ${u.contacts.toLocaleString()} contact${u.contacts === 1 ? '' : 's'}` : `${f.label}: values that don’t fit the new type are cleared (up to ${u.contacts.toLocaleString()} contact${u.contacts === 1 ? '' : 's'})`
        return u.segments.length && gone ? `${what}; the segment${u.segments.length === 1 ? '' : 's'} ${u.segments.map((x) => `“${x.name}”`).join(', ')} stop filtering on it (a segment with no other filter is deleted).` : `${what}.`
      })
      setAsking({ title: removed.length === 1 && !retyped.length ? `Remove ${removed[0].label} from ${touched[0].u.contacts.toLocaleString()} contacts?` : 'Clear these values?', description: `${lines.join(' ')} This can’t be undone.` })
      return false
    } catch (err) {
      toast.error('Couldn’t check which contacts use these fields', { description: errorDetail(err) })
      return false
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-w-0">
      {!canEdit && <ReadOnlyNote>Only owners and admins can change contact fields.</ReadOnlyNote>}
      <SettingsSection
        stacked
        title="Contact fields"
        description={`Extra details you keep on every contact, like city or plan. They show in Contacts, and a contacts CSV fills each from the column named below. Up to ${FIELD_LIMITS.fields} fields, names up to ${FIELD_LIMITS.label} characters.`}
      >
        <fieldset disabled={!canEdit || checking} className="max-w-3xl space-y-3">
          {rows.length === 0 && (
            <EmptyState
              icon={Tags}
              title="No custom fields yet"
              description="Add the details you keep about customers, like City, Plan or Renewal date."
              action={
                canEdit && (
                  <Button size="sm" onClick={() => form.set((p) => [...p, { uid: `f${++uid}`, key: '', label: '', type: 'text', options: '' }])}>
                    <Plus className="size-4" /> Add field
                  </Button>
                )
              }
            />
          )}
          {rows.map((r) => {
            const column = r.key || fieldKey(r.label)
            const err = form.liveErrors[r.uid]
            const was = before.find((b) => b.key && b.key === r.key)
            return (
              <div key={r.uid} className="space-y-2 rounded-lg border border-border p-3" data-density-row>
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={r.label} maxLength={FIELD_LIMITS.label} onChange={(e) => set(r.uid, { label: e.target.value })} placeholder="Field name, e.g. City" className="h-9 w-48" aria-label="Field name" aria-invalid={!!err && form.dirty} />
                  <Select value={r.type} onValueChange={(v) => set(r.uid, { type: v as Row['type'] })}>
                    <SelectTrigger className="h-9 w-32" aria-label="Field type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPE_LABEL) as FieldDef['type'][]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {r.type === 'select' && <Input value={r.options} onChange={(e) => set(r.uid, { options: e.target.value })} placeholder="Choices, separated by commas" className="h-9 min-w-48 flex-1" aria-label="Choices" />}
                  {canEdit && (
                    <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-label={`Remove ${r.label || 'field'}`} onClick={() => form.set((p) => p.filter((x) => x.uid !== r.uid))}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <p className="text-meta text-muted-foreground">
                  CSV column: {column ? <code className="font-mono">{column}</code> : 'named when saved'}
                  {was && was.type !== r.type && <span className="text-warning-foreground"> · was {TYPE_LABEL[was.type]}: values that don’t fit are cleared when you save</span>}
                </p>
                {err && form.dirty && <p className="text-xs text-destructive">{err}</p>}
              </div>
            )
          })}
          {form.liveErrors.count && <p className="text-sm text-destructive">{form.liveErrors.count}</p>}
          {canEdit && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={rows.length >= FIELD_LIMITS.fields} onClick={() => form.set((p) => [...p, { uid: `f${++uid}`, key: '', label: '', type: 'text', options: '' }])}>
                <Plus className="size-4" />
                Add field
              </Button>
              <span className="text-meta text-muted-foreground">
                {rows.length} of {FIELD_LIMITS.fields} fields
              </span>
            </div>
          )}
        </fieldset>
        {canEdit && <FormFooter form={form} onSave={save} />}
      </SettingsSection>
      <ConfirmDialog
        open={!!asking}
        title={asking?.title ?? ''}
        description={asking?.description}
        confirmLabel="Save and clear"
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null)
          void form.save()
        }}
      />
    </div>
  )
}
