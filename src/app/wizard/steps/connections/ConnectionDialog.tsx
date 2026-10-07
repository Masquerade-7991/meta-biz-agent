import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { TagInput } from '@/app/components/wizard/TagInput'
import { META_NAME } from '@/app/api/meta'
import { newId } from '@/app/wizard/mockData'
import type { ApiKeyEntry, Connection } from '@/app/wizard/types'
import { Field, FormSection, Segmented, SecretInput } from './parts'
import { KEY_MODES, keyEntry, keyMode, type KeyMode } from './places'

// Create or edit a connection. Keys are typed once and never kept in this browser: Meta holds
// them, and an edit only sends sign-in details when they change (Meta keeps them otherwise).

interface KeyRow {
  id: string
  mode: KeyMode
  fieldName: string
  prefix: string
  value: string
  /** Last characters of the key Meta holds; undefined for a new row. */
  savedHint?: string
  replacing: boolean
}


const CHECKLIST = [
  'To connect our AI agent to your system, please share:',
  '- What the system is for (one sentence)',
  '- Its base web address, starting with https:// (e.g. https://api.example.com/v1)',
  '- How it signs in: an access key (and the header or parameter it goes in), client credentials, or none',
  '- The key or credentials',
  '- The requests the agent should make (method, path and the values each one needs)',
].join('\n')

const toRows = (keys: ApiKeyEntry[] | undefined): KeyRow[] =>
  keys?.length
    ? keys.map((k) => ({ id: k.id, mode: keyMode(k), fieldName: k.fieldName, prefix: k.prefix, value: '', savedHint: k.hint ?? '', replacing: false }))
    : [{ id: newId('key'), mode: 'header', fieldName: '', prefix: '', value: '', replacing: true }]

const shape = (rows: KeyRow[]) => JSON.stringify(rows.map((r) => [r.mode, r.fieldName.trim(), r.prefix]))

