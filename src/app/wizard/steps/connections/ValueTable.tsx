import { AlertTriangle, ChevronDown, X } from 'lucide-react'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { agentFills } from '@/app/wizard/toolRequest'
import type { ActionValue, ValueSource, ValueType } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

const TYPES: { id: ValueType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'integer', label: 'Whole number' },
  { id: 'boolean', label: 'Yes/no' },
]
const SOURCES: { id: Exclude<ValueSource, 'conversation_memory'>; label: string }[] = [
  { id: 'conversation', label: 'The agent fills it from the chat' },
  { id: 'fixed', label: 'Always the same value' },
  { id: 'whatsapp_number', label: 'The customer’s WhatsApp number' },
]

/** How a value is filled, in a few words. */
function summary(v: ActionValue) {
  if (v.source === 'fixed') return v.fixedValue ? `Always: ${v.fixedValue}` : 'Always: (set a value)'
  if (v.source === 'whatsapp_number') return 'Customer’s WhatsApp number'
  const req = v.location === 'path' || v.required ? '' : ' (optional)'
  return v.description.trim() ? `From the chat: ${v.description.trim()}${req}` : `From the chat${req}`
}

/**
 * The values sent in one place (path, web address, headers or body), one line each: name, type, how
 * it's filled (opens a small panel) and remove. Path values come from the path's {placeholders}, so
 * their names can't be edited here and they can't be removed.
 */
export function ValueTable({
  values,
  problems,
  showProblem,
  focusId,
  keyHeaders,
  onChange,
  onRemove,
  onTouch,
}: {
  values: ActionValue[]
  problems: Record<string, string>
  /** Whether a value's problem shows yet (left, or Save pressed). */
  showProblem: (id: string) => boolean
  focusId: string | null
  /** Header names the connection already sends with its key (lowercase). */
  keyHeaders: Set<string>
  onChange: (id: string, p: Partial<ActionValue>) => void
  onRemove: (id: string) => void
  onTouch: (id: string) => void
}) {
  if (!values.length) return null
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {values.map((v) => {
        const problem = showProblem(v.id) ? problems[v.id] : undefined
        if (v.raw)
          return (
            <li key={v.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              <span className="font-mono">{v.name}</span>
              <span className="text-muted-foreground">{String(v.raw.type)} · kept exactly as the system defined it</span>
            </li>
          )
        const isPath = v.location === 'path'
        const clash = v.location === 'header' && keyHeaders.has(v.name.trim().toLowerCase())
        return (
          <li key={v.id} className={cn('px-2 py-1.5', problem && 'bg-destructive/5')}>
            <div className="flex items-center gap-1.5">
              <Input
                aria-label="Value name"
                value={v.name}
                disabled={isPath}
                autoFocus={focusId === v.id}
                onChange={(e) => onChange(v.id, { name: e.target.value })}
                onBlur={() => onTouch(v.id)}
                placeholder={v.location === 'header' ? 'X-Request-Id' : v.location === 'body' ? 'query' : 'limit'}
                aria-invalid={!!problem}
                className="h-8 w-36 shrink-0 font-mono disabled:opacity-100"
              />
              <Select value={v.type} onValueChange={(t) => onChange(v.id, { type: t as ValueType })}>
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
              <ValueSourcePopover value={v} clash={clash} onChange={(p) => onChange(v.id, p)} />
              {isPath ? (
                <span className="size-8 shrink-0" />
              ) : (
                <button type="button" onClick={() => onRemove(v.id)} aria-label={`Remove ${v.name || 'value'}`} className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive">
                  <X className="size-4" />
                </button>
              )}
            </div>
            {problem && (
              <p className="px-1 pt-1 text-xs text-destructive" role="alert">
                {problem}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** "From the chat: the order number" as a button; the panel sets where it comes from and what it needs. */
function ValueSourcePopover({ value: v, clash, onChange }: { value: ActionValue; clash: boolean; onChange: (p: Partial<ActionValue>) => void }) {
  const source = v.source === 'conversation_memory' ? 'conversation' : v.source
  const vague = agentFills(v) && !v.description.trim()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-left text-sm hover:bg-accent"
          aria-label={`How ${v.name || 'this value'} is filled: ${summary(v)}`}
        >
          {(clash || vague) && <AlertTriangle className="size-3.5 shrink-0 text-warning-foreground" />}
          <span className={cn('min-w-0 flex-1 truncate', vague && 'text-muted-foreground')}>{summary(v)}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div className="space-y-1.5">
          <Label>Where it comes from</Label>
          <Select value={source} onValueChange={(s) => onChange({ source: s as ValueSource })}>
            <SelectTrigger aria-label="Where the value comes from">
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
          <div className="space-y-1.5">
            <Label htmlFor={`fixed-${v.id}`}>Value</Label>
            <Input id={`fixed-${v.id}`} value={v.fixedValue ?? ''} onChange={(e) => onChange({ fixedValue: e.target.value })} placeholder="Sent every time" className="font-mono" />
          </div>
        )}
        {agentFills(v) && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`desc-${v.id}`}>What to take from the chat</Label>
              <Input id={`desc-${v.id}`} value={v.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="e.g. the order number, like ORD-12345" />
              {vague && <p className="text-xs text-muted-foreground">Without this, the agent has to guess what goes here.</p>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch size="sm" checked={v.location === 'path' || v.required} disabled={v.location === 'path'} onCheckedChange={(c) => onChange({ required: c })} />
              Required{v.location === 'path' && <span className="text-xs text-muted-foreground">(always, it’s in the path)</span>}
            </label>
          </>
        )}
        {source === 'whatsapp_number' && <p className="text-xs text-muted-foreground">Filled in automatically. Test &amp; Eval chats have no customer number.</p>}
        {clash && (
          <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> The connection already sends this header with your key. Remove this one unless the system needs both.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
