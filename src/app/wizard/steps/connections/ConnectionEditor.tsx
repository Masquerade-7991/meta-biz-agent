import { useMemo, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { SegmentedControl } from '@/app/components/wizard/SegmentedControl'
import { TagInput } from '@/app/components/wizard/TagInput'
import { newId } from '@/app/wizard/mockData'
import { toMetaName } from '@/app/wizard/metaName'
import { useTouched } from '@/app/wizard/formTouch'
import type { ApiKeyEntry, Connection } from '@/app/wizard/types'
import { Field, Group, SecretInput } from './parts'
import { KEY_MODES, keyEntry, keyMode, type KeyMode } from './places'

// Create or edit a connection. Keys are typed once and never kept in this browser: Meta holds them, and an edit only
// sends sign-in details when they change (Meta keeps them otherwise).

interface KeyRow {
  id: string
  mode: KeyMode
  fieldName: string
  prefix: string
  value: string
  /** Last characters of the key Meta holds; undefined for a new row. */
  savedHint?: string
  replacing: boolean
  /** The prefix field is open (Custom header only). */
  showPrefix?: boolean
}

const CHECKLIST = [
  'To connect our AI agent to your system, please share:',
  '- What the system is for (one sentence)',
  '- Its base web address, starting with https:// (e.g. https://api.example.com/v1)',
  '- How it signs in: an access key (and the header or parameter it goes in), client credentials, or none',
  '- The key or credentials',
  '- The requests the agent should make (method, path and the values each one needs)',
].join('\n')

const SEND_AS: Record<KeyMode, string> = { bearer: 'Bearer token', header: 'Custom header', query: 'URL parameter' }
const AUTH = [
  { id: 'api_key', label: 'Access key' },
  { id: 'client_credentials', label: 'OAuth (client credentials)' },
  { id: 'none', label: 'None' },
] as const

const toRows = (keys: ApiKeyEntry[] | undefined): KeyRow[] =>
  keys?.length
    ? keys.map((k) => ({ id: k.id, mode: keyMode(k), fieldName: k.fieldName, prefix: k.prefix, value: '', savedHint: k.hint ?? '', replacing: false, showPrefix: !!k.prefix && keyMode(k) === 'header' }))
    : [{ id: newId('key'), mode: 'bearer', fieldName: '', prefix: '', value: '', replacing: true }]

const shape = (rows: KeyRow[]) => JSON.stringify(rows.map((r) => [r.mode, r.fieldName.trim(), r.prefix]))

export function ConnectionEditor({
  initial,
  replaceKeys,
  onSave,
  onClose,
}: {
  initial?: Connection
  /** Opened from "Replace key": the key fields start ready to type. */
  replaceKeys?: boolean
  /** Resolves to an error message, or null once Meta accepted it. `auth`: send sign-in details. */
  onSave: (c: Omit<Connection, 'id' | 'createdAt' | 'demoStatus'>, auth: boolean) => Promise<string | null>
  onClose: () => void
}) {
  const editing = !!initial?.metaId
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [protocol, setProtocol] = useState<'http' | 'mcp'>(initial?.protocol ?? 'http')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [authMethod, setAuthMethod] = useState<Connection['authMethod']>(initial?.authMethod ?? 'api_key')
  const initialRows = useMemo(() => toRows(initial?.apiKeys), [initial])
  const [rows, setRows] = useState<KeyRow[]>(() => initialRows.map((r) => ({ ...r, replacing: r.replacing || !!replaceKeys })))
  const [tokenUrl, setTokenUrl] = useState(initial?.tokenUrl ?? '')
  const [clientId, setClientId] = useState(initial?.clientId ?? '')
  const [scopes, setScopes] = useState<string[]>(initial?.scopes ?? [])
  const [tokenContentType, setTokenContentType] = useState<'form' | 'json'>(initial?.tokenContentType ?? 'form')
  const savedSecret = initial?.authMethod === 'client_credentials' ? (initial.clientSecretHint ?? '') : undefined
  const [secret, setSecret] = useState('')
  const [replacingSecret, setReplacingSecret] = useState(savedSecret === undefined || !!replaceKeys)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const t = useTouched()

  const patchRow = (id: string, p: Partial<KeyRow>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const metaName = toMetaName(name)

  // ---- what changed, and what must be sent ----
  const oauthChanged =
    tokenUrl !== (initial?.tokenUrl ?? '') || clientId !== (initial?.clientId ?? '') || JSON.stringify(scopes) !== JSON.stringify(initial?.scopes ?? []) || tokenContentType !== (initial?.tokenContentType ?? 'form') || !!secret
  const keysChanged = shape(rows) !== shape(initialRows) || rows.some((r) => r.value)
  const authChanged = !editing || authMethod !== initial?.authMethod || (authMethod === 'api_key' && keysChanged) || (authMethod === 'client_credentials' && oauthChanged)
  const dirty =
    name !== (initial?.name ?? '') || description !== (initial?.description ?? '') || baseUrl !== (initial?.baseUrl ?? '') || protocol !== (initial?.protocol ?? 'http') || (editing ? authChanged : authMethod !== 'api_key' || keysChanged || oauthChanged)

  // ---- problems, per field; each shows once its field was left, or all after Save ----
  const errors: Record<string, string | null> = {
    name: !name.trim() ? 'Add a name.' : !metaName ? 'Use some letters or numbers in the name.' : null,
    description: !description.trim() ? 'Say what the system is for.' : null,
    url: !baseUrl.trim() ? `Add the ${protocol === 'mcp' ? 'MCP server' : 'web'} address.` : !/^https:\/\/[^\s/]+\.[^\s]+/.test(baseUrl.trim()) ? 'Use a full https:// address, e.g. https://api.example.com/v1' : null,
  }
  if (authMethod === 'api_key') {
    const seen = new Set<string>()
    for (const r of rows) {
      const f = r.mode === 'bearer' ? 'authorization' : r.fieldName.trim().toLowerCase()
      errors[`field-${r.id}`] = r.mode !== 'bearer' && !f ? `Add the ${r.mode === 'query' ? 'parameter' : 'header'} name.` : seen.has(`${r.mode === 'query'}:${f}`) ? 'Two keys use the same name.' : null
      errors[`key-${r.id}`] = authChanged && !r.value.trim() ? (editing ? 'Enter this key again: changing sign-in sends every key afresh.' : 'Enter the key.') : null
      seen.add(`${r.mode === 'query'}:${f}`)
    }
  }
  if (authMethod === 'client_credentials') {
    errors.tokenUrl = !/^https:\/\//.test(tokenUrl.trim()) ? 'Add the token address (https://).' : null
    errors.clientId = !clientId.trim() ? 'Add the client ID.' : null
    errors.secret = authChanged && !secret.trim() ? (editing ? 'Enter the client secret again to change sign-in.' : 'Add the client secret.') : null
  }
  const problems = Object.values(errors).filter((e): e is string => !!e)
  const err = (field: string) => (t.shows(field) ? errors[field] : null)
  const canSave = problems.length === 0 && (!editing || dirty)

  function requestClose() {
    if (dirty && !saving) setConfirmDiscard(true)
    else onClose()
  }

  async function save() {
    t.showAll()
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    const error = await onSave(
      {
        name: metaName,
        description: description.trim(),
        baseUrl: baseUrl.trim(),
        protocol,
        authMethod,
        ...(authMethod === 'api_key' ? { apiKeys: rows.map((r) => keyEntry(r)) } : {}),
        ...(authMethod === 'client_credentials' ? { tokenUrl: tokenUrl.trim(), clientId: clientId.trim(), clientSecret: secret, scopes, tokenContentType } : {}),
      },
      authChanged,
    )
    setSaving(false)
    setSaveError(error)
  }

  function copyChecklist() {
    const done = (ok: boolean) => {
      setCopied(ok ? 'yes' : 'no')
      setTimeout(() => setCopied(null), 2500)
    }
    try {
      void navigator.clipboard.writeText(CHECKLIST).then(() => done(true), () => done(false))
    } catch {
      done(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-xl" onOpenAutoFocus={(e) => editing && e.preventDefault()}>
        <div className="space-y-1 border-b border-border px-6 pt-5 pb-4 pr-12">
          <DialogTitle>{editing ? `Edit ${initial?.name}` : 'Connect a system'}</DialogTitle>
          <DialogDescription className="text-xs">
            Lets your agent look things up or take actions in another system.{' '}
            <button type="button" onClick={copyChecklist} className="text-primary hover:underline">
              {copied === 'yes' ? 'Checklist copied' : copied === 'no' ? 'Couldn’t copy' : 'Copy a checklist for your developer'}
            </button>
          </DialogDescription>
        </div>

          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">
            <Group title="About" help="Your agent reads this to decide when the system can help.">
              <Field label="Name" htmlFor="conn-name" error={err('name')} help={metaName && metaName !== name.trim() ? <>Saved as <span className="font-mono">{metaName}</span></> : undefined}>
                <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => t.touch('name')} placeholder="Shopify store" aria-invalid={!!err('name')} autoFocus={!editing} />
              </Field>
              <Field label="What is it for?" htmlFor="conn-description" error={err('description')}>
                <Textarea id="conn-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => t.touch('description')} placeholder="Our online store: products, prices, stock and orders." className="resize-none" />
              </Field>
            </Group>

            <Group title="Address">
              <SegmentedControl
                label="Connection type"
                value={protocol}
                onChange={setProtocol}
                disabled={editing}
                title={editing ? 'The type can’t change after creating. Make a new connection to switch.' : undefined}
                options={[
                  { id: 'http', label: 'API' },
                  { id: 'mcp', label: 'MCP server' },
                ]}
              />
              <Field
                label={protocol === 'mcp' ? 'MCP server address' : 'Base address'}
                htmlFor="conn-url"
                error={err('url')}
                help={protocol === 'mcp' ? 'Meta asks this server which tools it has.' : 'Every request starts with it, including any version, e.g. /v1.'}
              >
                <Input id="conn-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} onBlur={() => t.touch('url')} placeholder={protocol === 'mcp' ? 'https://example.com/mcp' : 'https://api.example.com/v1'} aria-invalid={!!err('url')} className="font-mono" inputMode="url" />
              </Field>
            </Group>

            <Group title="Sign-in" help={editing ? 'Saved keys stay as they are unless you change them here.' : undefined}>
              <SegmentedControl label="Sign-in method" value={authMethod} onChange={setAuthMethod} options={[...AUTH]} />

              {authMethod === 'api_key' && (
                <div className="space-y-3">
                  {rows.map((r) => (
                    <div key={r.id} className="space-y-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <Select value={r.mode} onValueChange={(mode) => patchRow(r.id, { mode: mode as KeyMode })}>
                          <SelectTrigger className="w-40 shrink-0" aria-label="Send the key as">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {KEY_MODES.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {SEND_AS[m.id]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {r.mode !== 'bearer' && (
                          <Input
                            aria-label={r.mode === 'query' ? 'Parameter name' : 'Header name'}
                            value={r.fieldName}
                            onChange={(e) => patchRow(r.id, { fieldName: e.target.value })}
                            onBlur={() => t.touch(`field-${r.id}`)}
                            placeholder={r.mode === 'query' ? 'api_key' : 'X-API-Key'}
                            aria-invalid={!!err(`field-${r.id}`)}
                            className="w-44 font-mono"
                          />
                        )}
                        <div className="min-w-48 flex-1" onBlur={() => t.touch(`key-${r.id}`)}>
                          <SecretInput
                            id={`key-value-${r.id}`}
                            value={r.value}
                            onChange={(value) => patchRow(r.id, { value })}
                            savedHint={r.savedHint}
                            replacing={r.replacing || (authChanged && editing)}
                            onReplace={() => patchRow(r.id, { replacing: true })}
                            onKeep={authChanged && editing ? undefined : () => patchRow(r.id, { replacing: false, value: '' })}
                            placeholder={r.savedHint ? `Saved key ends in ${r.savedHint}` : 'Paste the key'}
                            invalid={!!err(`key-${r.id}`)}
                          />
                        </div>
                        {rows.length > 1 && (
                          <Button variant="ghost" size="icon-sm" className="mt-1" aria-label="Remove this key" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))}>
                            <X className="size-4" />
                          </Button>
                        )}
                      </div>
                      {(err(`field-${r.id}`) || err(`key-${r.id}`)) && <p className="text-xs text-destructive" role="alert">{err(`field-${r.id}`) ?? err(`key-${r.id}`)}</p>}
                      {r.mode === 'header' &&
                        (r.showPrefix ? (
                          <div className="flex items-center gap-2">
                            <label htmlFor={`key-prefix-${r.id}`} className="text-xs text-muted-foreground">
                              Text before the key
                            </label>
                            <Input id={`key-prefix-${r.id}`} value={r.prefix} onChange={(e) => patchRow(r.id, { prefix: e.target.value })} placeholder="Token " className="h-8 w-32 font-mono" />
                          </div>
                        ) : (
                          <button type="button" onClick={() => patchRow(r.id, { showPrefix: true })} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                            Add text before the key (e.g. “Token ”)
                          </button>
                        ))}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setRows((p) => [...p, { id: newId('key'), mode: 'header', fieldName: '', prefix: '', value: '', replacing: true }])}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <Plus className="size-3.5" /> Another key
                  </button>
                </div>
              )}

              {authMethod === 'client_credentials' && (
                <div className="space-y-4">
                  <Field label="Token address" htmlFor="cc-url" error={err('tokenUrl')}>
                    <Input id="cc-url" value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} onBlur={() => t.touch('tokenUrl')} placeholder="https://auth.example.com/oauth/token" className="font-mono" />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Client ID" htmlFor="cc-id" error={err('clientId')}>
                      <Input id="cc-id" value={clientId} onChange={(e) => setClientId(e.target.value)} onBlur={() => t.touch('clientId')} className="font-mono" />
                    </Field>
                    <Field label="Client secret" htmlFor="cc-secret" error={err('secret')}>
                      <div onBlur={() => t.touch('secret')}>
                        <SecretInput
                          id="cc-secret"
                          value={secret}
                          onChange={setSecret}
                          savedHint={savedSecret}
                          replacing={replacingSecret || (editing && authChanged)}
                          onReplace={() => setReplacingSecret(true)}
                          onKeep={editing && authChanged ? undefined : () => (setReplacingSecret(false), setSecret(''))}
                        />
                      </div>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                    <Field label="Scopes (optional)">
                      <TagInput values={scopes} onChange={setScopes} placeholder="Type a scope and press Enter" />
                    </Field>
                    <Field label="Token request">
                      <Select value={tokenContentType} onValueChange={(v) => setTokenContentType(v as 'form' | 'json')}>
                        <SelectTrigger aria-label="Token request format">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="form">Form-encoded</SelectItem>
                          <SelectItem value="json">JSON</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
              )}

              {authMethod === 'none' && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Anyone can call this system without a key, so only use it for public information.</p>}
            </Group>
          </div>


        <div className="flex flex-col items-stretch gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {saveError ? (
              <p className="text-xs text-destructive" role="alert">
                {saveError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t.all && problems.length ? `${problems.length === 1 ? '1 thing' : `${problems.length} things`} to fix: ${problems[0]}` : 'Saved changes reach your agent straight away.'}</p>
            )}
          </div>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="ghost" onClick={requestClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || (editing && !dirty)}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Connect'}
            </Button>
          </div>
        </div>
      </DialogContent>
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