export function ConnectionDialog({
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
  const [advanced, setAdvanced] = useState(() => rows.length > 1 || (initial?.tokenContentType ?? 'form') !== 'form')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)

  const patchRow = (id: string, p: Partial<KeyRow>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)))

  // ---- what changed, and what must be sent ----
  const oauthChanged =
    tokenUrl !== (initial?.tokenUrl ?? '') || clientId !== (initial?.clientId ?? '') || JSON.stringify(scopes) !== JSON.stringify(initial?.scopes ?? []) || tokenContentType !== (initial?.tokenContentType ?? 'form') || !!secret
  const keysChanged = shape(rows) !== shape(initialRows) || rows.some((r) => r.value)
  const authChanged = !editing || authMethod !== initial?.authMethod || (authMethod === 'api_key' && keysChanged) || (authMethod === 'client_credentials' && oauthChanged)
  const dirty =
    name !== (initial?.name ?? '') || description !== (initial?.description ?? '') || baseUrl !== (initial?.baseUrl ?? '') || protocol !== (initial?.protocol ?? 'http') || (editing ? authChanged : authMethod !== 'api_key' || keysChanged || oauthChanged)

  // Every reason Save is off, in the order the form reads; the footer shows the first.
  const problems: string[] = []
  const nameError = name && !META_NAME.test(name.trim()) ? 'Use only letters, numbers and underscores, e.g. Shopify_store.' : null
  const urlError = baseUrl && !/^https:\/\/[^\s/]+\.[^\s]+/.test(baseUrl.trim()) ? 'Use a full https:// address, e.g. https://api.example.com/v1' : null
  if (!name.trim()) problems.push('Add a name.')
  else if (nameError) problems.push('The name can only use letters, numbers and underscores.')
  if (!description.trim()) problems.push('Say what the system is for.')
  if (!baseUrl.trim()) problems.push(`Add the ${protocol === 'mcp' ? 'MCP server' : 'web'} address.`)
  else if (urlError) problems.push('The address must start with https://.')
  const keyErrors: Record<string, string> = {}
  if (authMethod === 'api_key') {
    const seen = new Set<string>()
    for (const r of rows) {
      const f = r.mode === 'bearer' ? 'authorization' : r.fieldName.trim().toLowerCase()
      if (r.mode !== 'bearer' && !f) keyErrors[r.id] = `Add the ${r.mode === 'query' ? 'parameter' : 'header'} name.`
      else if (seen.has(`${r.mode === 'query'}:${f}`)) keyErrors[r.id] = 'Two keys use the same name.'
      else if (authChanged && !r.value.trim()) keyErrors[r.id] = editing ? 'Enter this key again: changing sign-in sends every key afresh.' : 'Enter the key.'
      seen.add(`${r.mode === 'query'}:${f}`)
    }
    if (Object.keys(keyErrors).length) problems.push(Object.values(keyErrors)[0])
  }
  if (authMethod === 'client_credentials') {
    if (!/^https:\/\//.test(tokenUrl.trim())) problems.push('Add the token address (https://).')
    if (!clientId.trim()) problems.push('Add the client ID.')
    if (authChanged && !secret.trim()) problems.push(editing ? 'Enter the client secret again to change sign-in.' : 'Add the client secret.')
  }
  const canSave = problems.length === 0 && (!editing || dirty)

  function requestClose() {
    if (dirty && !saving) setConfirmDiscard(true)
    else onClose()
  }

  async function save() {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    const error = await onSave(
      {
        name: name.trim(),
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

  const base = baseUrl.trim().replace(/\/+$/, '')

  return (
    <Dialog open onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-xl">
        <div className="space-y-1 border-b border-border px-6 pt-5 pb-4 pr-12">
          <DialogTitle>{editing ? `Edit ${initial?.name}` : 'Connect a system'}</DialogTitle>
          <DialogDescription className="text-xs">Lets your agent look things up or take actions in another system, like your store or booking tool.</DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-5">
          <FormSection n={1} title="About" help="Your agent reads the description to decide when this system can help.">
            <Field label="Name" htmlFor="conn-name" error={nameError} help="Letters, numbers and underscores, e.g. Shopify_store.">
              <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shopify_store" aria-invalid={!!nameError} autoFocus={!editing} />
            </Field>
            <Field label="What is it for?" htmlFor="conn-description">
              <Textarea id="conn-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Our online store: products, prices, stock and orders." className="resize-none" />
            </Field>
          </FormSection>

          <FormSection n={2} title="Where it lives">
            <Segmented
              label="Connection type"
              value={protocol}
              onChange={setProtocol}
              disabled={editing}
              options={[
                { id: 'http', title: 'API (HTTP)', hint: 'You add each request the agent can make.' },
                { id: 'mcp', title: 'MCP server', hint: 'The server lists its own tools.' },
              ]}
            />
            {editing && (
              <p className="-mt-2 text-muted-foreground text-xs">
                The type can&rsquo;t change after creating. Make a new connection to switch.
              </p>
            )}
            <Field
              label={protocol === 'mcp' ? 'MCP server address' : 'Base web address'}
              htmlFor="conn-url"
              error={urlError}
              help={
                base && !urlError ? (
                  protocol === 'mcp' ? (
                    'Meta asks this server which tools it has.'
                  ) : (
                    <>
                      Tools call <span className="font-mono">{base}/…</span>
                    </>
                  )
                ) : (
                  'The part every request starts with, including any version, e.g. /admin/api/2026-10.'
                )
              }
            >
              <Input id="conn-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={protocol === 'mcp' ? 'https://example.com/mcp' : 'https://api.example.com/v1'} aria-invalid={!!urlError} className="font-mono" inputMode="url" />
            </Field>
          </FormSection>

          <FormSection n={3} title="How it signs in" help={editing ? 'Saved keys stay as they are unless you change sign-in here.' : undefined}>
            <Segmented
              label="Sign-in method"
              columns={3}
              value={authMethod}
              onChange={setAuthMethod}
              options={[
                { id: 'api_key', title: 'Access key', hint: 'A key or token.' },
                { id: 'client_credentials', title: 'Client credentials', hint: 'OAuth: ID + secret.' },
                { id: 'none', title: 'None', hint: 'Public systems only.' },
              ]}
            />

            {authMethod === 'api_key' && (
              <div className="space-y-3">
                {rows.map((r, i) => {
                  const entry = keyEntry(r)
                  const sent = entry.location === 'header' ? `${entry.fieldName || 'Header-Name'}: ${entry.prefix}••••${r.value ? r.value.slice(-4) : (r.savedHint ?? '')}` : `?${entry.fieldName || 'name'}=••••${r.value ? r.value.slice(-4) : (r.savedHint ?? '')}`
                  return (
                    <div key={r.id} className="space-y-3 rounded-lg border border-border p-3">
                      {rows.length > 1 && (
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold">Key {i + 1}</p>
                          <button type="button" onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))} className="flex items-center gap-1 text-muted-foreground hover:text-destructive text-xs">
                            <Trash2 className="size-3.5" /> Remove
                          </button>
                        </div>
                      )}
                      <Field label="Send it as">
                        <Segmented label="Where the key goes" columns={3} value={r.mode} onChange={(mode) => patchRow(r.id, { mode })} options={KEY_MODES} />
                      </Field>
                      {r.mode !== 'bearer' && (
                        <Field label={r.mode === 'query' ? 'Parameter name' : 'Header name'} htmlFor={`key-field-${r.id}`} error={keyErrors[r.id] && !keyErrors[r.id].startsWith('Enter') ? keyErrors[r.id] : null} help={r.mode === 'header' ? 'Exactly as the system’s docs say, e.g. X-Shopify-Access-Token.' : 'e.g. api_key'}>
                          <Input id={`key-field-${r.id}`} value={r.fieldName} onChange={(e) => patchRow(r.id, { fieldName: e.target.value })} placeholder={r.mode === 'query' ? 'api_key' : 'X-API-Key'} className="font-mono" />
                        </Field>
                      )}
                      <Field label="Key" htmlFor={`key-value-${r.id}`}>
                        <SecretInput
                          id={`key-value-${r.id}`}
                          value={r.value}
                          onChange={(value) => patchRow(r.id, { value })}
                          savedHint={r.savedHint}
                          replacing={r.replacing || (authChanged && editing)}
                          onReplace={() => patchRow(r.id, { replacing: true })}
                          onKeep={authChanged && editing ? undefined : () => patchRow(r.id, { replacing: false, value: '' })}
                          placeholder={r.savedHint ? `Saved key ends in ${r.savedHint}` : 'Paste the key'}
                        />
                      </Field>
                      {advanced && r.mode === 'header' && (
                        <Field label="Prefix (optional)" htmlFor={`key-prefix-${r.id}`} help="Text sent before the key, e.g. “Token ”.">
                          <Input id={`key-prefix-${r.id}`} value={r.prefix} onChange={(e) => patchRow(r.id, { prefix: e.target.value })} className="font-mono" />
                        </Field>
                      )}
                      <p className="font-mono break-all text-muted-foreground text-xs">
                        Sends {sent}
                      </p>
                    </div>
                  )
                })}
                {advanced && (
                  <Button size="sm" variant="outline" onClick={() => setRows((p) => [...p, { id: newId('key'), mode: 'header', fieldName: '', prefix: '', value: '', replacing: true }])}>
                    <Plus className="size-3.5" /> Add another key
                  </Button>
                )}
              </div>
            )}

            {authMethod === 'client_credentials' && (
              <div className="space-y-4 rounded-lg border border-border p-3">
                <Field label="Token address" htmlFor="cc-url" help="Where Meta asks for an access token.">
                  <Input id="cc-url" value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} placeholder="https://auth.example.com/oauth/token" className="font-mono" />
                </Field>
                <Field label="Client ID" htmlFor="cc-id">
                  <Input id="cc-id" value={clientId} onChange={(e) => setClientId(e.target.value)} className="font-mono" />
                </Field>
                <Field label="Client secret" htmlFor="cc-secret" help={editing && authChanged && !secret ? 'Enter the secret again to change sign-in.' : undefined}>
                  <SecretInput
                    id="cc-secret"
                    value={secret}
                    onChange={setSecret}
                    savedHint={savedSecret}
                    replacing={replacingSecret || (editing && authChanged)}
                    onReplace={() => setReplacingSecret(true)}
                    onKeep={editing && authChanged ? undefined : () => (setReplacingSecret(false), setSecret(''))}
                  />
                </Field>
                <Field label="Scopes (optional)">
                  <TagInput values={scopes} onChange={setScopes} placeholder="Type a scope and press Enter" />
                </Field>
                {advanced && (
                  <Field label="Token request format" help="Most systems use form-encoded.">
                    <Segmented label="Token request format" value={tokenContentType} onChange={setTokenContentType} options={[{ id: 'form', title: 'Form-encoded' }, { id: 'json', title: 'JSON' }]} />
                  </Field>
                )}
              </div>
            )}

            {authMethod === 'none' && (
              <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs">
                Anyone can call this system without a key, so only use it for public information.
              </p>
            )}

            {authMethod !== 'none' && (
              <button type="button" onClick={() => setAdvanced((a) => !a)} className="text-primary hover:underline text-xs" aria-expanded={advanced}>
                {advanced ? 'Hide advanced options' : 'Advanced options'}
              </button>
            )}
          </FormSection>
        </div>

        <div className="space-y-3 border-t border-border px-6 py-4">
          {saveError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs" role="alert">
              {saveError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-muted-foreground text-xs">
                {!canSave && problems[0] ? problems[0] : 'Saved changes apply to your agent straight away.'}
              </p>
              <button type="button" onClick={copyChecklist} className="text-primary hover:underline text-xs">
                {copied === 'yes' ? 'Checklist copied' : copied === 'no' ? 'Couldn’t copy. Your browser blocked it.' : 'Copy a checklist for your developer'}
              </button>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={requestClose}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={!canSave || saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                {editing ? 'Save changes' : 'Create connection'}
              </Button>
            </div>
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
