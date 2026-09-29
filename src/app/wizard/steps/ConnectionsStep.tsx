import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  ChevronRight,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plug,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { SelectableCard } from '@/app/components/wizard/SelectableCard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { IntegrationsTab } from './IntegrationsTab'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import { TagInput } from '@/app/components/wizard/TagInput'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import {
  CONNECTION_STATUS_META,
  SAMPLE_CONNECTIONS,
  newApiKeyEntry,
  newId,
  type RecipeAction,
} from '@/app/wizard/mockData'
import type {
  ActionMethod,
  ActionValue,
  ApiKeyLocation,
  Connection,
  ConnectionAction,
  ConnectionStatus,
  ValueLocation,
  ValueType,
} from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import {
  connectorLogs,
  type ConnectorLogs,
  deleteConnector,
  deleteTool,
  errorText,
  listTools,
  refreshMcpTools,
  runTool,
  saveConnector,
  saveTool,
  toolToAction,
  upsertCredentials,
} from '@/app/api/meta'

const METHOD_OPTIONS: ActionMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const TYPE_OPTIONS: { id: ValueType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'integer', label: 'Whole number' },
  { id: 'boolean', label: 'Yes/no' },
]
const ACTION_COUNT_WARNING_THRESHOLD = 6

// ---- Pure helpers ----

function domainFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

function extractPathPlaceholders(path: string): string[] {
  const matches = Array.from(path.matchAll(/\{([a-zA-Z0-9_]+)\}/g))
  return matches.map((m) => m[1])
}

/** Keeps the value list's path-sourced rows in sync with whatever {placeholders} are typed in
 *  the path field. Non-path rows (query/header/body) are left exactly as they are. */
function syncPathValues(path: string, values: ActionValue[]): ActionValue[] {
  const placeholders = extractPathPlaceholders(path)
  const others = values.filter((v) => v.location !== 'path')
  const pathValues = placeholders.map((name) => {
    const existing = values.find((v) => v.location === 'path' && v.name === name)
    return existing ?? newValue(name, 'path')
  })
  return [...pathValues, ...others]
}

function newValue(name: string, location: ValueLocation): ActionValue {
  return {
    id: newId('value'),
    name,
    type: 'text',
    required: location === 'path',
    location,
    source: 'conversation',
    description: '',
  }
}

