import { useState } from 'react'
import { AlertTriangle, ChevronRight, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Switch } from '@/app/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/app/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { META_NAME } from '@/app/api/meta'
import { newId } from '@/app/wizard/mockData'
import { agentFills, bodyAllowed, previewRequest, valueProblems } from '@/app/wizard/toolRequest'
import type { ActionMethod, ActionValue, Connection, ConnectionAction, ValueLocation, ValueSource, ValueType } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { newValue, similarTool, syncPathValues } from './helpers'
import { Field, FormSection, PlaceBadge, RequestPreviewBlock } from './parts'
import { PLACE } from './places'

const SM = { fontSize: 'var(--text-sm)' } as const
const METHODS: ActionMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const TYPES: { id: ValueType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'integer', label: 'Whole number' },
  { id: 'boolean', label: 'Yes/no' },
]
const SOURCES: { id: Exclude<ValueSource, 'conversation_memory'>; label: string }[] = [
  { id: 'conversation', label: 'Agent fills it from the chat' },
  { id: 'fixed', label: 'Always the same value' },
  { id: 'whatsapp_number', label: 'Customer’s WhatsApp number' },
]
const GROUPS: ValueLocation[] = ['path', 'query', 'header', 'body']
const SHORT_DESCRIPTION = 40

