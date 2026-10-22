import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { newId } from '@/app/wizard/mockData'
import { toMetaName } from '@/app/wizard/metaName'
import { useTouched } from '@/app/wizard/formTouch'
import { bodyAllowed, valueProblems } from '@/app/wizard/toolRequest'
import type { ActionMethod, ActionValue, Connection, ConnectionAction, ValueLocation } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { newValue, similarTool, syncPathValues } from './helpers'
import { Field, Group, MethodBadge } from './parts'
import { ValueTable } from './ValueTable'

const METHODS: ActionMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const TABS: { place: Exclude<ValueLocation, 'path'>; label: string; add: string; empty: string }[] = [
  { place: 'query', label: 'Params', add: 'Add param', empty: 'Values added to the address, like ?limit=3.' },
  { place: 'header', label: 'Headers', add: 'Add header', empty: 'Extra headers, like X-Request-Id. Your key is already sent.' },
  { place: 'body', label: 'Body', add: 'Add body value', empty: 'Values sent as JSON, like { "query": … }.' },
]
const SHORT_DESCRIPTION = 40

/** Add or edit one tool (one request the agent can make). Saving can also open its test straight away. */
export function ToolEditor({
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
  const [tab, setTab] = useState<string>(() => TABS.find((x) => draft.values.some((v) => v.location === x.place))?.place ?? 'query')
  const [more, setMore] = useState(!!initial?.exampleQuestion)
  const t = useTouched()

  const set = (p: Partial<ConnectionAction>) => setDraft((d) => ({ ...d, ...p }))
  const setValue = (id: string, p: Partial<ActionValue>) => set({ values: draft.values.map((v) => (v.id === id ? { ...v, ...p } : v)) })
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial ?? { ...draft, name: '', description: '', method: 'GET', path: '/', values: [], exampleQuestion: undefined })
  const metaName = toMetaName(draft.name)

  function addValue(place: ValueLocation) {
    const v = newValue('', place)
    set({ values: [...draft.values, v] })
    setFocusId(v.id)
  }
  function changeMethod(m: ActionMethod) {
    if (!bodyAllowed(m) && draft.values.some((v) => v.location === 'body')) setPendingMethod(m)
    else {
      set({ method: m })
      if (!bodyAllowed(m) && tab === 'body') setTab('query')
    }
  }

  // ---- problems: per field, shown once it was left or after Save ----
  const vp = valueProblems(draft)
  const errors: Record<string, string | null> = {
    name: !draft.name.trim() ? 'Name the tool.' : !metaName ? 'Use some letters or numbers in the name.' : null,
    description: !draft.description.trim() ? 'Say when the agent should use this tool.' : null,
    path: draft.path && !draft.path.startsWith('/') ? 'Start the path with /' : null,
  }
  const problems = [...Object.values(errors), ...Object.values(vp)].filter((p): p is string => !!p)
  const err = (f: string) => (t.shows(f) ? errors[f] : null)
  const canSave = problems.length === 0 && (!initial || dirty)
  const similar = draft.name ? similarTool(metaName, siblings, draft.id) : undefined
  const keyHeaders = new Set((connection.apiKeys ?? []).filter((k) => k.location === 'header').map((k) => k.fieldName.toLowerCase()))
  const pathValues = draft.values.filter((v) => v.location === 'path')
  const shortDesc = draft.description.trim() && draft.description.trim().length < SHORT_DESCRIPTION
  const table = (vs: ActionValue[]) => (
    <ValueTable
      values={vs}
      problems={vp}
      showProblem={(id) => t.shows(id)}
      focusId={focusId}
      keyHeaders={keyHeaders}
      onChange={setValue}
      onRemove={(id) => set({ values: draft.values.filter((x) => x.id !== id) })}
      onTouch={t.touch}
    />
  )

  async function save(test: boolean) {
    t.showAll()
    if (!canSave) return
    setSaving(test ? 'test' : 'save')
    setSaveError(null)
    const tool = { ...draft, name: metaName, description: draft.description.trim(), exampleQuestion: draft.exampleQuestion?.trim() || undefined, values: draft.values.map((v) => ({ ...v, name: v.name.trim() })) }
    const e = await onSave(tool, test)
    setSaving(false)
    if (e) setSaveError(e)
  }
  // A new tool is worth trying straight away; an edited one usually just needs saving.
  const primary = initial ? { test: false, label: 'Save' } : { test: true, label: 'Save and test' }
  const secondary = initial ? { test: true, label: 'Save and test' } : { test: false, label: 'Save without testing' }

  return (
    <Dialog open onOpenChange={(o) => !o && (dirty && !saving ? setConfirmDiscard(true) : onClose())}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-2xl" onOpenAutoFocus={(e) => initial && e.preventDefault()}>
        <div className="space-y-1 border-b border-border px-6 pt-5 pb-4 pr-12">
          <DialogTitle>{initial ? `Edit ${initial.name}` : 'Add a tool'}</DialogTitle>
          <DialogDescription className="text-xs">
            One request your agent can make to <span className="font-mono text-foreground">{connection.name}</span>, like looking up an order.
          </DialogDescription>
        </div>

          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">
            <Group title="What it does" help="Your agent decides when to use the tool from this, so be specific.">
              <Field
                label="Name"
                htmlFor="tool-name"
                error={err('name')}
                help={
                  similar ? (
                    <span className="flex items-center gap-1.5 text-warning-foreground">
                      <AlertTriangle className="size-3.5 shrink-0" /> Very close to “{similar.name}”. Clearly different names help the agent pick the right one.
                    </span>
                  ) : metaName && metaName !== draft.name.trim() ? (
                    <>
                      Saved as <span className="font-mono">{metaName}</span>
                    </>
                  ) : undefined
                }
              >
                <Input id="tool-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} onBlur={() => t.touch('name')} placeholder="look up order" aria-invalid={!!err('name')} autoFocus={!initial} />
              </Field>
              <Field label="When should the agent use it?" htmlFor="tool-desc" error={err('description')} help={shortDesc ? 'Add a little more: what customers ask, and what the tool returns.' : undefined}>
                <Textarea
                  id="tool-desc"
                  rows={3}
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  onBlur={() => t.touch('description')}
                  placeholder="When a customer asks where their order is. Returns its status and delivery date."
                  className="resize-none"
                />
              </Field>
            </Group>

            <Group title="Request" help="Put the parts that change in curly brackets, like /orders/{order_id}.">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <Select value={draft.method} onValueChange={(m) => changeMethod(m as ActionMethod)}>
                  <SelectTrigger className="sm:w-32" aria-label="Method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        <MethodBadge method={m} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className={cn('flex min-w-0 flex-1 items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring', err('path') && 'border-destructive')}>
                  <span className="max-w-[45%] shrink truncate border-r border-input bg-muted/50 px-2 py-2 font-mono text-xs text-muted-foreground" title={connection.baseUrl}>
                    {connection.baseUrl.replace(/^https:\/\//, '').replace(/\/+$/, '')}
                  </span>
                  <input
                    aria-label="Path"
                    value={draft.path}
                    onChange={(e) => set({ path: e.target.value, values: syncPathValues(e.target.value, draft.values) })}
                    onBlur={() => t.touch('path')}
                    placeholder="/orders/{order_id}"
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 font-mono text-sm outline-none"
                  />
                </div>
              </div>
              {err('path') && (
                <p className="text-xs text-destructive" role="alert">
                  {err('path')}
                </p>
              )}
              {pathValues.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">From the path</p>
                  {table(pathValues)}
                </div>
              )}
            </Group>

            <Group title="Values it sends">
              {t.all && vp[''] && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{vp['']}</p>}
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  {TABS.map((x) => {
                    const n = draft.values.filter((v) => v.location === x.place).length
                    const off = x.place === 'body' && !bodyAllowed(draft.method) && !n
                    return (
                      <TabsTrigger key={x.place} value={x.place} disabled={off} title={off ? `${draft.method} requests have no body` : undefined}>
                        {x.label}
                        {n > 0 && <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-micro font-semibold text-primary tabular-nums">{n}</span>}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
                {TABS.map((x) => {
                  const vs = draft.values.filter((v) => v.location === x.place)
                  return (
                    <TabsContent key={x.place} value={x.place} className="space-y-2 pt-3">
                      {vs.length ? table(vs) : <p className="text-xs text-muted-foreground">{x.empty}</p>}
                      <Button variant="outline" size="sm" onClick={() => addValue(x.place)}>
                        <Plus className="size-3.5" /> {x.add}
                      </Button>
                    </TabsContent>
                  )
                })}
              </Tabs>
            </Group>

            <section className="space-y-3">
              <button type="button" onClick={() => setMore((o) => !o)} aria-expanded={more} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ChevronRight className={cn('size-4 transition-transform', more && 'rotate-90')} /> More: an example question for Test &amp; Eval
              </button>
              {more && (
                <Field label="Example customer question" htmlFor="tool-example" help="Shown in Test & Eval so you can try the tool in a chat with one tap.">
                  <Input id="tool-example" value={draft.exampleQuestion ?? ''} onChange={(e) => set({ exampleQuestion: e.target.value })} placeholder="Where is my order ORD-12345?" />
                </Field>
              )}
            </section>
          </div>


        <div className="flex flex-col items-stretch gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {saveError ? (
              <p className="text-xs text-destructive" role="alert">
                {saveError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t.all && problems.length ? `${problems.length === 1 ? '1 thing' : `${problems.length} things`} to fix: ${problems[0]}` : 'Saved tools are live for your agent straight away.'}</p>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="ghost" onClick={() => (dirty ? setConfirmDiscard(true) : onClose())}>
              Cancel
            </Button>
            <div className="flex">
              <Button className="rounded-r-none" onClick={() => void save(primary.test)} disabled={!!saving || (!!initial && !dirty)}>
                {saving && <Loader2 className="size-3.5 animate-spin" />} {primary.label}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" disabled={!!saving || (!!initial && !dirty)} aria-label="More ways to save">
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void save(secondary.test)}>{secondary.label}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={!!pendingMethod}
        title="Remove the body values?"
        description={`${pendingMethod} requests can’t have a body, so its ${draft.values.filter((v) => v.location === 'body').length} body value(s) would be removed.`}
        confirmLabel="Remove and switch"
        onConfirm={() => {
          set({ method: pendingMethod!, values: draft.values.filter((v) => v.location !== 'body') })
          if (tab === 'body') setTab('query')
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