function normalizeForCompareLoose(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function findSimilarActionName(name: string, actions: ConnectionAction[], connectionId: string, excludeId?: string): ConnectionAction | undefined {
  const norm = normalizeForCompareLoose(name)
  if (!norm) return undefined
  return actions.find((a) => a.connectionId === connectionId && a.id !== excludeId && normalizeForCompareLoose(a.name) === norm)
}

function formatActivityTime(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const isToday = date.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()
  if (isToday) return `Today ${time}`
  if (isYesterday) return `Yesterday ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

// ---- Multi-key API auth (draft rows for the custom connection form) ----

/** A row's secret is never re-populated from the stored connection — `touched` tracks whether
 *  the user has typed a new value for THIS row, same discipline as the single-key SecretField. */
interface ApiKeyDraftRow {
  id: string
  touched: boolean
  value: string
  location: ApiKeyLocation
  fieldName: string
  prefix: string
}

function newDraftApiKeyRow(): ApiKeyDraftRow {
  return { id: newId('key'), touched: true, value: '', location: 'header', fieldName: '', prefix: '' }
}

function draftApiKeyRows(initial?: Connection): ApiKeyDraftRow[] {
  if (initial?.apiKeys && initial.apiKeys.length > 0) {
    return initial.apiKeys.map((k) => ({ id: k.id, touched: false, value: '', location: k.location, fieldName: k.fieldName, prefix: k.prefix }))
  }
  return [newDraftApiKeyRow()]
}

/** Resolves each row to its saved value: the freshly typed one if touched, otherwise the
 *  original stored secret looked up by row id — never the value that ever passed through state. */
function resolveApiKeyRows(rows: ApiKeyDraftRow[], initial?: Connection) {
  return rows.map((row) => {
    const original = initial?.apiKeys?.find((k) => k.id === row.id)
    return {
      id: row.id,
      value: row.touched ? row.value : (original?.value ?? ''),
      location: row.location,
      fieldName: row.fieldName,
      prefix: row.prefix,
    }
  })
}

function buildDeveloperChecklist(): string {
  return [
    'To connect our agent to your system, please share:',
    '- System name and what it is for',
    '- Base web address (e.g. https://api.example.com)',
    '- Authentication method (access key, client credentials, or none)',
    '- The key or credentials',
    '- Which actions you want the agent to be able to do (e.g. look up an order by number)',
  ].join('\n')
}

// ---- Status dot ----

function StatusDot({ status }: { status: ConnectionStatus }) {
  const meta = CONNECTION_STATUS_META[status]
  return (
    <span className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-xs)' }}>
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          meta.dot === 'success' && 'bg-success',
          meta.dot === 'warning' && 'bg-warning',
          meta.dot === 'muted' && 'bg-muted-foreground/50',
        )}
      />
      {meta.label}
    </span>
  )
}

// ==================================================================================
// MAIN STEP
// ==================================================================================

const CONNECTIONS_FOOTER_NOTE =
  'Your agent automatically tells customers what it can and cannot do, based on everything connected here. You can tell it when to prefer a specific action in step 1’s custom skills, for example "Always look up the real order status rather than guessing."'

export function ConnectionsStep() {
  return (
    <Tabs defaultValue="integrations">
      <TabsList>
        <TabsTrigger value="integrations">Native</TabsTrigger>
        <TabsTrigger value="connections">Custom</TabsTrigger>
      </TabsList>

      <TabsContent value="integrations" forceMount className="mt-4 data-[state=inactive]:hidden">
        <IntegrationsTab />
      </TabsContent>
      <TabsContent value="connections" forceMount className="mt-4 data-[state=inactive]:hidden">
        <ConnectionsTabContent />
      </TabsContent>

      <div className="mt-4 flex items-center gap-1.5">
        <InfoTooltip text={CONNECTIONS_FOOTER_NOTE} />
        <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          What your agent can do
        </span>
      </div>
    </Tabs>
  )
}

function ConnectionsTabContent() {
  const { state, patch } = useWizard()
  const { connections, actions, activity } = state.connections

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [connectionForm, setConnectionForm] = useState<{ mode: 'add' } | { mode: 'edit'; connection: Connection } | null>(null)
  const [actionEditor, setActionEditor] = useState<ActionEditorState>(null)
  const [testingAction, setTestingAction] = useState<ConnectionAction | null>(null)
  const [activityFor, setActivityFor] = useState<Connection | null>(null)
  const [pendingDeleteConnectionId, setPendingDeleteConnectionId] = useState<string | null>(null)
  const [pendingDeleteAction, setPendingDeleteAction] = useState<ConnectionAction | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})

  function consumeForcedFailure(): boolean {
    if (!state.demo.forceNextFailure) return false
    patch('demo', { forceNextFailure: false })
    return true
  }

  function loadSampleConnections() {
    const now = Date.now()
    const newConnections: Connection[] = []
    const newActions: ConnectionAction[] = []
    const newActivity = state.connections.activity.slice()

    SAMPLE_CONNECTIONS.forEach((seed) => {
      const connectionId = newId('conn')
      newConnections.push({
        id: connectionId,
        name: seed.name,
        description: seed.description,
        baseUrl: seed.baseUrl,
        authMethod: 'api_key',
        apiKeys: [{ id: newId('key'), value: 'sample-key-value', location: 'header', fieldName: 'X-API-Key', prefix: '' }],
        createdAt: now,
        demoStatus: seed.demoStatus,
      })
      seed.actions.forEach((recipeAction, i) => {
        const actionId = newId('action')
        newActions.push(recipeActionToAction(recipeAction, connectionId, actionId, now - i))
        if (seed.withActivity) {
          newActivity.unshift({
            id: newId('activity'),
            connectionId,
            actionId,
            actionName: recipeAction.name,
            timestamp: now - i * 240_000,
            outcome: 'worked',
          })
        }
      })
      if (seed.demoStatus === 'having_problems' && seed.withActivity) {
        newActivity.unshift({
          id: newId('activity'),
          connectionId,
          actionId: newActions[0]?.id ?? '',
          actionName: newActions[0]?.name ?? '',
          timestamp: now,
          outcome: 'failed',
          errorText: '503 Service Unavailable',
        })
      }
    })

    patch('connections', {
      connections: newConnections,
      actions: newActions,
      activity: newActivity,
    })
  }


  function actionsFor(connectionId: string) {
    return actions.filter((a) => a.connectionId === connectionId)
  }

  /** Create or update on Meta first; the card only appears / changes once Meta accepts it. */
  async function saveCustomConnection(connection: Omit<Connection, 'id' | 'createdAt' | 'demoStatus'>): Promise<string | null> {
    const existing = connectionForm?.mode === 'edit' ? connectionForm.connection : undefined
    const draft: Connection = existing
      ? { ...existing, ...connection, protocol: existing.protocol ?? connection.protocol }
      : { ...connection, id: newId('conn'), createdAt: Date.now(), demoStatus: 'not_tested' }
    try {
      if (consumeForcedFailure()) throw new Error('Could not save this connection.')
      Object.assign(draft, await saveConnector(draft))
    } catch (err) {
      return errorText(err)
    }
    patch('connections', (prev) => ({
      connections: existing ? prev.connections.map((c) => (c.id === draft.id ? draft : c)) : [...prev.connections, draft],
    }))
    setConnectionForm(null)
    if (!existing) {
      setExpandedId(draft.id)
      if (draft.protocol === 'mcp') void refreshTools(draft)
    }
    return null
  }

  /** MCP only: Meta re-discovers the server's tools; we then list them as Test-only actions. */
  async function refreshTools(connection: Connection) {
    if (!connection.metaId) return
    patch('connections', (prev) => ({
      connections: prev.connections.map((c) => (c.id === connection.id ? { ...c, mcpSync: { status: 'PENDING', toolCount: c.mcpSync?.toolCount ?? 0 } } : c)),
    }))
    try {
      const fields = await refreshMcpTools(connection.metaId)
      const tools = await listTools(connection.metaId)
      patch('connections', (prev) => ({
        connections: prev.connections.map((c) => (c.id === connection.id ? { ...c, ...fields } : c)),
        actions: [...prev.actions.filter((a) => a.connectionId !== connection.id), ...tools.map((t) => toolToAction(t, connection.id, true))],
      }))
    } catch (err) {
      patch('connections', (prev) => ({
        connections: prev.connections.map((c) => (c.id === connection.id ? { ...c, mcpSync: { status: 'ERROR', toolCount: c.mcpSync?.toolCount ?? 0 } } : c)),
      }))
      setRowError((prev) => ({ ...prev, [connection.id]: `Could not refresh tools. ${errorText(err)}` }))
    }
  }

  function updateConnectionDemoStatus(id: string, demoStatus: ConnectionStatus) {
    patch('connections', { connections: connections.map((c) => (c.id === id ? { ...c, demoStatus } : c)) })
  }

  /** Pushes a connection's new credential to Meta (upsertApiKey / upsertOAuth) and takes Meta's
   *  resulting status. Shared by Connect (first credential) and Rotate key. */
  async function pushCredential(id: string, value: string) {
    const c = connections.find((x) => x.id === id)
    if (!c) return
    const keys = c.apiKeys && c.apiKeys.length > 0 ? c.apiKeys : [newApiKeyEntry()]
    const updated: Connection =
      c.authMethod === 'client_credentials'
        ? { ...c, clientSecret: value }
        : { ...c, apiKeys: [{ ...keys[0], value, fieldName: keys[0].fieldName || 'X-API-KEY' }, ...keys.slice(1)] }
    try {
      if (consumeForcedFailure()) throw new Error('The new credential was not accepted.')
      const fields = c.metaId ? await upsertCredentials(updated) : await saveConnector(updated)
      patch('connections', (prev) => ({ connections: prev.connections.map((x) => (x.id === id ? { ...updated, ...fields } : x)) }))
      setRowError((prev) => ({ ...prev, [id]: '' }))
    } catch (err) {
      setRowError((prev) => ({ ...prev, [id]: `Could not update the credential. ${errorText(err)}` }))
    }
  }

  useRegisterDevControls(
    'connections',
    <DemoControlsGroup label="Connections">
      <Button variant="outline" size="sm" onClick={loadSampleConnections}>
        Load sample connections
      </Button>
      <Button variant="outline" size="sm" onClick={() => patch('demo', { forceNextFailure: !state.demo.forceNextFailure })}>
        {state.demo.forceNextFailure ? 'Force action failure (armed)' : 'Force action failure'}
      </Button>
      {connections.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-semi-bold)' }}>
            Connection status
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {connections.map((connection) => (
              <label key={connection.id} className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-xs)' }}>
                {connection.name}
                <select
                  value={connection.demoStatus}
                  onChange={(e) => updateConnectionDemoStatus(connection.id, e.target.value as ConnectionStatus)}
                  className="rounded border border-warning bg-warning/10 text-warning-foreground"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  {Object.entries(CONNECTION_STATUS_META).map(([id, meta]) => (
                    <option key={id} value={id}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
    </DemoControlsGroup>,
  )

  async function confirmDeleteConnection() {
    if (!pendingDeleteConnectionId) return
    const id = pendingDeleteConnectionId
    const shouldFail = consumeForcedFailure()
    const metaId = connections.find((c) => c.id === id)?.metaId
    try {
      if (shouldFail) throw new Error('forced')
      // Meta removes the connector's tools with it (PRD V-a4).
      if (metaId) await deleteConnector(metaId)
    } catch (err) {
      setRowError((prev) => ({ ...prev, [id]: shouldFail ? 'Could not delete. The item is still here.' : `Could not delete. The item is still here. (${errorText(err)})` }))
      setPendingDeleteConnectionId(null)
      return
    }
    patch('connections', (prev) => ({
      connections: prev.connections.filter((c) => c.id !== id),
      actions: prev.actions.filter((a) => a.connectionId !== id),
    }))
    setPendingDeleteConnectionId(null)
  }

  async function confirmDeleteAction() {
    if (!pendingDeleteAction) return
    const action = pendingDeleteAction
    const shouldFail = consumeForcedFailure()
    const connMetaId = connections.find((c) => c.id === action.connectionId)?.metaId
    try {
      if (shouldFail) throw new Error('forced')
      if (connMetaId && action.metaId) await deleteTool(connMetaId, action.metaId)
    } catch (err) {
      setRowError((prev) => ({ ...prev, [action.id]: shouldFail ? 'Could not delete. The item is still here.' : `Could not delete. The item is still here. (${errorText(err)})` }))
      setPendingDeleteAction(null)
      return
    }
    patch('connections', (prev) => ({ actions: prev.actions.filter((a) => a.id !== action.id) }))
    setPendingDeleteAction(null)
  }

  async function saveAction(editorState: NonNullable<ActionEditorState>): Promise<string | null> {
    const connection = connections.find((c) => c.id === editorState.connectionId)
    if (!connection?.metaId) return 'Save this connection to Meta first (edit and save it), then add actions.'
    const isEdit = editorState.mode === 'edit' && !!editorState.actionId
    const existing = isEdit ? actions.find((a) => a.id === editorState.actionId) : undefined
    const action: ConnectionAction = {
      ...(existing ?? { id: newId('action'), connectionId: editorState.connectionId, createdAt: Date.now() }),
      name: editorState.name,
      description: editorState.description,
      method: editorState.method,
      path: editorState.path,
      values: editorState.values,
    }
    try {
      if (consumeForcedFailure()) throw new Error('Could not save this action.')
      action.metaId = await saveTool(connection.metaId, action)
    } catch (err) {
      return errorText(err)
    }
    patch('connections', (prev) => ({
      actions: isEdit ? prev.actions.map((a) => (a.id === action.id ? action : a)) : [...prev.actions, action],
    }))
    return null
  }

  /** Runs the tool live on Meta with the connector's stored credentials (PRD AC-c14). */
  async function runActionTest(action: ConnectionAction, inputs: Record<string, string>): Promise<{ kind: 'success' | 'failure' | 'no_answer'; body: string }> {
    const connMetaId = connections.find((c) => c.id === action.connectionId)?.metaId
    const log = (outcome: 'worked' | 'failed', errorText?: string) =>
      patch('connections', (prev) => ({
        activity: [
          { id: newId('activity'), connectionId: action.connectionId, actionId: action.id, actionName: action.name, timestamp: Date.now(), outcome, errorText },
          ...prev.activity,
        ],
      }))
    if (consumeForcedFailure() || !connMetaId || !action.metaId) {
      log('failed', 'No response from the system.')
      return { kind: 'no_answer', body: '' }
    }
    const input = Object.fromEntries(action.values.filter((v) => inputs[v.id] !== undefined).map((v) => [v.name, inputs[v.id]]))
    try {
      const r = await runTool(connMetaId, action.metaId, input)
      let body = r.output
      try {
        body = JSON.stringify(JSON.parse(r.output), null, 2)
      } catch {
        // not JSON: show as returned
      }
      log(r.status === 'success' ? 'worked' : 'failed', r.status === 'success' ? undefined : body)
      return { kind: r.status === 'success' ? 'success' : 'failure', body }
    } catch (err) {
      log('failed', errorText(err))
      return { kind: 'failure', body: errorText(err) }
    }
  }

  return (
    <div className="space-y-6">
      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <span className="flex items-center gap-1.5">
            <h3>Connect your agent to your systems</h3>
            <InfoTooltip text="This lets the agent look things up and take actions for customers, instead of only answering from its knowledge. It needs technical details like web addresses and access keys, so you may want to do this part with your developer." />
          </span>
          <Button onClick={() => setConnectionForm({ mode: 'add' })}>Build your own connection</Button>
          <button type="button" className="text-primary" style={{ fontSize: 'var(--text-sm)' }} disabled>
            Skip this step
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <Button size="sm" onClick={() => setConnectionForm({ mode: 'add' })}>
            Build your own connection
          </Button>

          <div className="space-y-3">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                actions={actionsFor(connection.id)}
                expanded={expandedId === connection.id}
                onToggleExpand={() => setExpandedId(expandedId === connection.id ? null : connection.id)}
                onAddAction={() => setActionEditor({ mode: 'add', connectionId: connection.id, name: '', description: '', method: 'GET', path: '', values: [] })}
                onEditAction={(action) =>
                  setActionEditor({ mode: 'edit', connectionId: connection.id, actionId: action.id, name: action.name, description: action.description, method: action.method, path: action.path, values: action.values })
                }
                onTestAction={setTestingAction}
                onDeleteAction={setPendingDeleteAction}
                onOpenActivity={() => setActivityFor(connection)}
                onEditConnection={() => setConnectionForm({ mode: 'edit', connection })}
                onDeleteConnection={() => setPendingDeleteConnectionId(connection.id)}
                onReplaceKey={(key) => void pushCredential(connection.id, key)}
                onConnect={(value) => void pushCredential(connection.id, value)}
                onRefreshTools={() => void refreshTools(connection)}
                rowError={rowError}
                onClearRowError={(id) => setRowError((prev) => ({ ...prev, [id]: '' }))}
              />
            ))}
          </div>
        </div>
      )}

      {connectionForm && (
        <CustomConnectionDialog
          initial={connectionForm.mode === 'edit' ? connectionForm.connection : undefined}
          onSave={saveCustomConnection}
          onClose={() => setConnectionForm(null)}
        />
      )}

      {actionEditor && (
        <ActionEditorDialog
          editor={actionEditor}
          existingActionsOnConnection={actionsFor(actionEditor.connectionId)}
          onChange={setActionEditor}
          onSave={saveAction}
          onClose={() => setActionEditor(null)}
        />
      )}

      {testingAction && <ActionTestDialog action={testingAction} onRun={runActionTest} onClose={() => setTestingAction(null)} />}

      {activityFor && (
        <ActivityDialog connection={activityFor} rows={activity.filter((a) => a.connectionId === activityFor.id)} onClose={() => setActivityFor(null)} />
      )}

      <ConfirmDialog
        open={pendingDeleteConnectionId !== null}
        title="Delete this connection?"
        description={`Do you want to delete ${connections.find((c) => c.id === pendingDeleteConnectionId)?.name ?? 'this connection'}? It will also remove the associated tools as well. The agent will stop using this immediately.`}
        onConfirm={confirmDeleteConnection}
        onCancel={() => setPendingDeleteConnectionId(null)}
      />

      <ConfirmDialog
        open={pendingDeleteAction !== null}
        title="Delete this tool?"
        description="The agent will stop using this immediately."
        onConfirm={confirmDeleteAction}
        onCancel={() => setPendingDeleteAction(null)}
      />
    </div>
  )
}

function recipeActionToAction(recipeAction: RecipeAction, connectionId: string, id: string, createdAt: number): ConnectionAction {
  return {
    id,
    connectionId,
    name: recipeAction.name,
    description: recipeAction.description,
    method: recipeAction.method,
    path: recipeAction.path,
    values: recipeAction.values.map((v) => ({ ...v, id: newId('value'), required: v.location === 'path' })),
    createdAt,
  }
}

// ==================================================================================
// CONNECTION CARD
// ==================================================================================

function ConnectionCard({
  connection,
  actions,
  expanded,
  onToggleExpand,
  onAddAction,
  onEditAction,
  onTestAction,
  onDeleteAction,
  onOpenActivity,
  onEditConnection,
  onDeleteConnection,
  onReplaceKey,
  onConnect,
  onRefreshTools,
  rowError,
  onClearRowError,
}: {
  connection: Connection
  actions: ConnectionAction[]
  expanded: boolean
  onToggleExpand: () => void
  onAddAction: () => void
  onEditAction: (action: ConnectionAction) => void
  onTestAction: (action: ConnectionAction) => void
  onDeleteAction: (action: ConnectionAction) => void
  onOpenActivity: () => void
  onEditConnection: () => void
  onDeleteConnection: () => void
  onReplaceKey: (key: string) => void
  onConnect: (value: string) => void
  onRefreshTools: () => void
  rowError: Record<string, string>
  onClearRowError: (id: string) => void
}) {
  const [replaceKeyOpen, setReplaceKeyOpen] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectValue, setConnectValue] = useState('')
  const isMcp = connection.protocol === 'mcp'
  // PRD AC-c14a: tools run only while the connector itself is Active.
  const canTest = connection.demoStatus === 'working' && !!connection.metaId
  const testBlockedReason = !connection.metaId
    ? 'Save this connection to Meta first.'
    : 'Tools can only run while this connection is Active.'

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div role="button" tabIndex={0} onClick={onToggleExpand} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleExpand() }} className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left">
          <Plug className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{connection.name}</p>
              <StatusDot status={connection.demoStatus} />
              {isMcp && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  MCP ·{' '}
                  {connection.mcpSync?.status === 'READY'
                    ? `Ready (${connection.mcpSync.toolCount} tools)`
                    : connection.mcpSync?.status === 'ERROR'
                      ? 'Error'
                      : 'Pending'}
                </span>
              )}
              {!connection.metaId && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Not saved to Meta
                </span>
              )}
            </div>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              {domainFromUrl(connection.baseUrl)}
            </p>
            {actions.length > 0 && (
              <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                {actions.length} action{actions.length === 1 ? '' : 's'}: {actions.map((a) => a.name).join(', ')}
              </p>
            )}
            {connection.demoStatus === 'waiting_signin' && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  This connection is defined but not connected yet.
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConnectOpen(true)
                  }}
                  className="text-primary"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  Connect
                </button>
              </div>
            )}
            {connection.demoStatus === 'key_rejected' && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  The access key for this connection is not being accepted.
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setReplaceKeyOpen(true)
                  }}
                  className="text-primary"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  Replace key
                </button>
              </div>
            )}
            {connection.demoStatus === 'having_problems' && (
              <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Recent calls to this connection have been failing. Check the activity log for
                details.
              </p>
            )}
            {connection.demoStatus === 'not_tested' && (
              <p className="mt-1 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                Test one of its actions to check it works.
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isMcp ? (
            <Button size="sm" variant="outline" onClick={onRefreshTools}>
              Refresh tools
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onAddAction}>
              Add tool
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onOpenActivity}>
            Activity
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditConnection}>Edit connection</DropdownMenuItem>
              {connection.authMethod === 'none' ? null : connection.demoStatus === 'waiting_signin' ? (
                <DropdownMenuItem onClick={() => setConnectOpen(true)}>Connect</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setReplaceKeyOpen(true)}>Rotate key</DropdownMenuItem>
              )}
              {isMcp ? (
                <DropdownMenuItem onClick={onRefreshTools}>Refresh tools</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onAddAction}>Add tool</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onOpenActivity}>Activity logs</DropdownMenuItem>
              <DropdownMenuItem onClick={onDeleteConnection} className="text-destructive">
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" onClick={onToggleExpand} aria-label="Expand">
            <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
          </button>
        </div>
      </div>

      {rowError[connection.id] && (
        <div className="px-4 pb-2">
          <InlineError message={rowError[connection.id]} onRetry={() => onClearRowError(connection.id)} />
        </div>
      )}

      {expanded && (
        <div className="space-y-1 border-t border-border p-3">
          {actions.length === 0 && (
            <p className="px-1 py-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              No actions yet.
            </p>
          )}
          {actions.map((action) => (
            <div key={action.id}>
              <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-accent/40">
                <div className="min-w-0">
                  <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>{action.name}</p>
                  <p className="truncate text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    {action.method} {action.path}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span title={canTest ? undefined : testBlockedReason}>
                    <Button size="sm" variant="ghost" onClick={() => onTestAction(action)} disabled={!canTest || !action.metaId}>
                      Test
                    </Button>
                  </span>
                  {/* MCP tools live on the MCP server: Test only (PRD AC-c13a). */}
                  {!action.fromMcp && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => onEditAction(action)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDeleteAction(action)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {rowError[action.id] && (
                <div className="px-2 pb-1">
                  <InlineError message={rowError[action.id]} onRetry={() => onClearRowError(action.id)} />
                </div>
              )}
            </div>
          ))}
          {actions.length > ACTION_COUNT_WARNING_THRESHOLD && (
            <p className="flex items-center gap-1.5 px-2 pt-1 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              <AlertTriangle className="size-3.5 shrink-0" />
              Many similar actions can make the agent pick the wrong one. Fewer, clearly described
              actions work better.
            </p>
          )}
        </div>
      )}

      <CredentialPromptDialog
        open={replaceKeyOpen}
        title={connection.authMethod === 'client_credentials' ? 'Rotate the client secret?' : 'Rotate the access key?'}
        description="The old key stops working as soon as you save the new one."
        label={connection.authMethod === 'client_credentials' ? 'New client secret' : 'New access key'}
        confirmLabel="Save"
        value={newKey}
        onChange={setNewKey}
        onConfirm={() => {
          onReplaceKey(newKey)
          setNewKey('')
          setReplaceKeyOpen(false)
        }}
        onCancel={() => {
          setNewKey('')
          setReplaceKeyOpen(false)
        }}
      />

      <CredentialPromptDialog
        open={connectOpen}
        title={`Connect ${connection.name}?`}
        description="Provide the credential your system issued so the agent can start using this connection."
        label={connection.authMethod === 'client_credentials' ? 'Client secret' : 'Access key'}
        confirmLabel="Connect"
        value={connectValue}
        onChange={setConnectValue}
        onConfirm={() => {
          onConnect(connectValue)
          setConnectValue('')
          setConnectOpen(false)
        }}
        onCancel={() => {
          setConnectValue('')
          setConnectOpen(false)
        }}
      />
    </div>
  )
}

function CredentialPromptDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  label: string
  confirmLabel: string
  value: string
  onChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="credential-prompt-value">{label}</Label>
          <Input id="credential-prompt-value" type="password" autoFocus value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================================================================================
// CUSTOM CONNECTION FORM
// ==================================================================================

function CustomConnectionDialog({
  initial,
  onSave,
  onClose,
}: {
  /** When set, the form edits this existing connection instead of creating a new one — the
   *  same editor the spec requires for recipe-created connections too. */
  initial?: Connection
  /** Resolves to an error message, or null once Meta has accepted it. */
  onSave: (connection: Omit<Connection, 'id' | 'createdAt' | 'demoStatus'>) => Promise<string | null>
  onClose: () => void
}) {
  const [protocol, setProtocol] = useState<'http' | 'mcp'>(initial?.protocol ?? 'http')
  const [tokenContentType, setTokenContentType] = useState<'form' | 'json'>(initial?.tokenContentType ?? 'form')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [authMethod, setAuthMethod] = useState<'api_key' | 'client_credentials' | 'none'>(initial?.authMethod ?? 'api_key')
  // Secrets are never re-populated into an editable field — only shown as dots with a Replace
  // action, per the spec's "entered once, never shown again" rule. Each row tracks its own
  // touched state since a connection can now have more than one key.
  const [apiKeyRows, setApiKeyRows] = useState<ApiKeyDraftRow[]>(() => draftApiKeyRows(initial))
  const [tokenUrl, setTokenUrl] = useState(initial?.tokenUrl ?? '')
  const [clientId, setClientId] = useState(initial?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [clientSecretTouched, setClientSecretTouched] = useState(!initial?.clientSecret)
  const [scopes, setScopes] = useState<string[]>(initial?.scopes ?? [])
  const [copied, setCopied] = useState(false)

  const urlValid = /^https:\/\//.test(baseUrl.trim())
  const canSave = name.trim().length > 0 && description.trim().length > 0 && urlValid

  function copyChecklist() {
    navigator.clipboard?.writeText(buildDeveloperChecklist()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    const error = await onSave({
      name: name.trim(),
      description: description.trim(),
      baseUrl: baseUrl.trim(),
      protocol,
      authMethod,
      ...(authMethod === 'api_key' ? { apiKeys: resolveApiKeyRows(apiKeyRows, initial) } : {}),
      ...(authMethod === 'client_credentials'
        ? { tokenUrl, clientId, clientSecret: clientSecretTouched ? clientSecret : initial?.clientSecret, scopes, tokenContentType }
        : {}),
    })
    setSaving(false)
    setSaveError(error)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit connection' : 'Build your own connection'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex items-start justify-between gap-3 rounded-lg bg-muted p-3">
            <p style={{ fontSize: 'var(--text-sm)' }}>
              This part needs technical details. If that is not you, you can copy a checklist to
              send to your developer.
            </p>
            <button type="button" onClick={copyChecklist} className="shrink-0 text-primary" style={{ fontSize: 'var(--text-xs)' }}>
              {copied ? 'Copied' : 'Copy checklist for my developer'}
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-semi-bold)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Basics
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="conn-name">Name</Label>
              <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Our store system" />
            </div>

            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Label htmlFor="conn-description">Description</Label>
                <InfoTooltip text="The agent reads this to understand what this system is for." />
              </span>
              <Input id="conn-description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Label>Connection type</Label>
                <InfoTooltip text="Standard API: you add each tool yourself. MCP server: tools are discovered from the server with Refresh tools. This can't be changed after the connection is created." />
              </span>
              <div className="grid grid-cols-2 gap-2">
                <SelectableCard title="Standard API (HTTP)" selected={protocol === 'http'} onClick={() => !initial && setProtocol('http')} />
                <SelectableCard title="MCP server" selected={protocol === 'mcp'} onClick={() => !initial && setProtocol('mcp')} />
              </div>
              {initial && (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  The connection type is fixed once created. To switch, create a new connection.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="conn-base-url">{protocol === 'mcp' ? 'MCP server address' : 'Base web address'}</Label>
              <Input id="conn-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" aria-invalid={baseUrl.length > 0 && !urlValid} />
              {baseUrl.length > 0 && !urlValid && (
                <InlineError message="Must start with https://" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-semi-bold)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Authentication
            </p>
            <div className="space-y-2">
              <SelectableCard
                title="Access key"
                info="Most systems need one key. Add more only if yours specifically requires it."
                selected={authMethod === 'api_key'}
                onClick={() => setAuthMethod('api_key')}
                icon={KeyRound}
              />
              {authMethod === 'api_key' && (
                <div className="ml-6 space-y-3">
                  <div className="space-y-3">
                    {apiKeyRows.map((row, i) => (
                      <div key={row.id} className="space-y-3 rounded-lg border border-border p-3">
                        {apiKeyRows.length > 1 && (
                          <div className="flex items-center justify-between">
                            <p style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)' }}>
                              Key {i + 1}
                            </p>
                            <button
                              type="button"
                              onClick={() => setApiKeyRows((prev) => prev.filter((r) => r.id !== row.id))}
                              className="text-muted-foreground"
                              style={{ fontSize: 'var(--text-xs)' }}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                        <SecretField
                          id={`conn-api-key-${row.id}`}
                          label="Access key"
                          touched={row.touched}
                          value={row.value}
                          onChange={(v) =>
                            setApiKeyRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, value: v } : r)))
                          }
                          onReplace={() =>
                            setApiKeyRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, touched: true } : r)))
                          }
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Where it goes</Label>
                            <Select
                              value={row.location}
                              onValueChange={(v) =>
                                setApiKeyRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, location: v as ApiKeyLocation } : r)),
                                )
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="header">Header</SelectItem>
                                <SelectItem value="query">Web address</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`conn-api-key-field-${row.id}`}>Field name</Label>
                            <Input
                              id={`conn-api-key-field-${row.id}`}
                              value={row.fieldName}
                              onChange={(e) =>
                                setApiKeyRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, fieldName: e.target.value } : r)),
                                )
                              }
                              placeholder="e.g. X-API-Key"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`conn-api-key-prefix-${row.id}`}>Prefix (optional)</Label>
                          <Input
                            id={`conn-api-key-prefix-${row.id}`}
                            value={row.prefix}
                            onChange={(e) =>
                              setApiKeyRows((prev) =>
                                prev.map((r) => (r.id === row.id ? { ...r, prefix: e.target.value } : r)),
                              )
                            }
                            placeholder="e.g. Bearer "
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setApiKeyRows((prev) => [...prev, newDraftApiKeyRow()])}
                  >
                    + Add another key
                  </Button>
                </div>
              )}

              <SelectableCard
                title="Client credentials"
                selected={authMethod === 'client_credentials'}
                onClick={() => setAuthMethod('client_credentials')}
                icon={ShieldCheck}
              />
              {authMethod === 'client_credentials' && (
                <div className="ml-6 space-y-3 rounded-lg border border-border p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="conn-token-url">Token web address</Label>
                    <Input id="conn-token-url" value={tokenUrl} onChange={(e) => setTokenUrl(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="conn-client-id">Client ID</Label>
                    <Input id="conn-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                  </div>
                  <SecretField
                    id="conn-client-secret"
                    label="Client secret"
                    touched={clientSecretTouched}
                    value={clientSecret}
                    onChange={setClientSecret}
                    onReplace={() => setClientSecretTouched(true)}
                  />
                  <div className="space-y-1.5">
                    <Label>Scopes (optional)</Label>
                    <TagInput values={scopes} onChange={setScopes} placeholder="Type a scope and press Enter" />
                  </div>
                  <div className="space-y-1.5">
                    <span className="flex items-center gap-1.5">
                      <Label>Token request format</Label>
                      <InfoTooltip text="How the token request is sent to your system. Most systems use URL-encoded." />
                    </span>
                    <Select value={tokenContentType} onValueChange={(v) => setTokenContentType(v as 'form' | 'json')}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="form">URL-encoded</SelectItem>
                        <SelectItem value="json">JSON</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <SelectableCard
                title="No authentication"
                info="Only for systems that are safe to call without any key."
                selected={authMethod === 'none'}
                onClick={() => setAuthMethod('none')}
                icon={Ban}
              />
            </div>
          </div>
        </div>
        {saveError && <InlineError message={saveError} onRetry={() => void handleSave()} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : initial ? 'Save changes' : 'Create connection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SecretField({
  id,
  label,
  touched,
  value,
  onChange,
  onReplace,
}: {
  id: string
  label: string
  touched: boolean
  value: string
  onChange: (value: string) => void
  onReplace: () => void
}) {
  if (!touched) {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <div className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2">
          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            ••••••••
          </span>
          <button type="button" onClick={onReplace} className="text-primary" style={{ fontSize: 'var(--text-xs)' }}>
            Replace
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// ==================================================================================
// ACTION EDITOR
// ==================================================================================

type ActionEditorState = {
  mode: 'add' | 'edit'
  connectionId: string
  actionId?: string
  name: string
  description: string
  method: ActionMethod
  path: string
  values: ActionValue[]
} | null

function ActionEditorDialog({
  editor,
  existingActionsOnConnection,
  onChange,
  onSave,
  onClose,
}: {
  editor: NonNullable<ActionEditorState>
  existingActionsOnConnection: ConnectionAction[]
  onChange: (editor: ActionEditorState) => void
  /** Resolves to an error message, or null once Meta has accepted the tool. */
  onSave: (editor: NonNullable<ActionEditorState>) => Promise<string | null>
  onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDescriptionWarnings, setShowDescriptionWarnings] = useState(false)
  const [similarWarning, setSimilarWarning] = useState<string | null>(null)

  const bodyAllowed = editor.method === 'POST' || editor.method === 'PUT' || editor.method === 'PATCH'

  function updatePath(path: string) {
    onChange({ ...editor, path, values: syncPathValues(path, editor.values) })
  }

  function addValue(location: ValueLocation) {
    const name = location === 'query' ? 'query_value' : location === 'header' ? 'header_value' : 'body_value'
    onChange({ ...editor, values: [...editor.values, newValue(name, location)] })
  }

  function updateValue(id: string, patch: Partial<ActionValue>) {
    onChange({ ...editor, values: editor.values.map((v) => (v.id === id ? { ...v, ...patch } : v)) })
  }

  function removeValue(id: string) {
    onChange({ ...editor, values: editor.values.filter((v) => v.id !== id) })
  }

  async function handleSave() {
    if (!editor.name.trim() || !editor.description.trim()) return
    const similar = findSimilarActionName(editor.name, existingActionsOnConnection, editor.connectionId, editor.actionId)
    setSimilarWarning(
      similar ? 'This name is very close to another action. Clearly different names help the agent choose correctly.' : null,
    )
    setShowDescriptionWarnings(true)
    setSaving(true)
    setError(null)
    const failure = await onSave(editor)
    setSaving(false)
    if (failure) {
      setError(`Could not save this tool. Nothing was lost. ${failure}`)
      return
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editor.mode === 'add' ? 'Add action' : 'Edit action'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="action-name">Action name</Label>
              <Input id="action-name" value={editor.name} onChange={(e) => onChange({ ...editor, name: e.target.value })} placeholder="Look up an order" />
              {similarWarning && (
                <p className="flex items-center gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  <AlertTriangle className="size-3.5 shrink-0" /> {similarWarning}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <Label htmlFor="action-description">When should the agent use this?</Label>
                <InfoTooltip text="Written for the agent, not for you. Describe when to use this action and what it does, e.g. “Use when a customer asks where their order is. Looks up the order by its number and returns its status.”" />
              </span>
              <Textarea
                id="action-description"
                rows={3}
                value={editor.description}
                onChange={(e) => onChange({ ...editor, description: e.target.value })}
                placeholder='Use when a customer asks where their order is. Looks up the order by its number and returns its status.'
                className="bg-input-background shadow-sm"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-[140px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={editor.method} onValueChange={(v) => onChange({ ...editor, method: v as ActionMethod })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHOD_OPTIONS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5">
                  <Label htmlFor="action-path">Path</Label>
                  <InfoTooltip text="The part after the base address. Put changing parts in curly brackets, e.g. /orders/{order_number}" />
                </span>
                <Input id="action-path" value={editor.path} onChange={(e) => updatePath(e.target.value)} placeholder="/orders/{order_number}" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Values</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      Add a value
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => addValue('query')}>Query value</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addValue('header')}>Header value</DropdownMenuItem>
                    {bodyAllowed && <DropdownMenuItem onClick={() => addValue('body')}>Body value</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {editor.values.length === 0 ? (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  No values yet. Add {'{placeholders}'} to the path, or add one manually.
                </p>
              ) : (
                <div className="space-y-2">
                  {editor.values.map((value) => (
                    <ValueRow
                      key={value.id}
                      value={value}
                      onChange={(patch) => updateValue(value.id, patch)}
                      onRemove={() => removeValue(value.id)}
                      showDescriptionWarning={showDescriptionWarnings}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <InlineError message={error} onRetry={handleSave} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!editor.name.trim() || !editor.description.trim() || saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save action'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ValueRow({
  value,
  onChange,
  onRemove,
  showDescriptionWarning,
}: {
  value: ActionValue
  onChange: (patch: Partial<ActionValue>) => void
  onRemove: () => void
  showDescriptionWarning: boolean
}) {
  const isPath = value.location === 'path'
  const isConversationSourced = value.source === 'conversation' || value.source === 'conversation_memory'
  const missingDescription = isConversationSourced && !value.description.trim()

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={value.name} disabled={isPath} onChange={(e) => onChange({ name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={value.type} onValueChange={(v) => onChange({ type: v as ValueType })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {!isPath && (
          <button type="button" onClick={onRemove} className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Remove
          </button>
        )}
      </div>

      <label className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-xs)' }}>
        <input type="checkbox" checked={value.required} disabled={isPath} onChange={(e) => onChange({ required: e.target.checked })} />
        Required{isPath && ' (always on for path values)'}
      </label>

      <div className="space-y-1">
        <span className="flex items-center gap-1.5">
          <Label className="text-xs">Where it comes from</Label>
          {value.source === 'whatsapp_number' && (
            <InfoTooltip text="Great for looking up a customer’s own orders without asking for details." />
          )}
          {value.source === 'conversation_memory' && (
            <InfoTooltip text="Use this when the value was already given earlier, for example an order number the customer mentioned a few messages ago, so the agent does not have to ask again." />
          )}
        </span>
        <Select value={value.source} onValueChange={(v) => onChange({ source: v as ActionValue['source'] })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="conversation">The conversation</SelectItem>
            <SelectItem value="whatsapp_number">The customer&rsquo;s WhatsApp number, automatically</SelectItem>
            <SelectItem value="fixed">Always the same value</SelectItem>
            <SelectItem value="conversation_memory">A value from earlier in this conversation</SelectItem>
          </SelectContent>
        </Select>
        {value.source === 'fixed' && (
          <Input
            value={value.fixedValue ?? ''}
            onChange={(e) => onChange({ fixedValue: e.target.value })}
            placeholder="The fixed value"
            className="mt-1"
          />
        )}
      </div>

      {isConversationSourced && (
        <div className="space-y-1">
          <span className="flex items-center gap-1.5">
            <Label className="text-xs">Description</Label>
            <InfoTooltip text="The agent reads this to know what to take from the conversation. Be specific, e.g. “The order number, which looks like ORD-12345”." />
          </span>
          <Input
            value={value.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder='e.g. "The order number, which looks like ORD-12345"'
          />
          {showDescriptionWarning && missingDescription && (
            <p className="flex items-center gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              <AlertTriangle className="size-3.5 shrink-0" />
              Without a description, the agent has to guess what this value is. Strongly
              recommended.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ==================================================================================
// ACTION TEST
// ==================================================================================

function ActionTestDialog({
  action,
  onRun,
  onClose,
}: {
  action: ConnectionAction
  onRun: (action: ConnectionAction, inputs: Record<string, string>) => Promise<{ kind: 'success' | 'failure' | 'no_answer'; body: string }>
  onClose: () => void
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ kind: 'success' | 'failure' | 'no_answer'; body: string } | null>(null)

  const conversationValues = action.values.filter((v) => v.source === 'conversation' || v.source === 'conversation_memory')
  const automaticValues = action.values.filter((v) => v.source === 'whatsapp_number')

  async function runTest() {
    setRunning(true)
    setResult(null)
    const res = await onRun(action, inputs)
    setRunning(false)
    setResult(res)
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test: {action.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {conversationValues.map((value) => (
            <div key={value.id} className="space-y-1.5">
              <Label htmlFor={`test-${value.id}`}>{value.name}</Label>
              <Input
                id={`test-${value.id}`}
                value={inputs[value.id] ?? ''}
                onChange={(e) => setInputs((prev) => ({ ...prev, [value.id]: e.target.value }))}
                placeholder={value.description || value.name}
              />
            </div>
          ))}
          {automaticValues.map((value) => (
            <p key={value.id} className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              Customer&rsquo;s WhatsApp number: filled automatically
            </p>
          ))}

          <Button onClick={runTest} disabled={running}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : 'Run test'}
          </Button>

          {result && (
            <div className="space-y-2">
              {result.kind === 'success' && (
                <p className="text-success" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                  It worked
                </p>
              )}
              {result.kind === 'failure' && (
                <p className="text-warning-foreground" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                  The system said no
                </p>
              )}
              {result.kind === 'no_answer' ? (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  Your system did not answer. Check the base web address and that the system is
                  reachable from the internet.
                </p>
              ) : (
                <>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3" style={{ fontSize: 'var(--text-xs)' }}>
                    {result.body}
                  </pre>
                  {result.kind === 'failure' && (
                    <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                      Check the path and the values, and that your access key is right.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ==================================================================================
// ACTIVITY
// ==================================================================================

function ActivityDialog({
  connection,
  rows,
  onClose,
}: {
  connection: Connection
  rows: { id: string; actionName: string; timestamp: number; outcome: 'worked' | 'failed'; errorText?: string }[]
  onClose: () => void
}) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  // A connector on Meta: its real last-7-days log (PRD AC-a19..a22). Otherwise, local test runs.
  const [logs, setLogs] = useState<ConnectorLogs | null>(null)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(100)
  const [page, setPage] = useState(0)
  useEffect(() => {
    if (!connection.metaId) return
    connectorLogs(connection.metaId).then(setLogs, (err) => setLogsError(errorText(err)))
  }, [connection.metaId])
  const remoteRows = (logs?.data ?? []).map((d, i) => ({
    id: `log-${i}`,
    actionName: d.tool_name ?? 'Unknown tool',
    timestamp: d.event_time ? Date.parse(d.event_time) : Date.now(),
    outcome: 'failed' as const,
    errorText: [d.failure_code_name, d.error_message].filter(Boolean).join(': '),
  }))
  const allRows = connection.metaId ? remoteRows : rows
  const sorted = [...allRows].sort((a, b) => b.timestamp - a.timestamp)
  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize)
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activity: {connection.name}</DialogTitle>
          <DialogDescription>
            {connection.metaId
              ? 'The last 7 days. Individual entries are the errors your system returned.'
              : 'Shows what the agent has actually done with this system. Useful when something seems not to be working.'}
          </DialogDescription>
        </DialogHeader>
        {logsError && <InlineError message={`Could not load activity. ${logsError}`} />}
        {logs?.stats && (
          <div className="grid grid-cols-4 gap-2">
            {[
              ['Executions', String(logs.stats.start_count)],
              ['Succeeded', String(logs.stats.success_count)],
              ['Success rate', `${Math.round((logs.stats.success_rate ?? 0) * (logs.stats.success_rate > 1 ? 1 : 100))}%`],
              ['Avg latency', `${(logs.stats.avg_latency_s ?? 0).toFixed(2)} s`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted p-2">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {label}
                </p>
                <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>{value}</p>
              </div>
            ))}
          </div>
        )}
        {connection.metaId && !logs && !logsError ? (
          <p className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            <Loader2 className="size-3.5 animate-spin" /> Loading activity...
          </p>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No activity yet. The agent has not used this connection in a conversation, and no
            tests have been run.
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {pageRows.map((row) => (
              <div key={row.id} className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => row.outcome === 'failed' && setExpandedRowId(expandedRowId === row.id ? null : row.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="flex items-center gap-3" style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="text-muted-foreground">{formatActivityTime(row.timestamp)}</span>
                    <span>{row.actionName}</span>
                  </span>
                  <span
                    className={cn(row.outcome === 'worked' ? 'text-success' : 'text-warning-foreground')}
                    style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}
                  >
                    {row.outcome === 'worked' ? 'Worked' : 'Failed'}
                  </span>
                </button>
                {row.outcome === 'failed' && expandedRowId === row.id && (
                  <pre className="mx-3 mb-2 max-h-32 overflow-auto rounded-md bg-muted p-2" style={{ fontSize: 'var(--text-xs)' }}>
                    {row.errorText}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
        {sorted.length > 10 && (
          <div className="flex items-center justify-between gap-2" style={{ fontSize: 'var(--text-xs)' }}>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              Per page
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(0)
                }}
                className="rounded border border-border bg-background"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              {page + 1} / {pageCount}
              <Button size="sm" variant="ghost" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