/** Add or edit one tool (one request the agent can make). Saving can also open its test straight away. */
export function ToolDialog({
  connection,
  initial,
  siblings,
  onSave,
  onClose,
}: {
  connection: Connection
  initial?: ConnectionAction
  /** The connection's other tools, for the "very similar name" warning. */
  siblings: ConnectionAction[]
  /** Resolves to an error message, or null once Meta accepted it. `test`: open the test after. */
  onSave: (tool: ConnectionAction, test: boolean) => Promise<string | null>
  onClose: () => void
}) {
  const [draft, setDraft] = useState<ConnectionAction>(
    () => initial ?? { id: newId('action'), connectionId: connection.id, name: '', description: '', method: 'GET', path: '/', values: [], createdAt: Date.now() },
  )
  const [focusId, setFocusId] = useState<string | null>(null)
  const [pendingMethod, setPendingMethod] = useState<ActionMethod | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [saving, setSaving] = useState<false | 'save' | 'test'>(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(!initial)

  const set = (p: Partial<ConnectionAction>) => setDraft((d) => ({ ...d, ...p }))
  const setValue = (id: string, p: Partial<ActionValue>) => set({ values: draft.values.map((v) => (v.id === id ? { ...v, ...p } : v)) })
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial ?? { ...draft, name: '', description: '', method: 'GET', path: '/', values: [], exampleQuestion: undefined })

  function addValue(place: ValueLocation) {
    const v = newValue('', place)
    set({ values: [...draft.values, v] })
    setFocusId(v.id)
  }
  function changeMethod(m: ActionMethod) {
    if (!bodyAllowed(m) && draft.values.some((v) => v.location === 'body')) setPendingMethod(m)
    else set({ method: m })
  }

  // ---- checks: blocking problems (footer, first one) and advice (inline, never blocking) ----
  const nameError = draft.name && !META_NAME.test(draft.name.trim()) ? 'Use only letters, numbers and underscores, e.g. look_up_order.' : null
  const pathError = draft.path && !draft.path.startsWith('/') ? 'Start the path with /' : null
  const vp = valueProblems(draft)
  const problems = [
    !draft.name.trim() ? 'Name the tool.' : nameError ? 'The tool name can only use letters, numbers and underscores.' : null,
    !draft.description.trim() ? 'Say when the agent should use this tool.' : null,
    pathError,
    ...Object.values(vp),
  ].filter((p): p is string => !!p)
  const canSave = problems.length === 0 && (!initial || dirty)
  const similar = draft.name ? similarTool(draft.name, siblings, draft.id) : undefined
  const keyHeaders = new Set((connection.apiKeys ?? []).filter((k) => k.location === 'header').map((k) => k.fieldName.toLowerCase()))
  const preview = previewRequest(connection.baseUrl, connection.authMethod === 'api_key' ? (connection.apiKeys ?? []) : [], draft)

  async function save(test: boolean) {
    if (!canSave) return
    setSaving(test ? 'test' : 'save')
    setSaveError(null)
    const tool = { ...draft, name: draft.name.trim(), description: draft.description.trim(), exampleQuestion: draft.exampleQuestion?.trim() || undefined, values: draft.values.map((v) => ({ ...v, name: v.name.trim() })) }
    const err = await onSave(tool, test)
    setSaving(false)
    if (err) setSaveError(err)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && (dirty && !saving ? setConfirmDiscard(true) : onClose())}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        <div className="space-y-1 border-b border-border px-6 pt-5 pb-4 pr-12">
          <DialogTitle>{initial ? `Edit ${initial.name}` : `Add a tool to ${connection.name}`}</DialogTitle>
          <DialogDescription className="text-xs">A tool is one request your agent can make to this system, like looking up an order.</DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-5">
          <FormSection n={1} title="What it does" help="Your agent decides when to use the tool from this, so be specific.">
            <Field label="Name" htmlFor="tool-name" error={nameError} help={similar ? undefined : 'Letters, numbers and underscores, e.g. search_products.'}>
              <Input id="tool-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="search_products" className="font-mono" aria-invalid={!!nameError} autoFocus={!initial} />
            </Field>
            {similar && (
              <p className="-mt-3 flex items-center gap-1.5 text-warning-foreground text-xs">
                <AlertTriangle className="size-3.5 shrink-0" /> Very close to “{similar.name}”. Clearly different names help the agent pick the right one.
              </p>
            )}
            <Field
              label="When should the agent use it?"
              htmlFor="tool-desc"
              help={
                draft.description.trim() && draft.description.trim().length < SHORT_DESCRIPTION
                  ? 'Add a little more: say what customers ask and what the tool returns.'
                  : 'Written for the agent: when to use it, what it needs, what it returns.'
              }
            >
              <Textarea
                id="tool-desc"
                rows={3}
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Use when a customer asks what we sell, a price, or whether something is in stock. Returns product names, prices and stock."
                className="resize-none"
              />
            </Field>
            <Field label="Example customer question (optional)" htmlFor="tool-example" help="Shown in Test & Eval so you can try the tool in a chat with one tap.">
              <Input id="tool-example" value={draft.exampleQuestion ?? ''} onChange={(e) => set({ exampleQuestion: e.target.value })} placeholder="How many Helo voice units do you have in stock?" />
            </Field>
          </FormSection>

          <FormSection n={2} title="The request" help="The part after the base address. Put changing parts in curly brackets, like /orders/{order_id}.">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <Select value={draft.method} onValueChange={(m) => changeMethod(m as ActionMethod)}>
                <SelectTrigger className="font-mono sm:w-28" aria-label="Method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex min-w-0 flex-1 items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
                <span className="max-w-[45%] shrink truncate border-r border-input bg-muted/50 px-2 py-2 font-mono text-muted-foreground text-xs" title={connection.baseUrl}>
                  {connection.baseUrl.replace(/^https:\/\//, '').replace(/\/+$/, '')}
                </span>
                <input
                  aria-label="Path"
                  value={draft.path}
                  onChange={(e) => set({ path: e.target.value, values: syncPathValues(e.target.value, draft.values) })}
                  placeholder="/orders/{order_id}"
                  className="min-w-0 flex-1 bg-transparent px-2 py-2 font-mono outline-none text-sm"
                />
              </div>
            </div>
            {pathError && (
              <p className="text-destructive text-xs">
                {pathError}
              </p>
            )}
          </FormSection>

          <FormSection n={3} title="Values it sends" help="Each value goes in one place. Pick the place first, then name it exactly as the system expects.">
            {vp[''] && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
                {vp['']}
              </p>
            )}
            {GROUPS.map((place) => {
              const vs = draft.values.filter((v) => v.location === place)
              const noBody = place === 'body' && !bodyAllowed(draft.method)
              if (noBody && !vs.length)
                return (
                  <div key={place} className="flex items-center gap-2 text-muted-foreground text-xs">
                    <PlaceBadge place="body" /> {draft.method} requests have no body.
                  </div>
                )
              return (
                <div key={place} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <PlaceBadge place={place} />
                      <span style={{ ...SM, fontWeight: 'var(--font-weight-medium)' }}>{PLACE[place].label}</span>
                      <span className="truncate font-mono text-muted-foreground text-xs">
                        {PLACE[place].example}
                      </span>
                    </div>
                    {place !== 'path' && !noBody && (
                      <button type="button" onClick={() => addValue(place)} className="flex shrink-0 items-center gap-1 text-primary hover:underline text-xs">
                        <Plus className="size-3.5" /> Add
                      </button>
                    )}
                  </div>
                  {place === 'path' && !vs.length && (
                    <p className="text-muted-foreground text-xs">
                      None. Add {'{placeholders}'} to the path to create them.
                    </p>
                  )}
                  {vs.map((v) => (
                    <ValueRow
                      key={v.id}
                      value={v}
                      problem={vp[v.id]}
                      autoFocus={focusId === v.id}
                      clashesWithKey={place === 'header' && keyHeaders.has(v.name.trim().toLowerCase())}
                      onChange={(p) => setValue(v.id, p)}
                      onRemove={() => set({ values: draft.values.filter((x) => x.id !== v.id) })}
                    />
                  ))}
                </div>
              )
            })}
          </FormSection>

          <section className="space-y-2">
            <button type="button" onClick={() => setPreviewOpen((o) => !o)} aria-expanded={previewOpen} className="flex items-center gap-1.5" style={{ ...SM, fontWeight: 'var(--font-weight-semi-bold)' }}>
              <ChevronRight className={cn('size-4 transition-transform', previewOpen && 'rotate-90')} /> What it sends
            </button>
            {previewOpen && (
              <>
                <RequestPreviewBlock preview={preview} />
                <p className="text-muted-foreground text-xs">
                  Highlighted parts are filled in by the agent during a chat.
                </p>
              </>
            )}
          </section>
        </div>

        <div className="space-y-3 border-t border-border px-6 py-4">
          {saveError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs" role="alert">
              {saveError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-muted-foreground text-xs">
              {!canSave && problems[0] ? problems[0] : 'Saved tools are live for your agent straight away.'}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => (dirty ? setConfirmDiscard(true) : onClose())}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => void save(false)} disabled={!canSave || !!saving}>
                {saving === 'save' && <Loader2 className="size-3.5 animate-spin" />} Save
              </Button>
              <Button onClick={() => void save(true)} disabled={!canSave || !!saving}>
                {saving === 'test' && <Loader2 className="size-3.5 animate-spin" />} Save and test
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={!!pendingMethod}
        title={`Remove the body values?`}
        description={`${pendingMethod} requests can’t have a body, so its ${draft.values.filter((v) => v.location === 'body').length} body value(s) would be removed.`}
        confirmLabel="Remove and switch"
        onConfirm={() => {
          set({ method: pendingMethod!, values: draft.values.filter((v) => v.location !== 'body') })
          setPendingMethod(null)
        }}
        onCancel={() => setPendingMethod(null)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        description="Nothing you changed here has been saved."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmDiscard(false)
          onClose()
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </Dialog>
  )
}

/** One value: name, type and where it comes from on one line; what it needs underneath. */
function ValueRow({
  value: v,
  problem,
  autoFocus,
  clashesWithKey,
  onChange,
  onRemove,
}: {
  value: ActionValue
  problem?: string
  autoFocus: boolean
  clashesWithKey: boolean
  onChange: (p: Partial<ActionValue>) => void
  onRemove: () => void
}) {
  const isPath = v.location === 'path'
  const source = v.source === 'conversation_memory' ? 'conversation' : v.source
  if (v.raw)
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs">
        <span>
          <span className="font-mono">{v.name}</span> <span className="text-muted-foreground">· {String(v.raw.type)} · kept exactly as the system defined it</span>
        </span>
      </div>
    )
  return (
    <div className="space-y-2 rounded-md border border-border p-2.5" style={{ borderLeft: `3px solid ${PLACE[v.location].tone}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Value name"
          value={v.name}
          disabled={isPath}
          autoFocus={autoFocus}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={v.location === 'header' ? 'X-Request-Id' : v.location === 'body' ? 'query' : 'limit'}
          className="h-8 min-w-0 flex-[1_1_9rem] font-mono"
          aria-invalid={!!problem}
        />
        <button type="button" onClick={onRemove} disabled={isPath} aria-label={`Remove ${v.name || 'value'}`} className="order-last flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:invisible">
          <X className="size-4" />
        </button>
        <Select value={v.type} onValueChange={(t) => onChange({ type: t as ValueType })}>
          <SelectTrigger className="h-8 w-32 shrink-0" aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(s) => onChange({ source: s as ValueSource })}>
          <SelectTrigger className="h-8 min-w-0 flex-[1_1_13rem]" aria-label="Where the value comes from">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {source === 'fixed' && (
        <Input aria-label={`Value for ${v.name || 'this value'}`} value={v.fixedValue ?? ''} onChange={(e) => onChange({ fixedValue: e.target.value })} placeholder="The value to send every time" className="h-8 font-mono" />
      )}
      {agentFills(v) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label={`What the agent should take from the chat for ${v.name || 'this value'}`}
            value={v.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="What to take from the chat, e.g. the order number, like ORD-12345"
            className="h-8 flex-1"
          />
          <label className="flex shrink-0 items-center gap-2 text-xs">
            <Switch size="sm" checked={isPath || v.required} disabled={isPath} onCheckedChange={(c) => onChange({ required: c })} />
            Required
          </label>
        </div>
      )}
      {source === 'whatsapp_number' && (
        <p className="text-muted-foreground text-xs">
          Filled in automatically with the customer&rsquo;s number. In Test &amp; Eval chats there&rsquo;s no customer number.
        </p>
      )}

      {problem ? (
        <p className="text-destructive text-xs" role="alert">
          {problem}
        </p>
      ) : clashesWithKey ? (
        <p className="flex items-center gap-1.5 text-warning-foreground text-xs">
          <AlertTriangle className="size-3.5 shrink-0" /> The connection already sends this header with your key. Remove this one unless the system needs both.
        </p>
      ) : (
        agentFills(v) &&
        !v.description.trim() && (
          <p className="text-muted-foreground text-xs">
            Tip: without a description the agent has to guess what goes here.
          </p>
        )
      )}
    </div>
  )
}
