import { useState } from 'react'
import { Plug, Plus } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useAuth } from '@/app/auth/AuthContext'
import { can } from '@/app/lib/permissions'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { CONNECTION_STATUS_META, SAMPLE_CONNECTIONS, newId, type RecipeAction } from '@/app/wizard/mockData'
import type { Connection, ConnectionAction, ConnectionStatus } from '@/app/wizard/types'
import { readToolRun } from '@/app/wizard/toolRun'
import { deleteConnector, deleteTool, errorText, listTools, refreshMcpTools, runTool, saveConnector, saveTool, toolToAction } from '@/app/api/meta'
import { IntegrationsTab } from './IntegrationsTab'
import { isDummyMode } from '@/app/api/dummy'
import { INTEGRATION_CATALOG } from '@/app/wizard/mockData'
import { StatusPill } from '@/app/components/ui/status'
import { ConnectionCard } from './connections/ConnectionCard'
import { ConnectionDialog } from './connections/ConnectionDialog'
import { ErrorsDialog } from './connections/ErrorsDialog'
import { ToolDialog } from './connections/ToolDialog'
import { ToolTestDialog, type TestOutcome } from './connections/ToolTestDialog'
import { metaErrorHint } from './connections/helpers'


/** Connections: the business's own systems (real, on Meta) first. Ready-made integrations have no
 *  Meta API yet, so outside demo mode they show as coming soon rather than a simulated install. */
export function ConnectionsStep() {
  return (
    <Tabs defaultValue="connections">
      <TabsList>
        <TabsTrigger value="connections">Your systems</TabsTrigger>
        <TabsTrigger value="integrations">Ready-made</TabsTrigger>
      </TabsList>
      <TabsContent value="connections" forceMount className="data-[state=inactive]:hidden">
        <CustomConnections />
        <p className="mt-6 text-meta text-muted-foreground">
          To steer when your agent uses a tool, add a skill under Abilities, e.g. &ldquo;Always check live stock before saying something is available.&rdquo;
        </p>
      </TabsContent>
      <TabsContent value="integrations" forceMount className="data-[state=inactive]:hidden">
        {isDummyMode() ? <IntegrationsTab /> : <ComingSoonIntegrations />}
      </TabsContent>
    </Tabs>
  )
}

function ComingSoonIntegrations() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        One-click connections to popular tools are on the way. Until then, connect any system that has an API under <span className="font-medium text-foreground">Your systems</span>.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATION_CATALOG.map((i) => (
          <li key={i.id} className="flex items-start gap-3 rounded-lg border border-border p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground">{i.name[0]}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{i.name}</p>
                <StatusPill tone="neutral" dot={false}>
                  Coming soon
                </StatusPill>
              </div>
              <p className="text-meta text-muted-foreground">{i.category}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

type ConnectionForm = { mode: 'add' } | { mode: 'edit'; connection: Connection; replaceKeys?: boolean }
type ToolForm = { connection: Connection; tool?: ConnectionAction }

function CustomConnections() {
  const { state, patch } = useWizard()
  const { me } = useAuth()
  // Supervisors and agents see the setup but don't change it (the server refuses them too).
  const canEdit = can(me?.role, 'agent.edit')
  const { connections, actions, activity } = state.connections

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [connectionForm, setConnectionForm] = useState<ConnectionForm | null>(null)
  const [toolForm, setToolForm] = useState<ToolForm | null>(null)
  const [testing, setTesting] = useState<ConnectionAction | null>(null)
  const [errorsFor, setErrorsFor] = useState<Connection | null>(null)
  const [deleteConnection, setDeleteConnection] = useState<Connection | null>(null)
  const [deleteToolOf, setDeleteToolOf] = useState<ConnectionAction | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})

  const toolsOf = (id: string) => actions.filter((a) => a.connectionId === id)
  const connectionOf = (a: ConnectionAction) => connections.find((c) => c.id === a.connectionId)
  const fail = (id: string, message: string) => setRowError((p) => ({ ...p, [id]: message }))

  /** Demo controls' "force a failure": the next Meta call fails on purpose. */
  function consumeForcedFailure(): boolean {
    if (!state.demo.forceNextFailure) return false
    patch('demo', { forceNextFailure: false })
    return true
  }

  // ---- connections ----
  /** Create or update on Meta first; the card only appears or changes once Meta accepts it. */
  async function saveConnection(fields: Omit<Connection, 'id' | 'createdAt' | 'demoStatus'>, auth: boolean): Promise<string | null> {
    const existing = connectionForm?.mode === 'edit' ? connectionForm.connection : undefined
    const draft: Connection = existing ? { ...existing, ...fields, protocol: existing.protocol ?? fields.protocol } : { ...fields, id: newId('conn'), createdAt: Date.now(), demoStatus: 'not_tested' }
    try {
      if (consumeForcedFailure()) throw new Error('Could not save this connection.')
      // Meta's answer replaces the typed keys: only their place and last 4 characters stay here.
      Object.assign(draft, await saveConnector(draft, auth))
    } catch (err) {
      return metaErrorHint(errorText(err))
    }
    patch('connections', (prev) => ({ connections: existing ? prev.connections.map((c) => (c.id === draft.id ? draft : c)) : [...prev.connections, draft] }))
    setConnectionForm(null)
    if (!existing) {
      setExpandedId(draft.id)
      if (draft.protocol === 'mcp') void refreshTools(draft)
    }
    return null
  }

  /** MCP only: Meta asks the server for its tools again; they're listed as test-only tools. */
  async function refreshTools(c: Connection) {
    if (!c.metaId) return
    setRefreshing(c.id)
    fail(c.id, '')
    try {
      const fields = await refreshMcpTools(c.metaId)
      const tools = await listTools(c.metaId)
      patch('connections', (prev) => ({
        connections: prev.connections.map((x) => (x.id === c.id ? { ...x, ...fields } : x)),
        actions: [...prev.actions.filter((a) => a.connectionId !== c.id), ...tools.map((t) => toolToAction(t, c.id, true))],
      }))
    } catch (err) {
      fail(c.id, `Couldn’t refresh tools. ${metaErrorHint(errorText(err))}`)
    } finally {
      setRefreshing(null)
    }
  }

  async function confirmDeleteConnection() {
    const c = deleteConnection
    setDeleteConnection(null)
    if (!c) return
    try {
      if (consumeForcedFailure()) throw new Error('forced')
      // Meta removes the connection's tools with it (PRD V-a4).
      if (c.metaId) await deleteConnector(c.metaId)
    } catch (err) {
      return fail(c.id, `Couldn’t delete it; it’s still here. ${errorText(err) === 'forced' ? '' : errorText(err)}`)
    }
    patch('connections', (prev) => ({ connections: prev.connections.filter((x) => x.id !== c.id), actions: prev.actions.filter((a) => a.connectionId !== c.id) }))
  }

  // ---- tools ----
  async function saveToolDraft(tool: ConnectionAction, test: boolean): Promise<string | null> {
    const c = connections.find((x) => x.id === tool.connectionId)
    if (!c?.metaId) return 'Save the connection to Meta first, then add tools.'
    const saved = { ...tool }
    try {
      if (consumeForcedFailure()) throw new Error('Could not save this tool.')
      saved.metaId = await saveTool(c.metaId, saved)
    } catch (err) {
      return metaErrorHint(errorText(err))
    }
    patch('connections', (prev) => ({ actions: prev.actions.some((a) => a.id === saved.id) ? prev.actions.map((a) => (a.id === saved.id ? saved : a)) : [...prev.actions, saved] }))
    setToolForm(null)
    setExpandedId(c.id)
    if (test) setTesting(saved)
    return null
  }

  async function confirmDeleteTool() {
    const t = deleteToolOf
    setDeleteToolOf(null)
    if (!t) return
    const connMetaId = connectionOf(t)?.metaId
    try {
      if (consumeForcedFailure()) throw new Error('forced')
      if (connMetaId && t.metaId) await deleteTool(connMetaId, t.metaId)
    } catch (err) {
      return fail(t.id, `Couldn’t delete it; it’s still here. ${errorText(err) === 'forced' ? '' : errorText(err)}`)
    }
    patch('connections', (prev) => ({ actions: prev.actions.filter((a) => a.id !== t.id) }))
  }

  /** Runs the tool live on Meta with the connection's saved key (PRD AC-c14), and logs the outcome here. */
  async function runTest(tool: ConnectionAction, input: Record<string, unknown>): Promise<TestOutcome> {
    const connMetaId = connectionOf(tool)?.metaId
    const log = (outcome: 'worked' | 'failed', errorText?: string) =>
      patch('connections', (prev) => ({
        activity: [{ id: newId('activity'), connectionId: tool.connectionId, actionId: tool.id, actionName: tool.name, timestamp: Date.now(), outcome, errorText }, ...prev.activity],
      }))
    const started = performance.now()
    try {
      if (consumeForcedFailure()) throw new Error('No response from the system.')
      if (!connMetaId || !tool.metaId) throw new Error('Save the connection and the tool first.')
      const r = await runTool(connMetaId, tool.metaId, input)
      const read = readToolRun(r.status, r.output)
      log(read.ok ? 'worked' : 'failed', read.ok ? undefined : read.body)
      return { kind: 'done', ...read, ms: performance.now() - started }
    } catch (err) {
      log('failed', errorText(err))
      return { kind: 'error', message: metaErrorHint(errorText(err)) }
    }
  }

  // ---- demo controls ----
  function loadSampleConnections() {
    const now = Date.now()
    const newConnections: Connection[] = []
    const newActions: ConnectionAction[] = []
    const newActivity = activity.slice()
    SAMPLE_CONNECTIONS.forEach((seed) => {
      const connectionId = newId('conn')
      newConnections.push({
        id: connectionId,
        name: seed.name.replace(/[^A-Za-z0-9_]+/g, '_'),
        description: seed.description,
        baseUrl: seed.baseUrl,
        authMethod: 'api_key',
        apiKeys: [{ id: newId('key'), value: '', location: 'header', fieldName: 'X-API-Key', prefix: '', hint: 'k3y9' }],
        createdAt: now,
        demoStatus: seed.demoStatus,
      })
      seed.actions.forEach((recipe, i) => {
        const id = newId('action')
        newActions.push(recipeToTool(recipe, connectionId, id, now - i))
        if (seed.withActivity) newActivity.unshift({ id: newId('activity'), connectionId, actionId: id, actionName: recipe.name, timestamp: now - i * 240_000, outcome: 'worked' })
      })
      if (seed.demoStatus === 'having_problems' && seed.withActivity)
        newActivity.unshift({ id: newId('activity'), connectionId, actionId: newActions[0]?.id ?? '', actionName: newActions[0]?.name ?? '', timestamp: now, outcome: 'failed', errorText: '503 Service Unavailable' })
    })
    patch('connections', { connections: newConnections, actions: newActions, activity: newActivity })
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
        <div className="flex flex-wrap items-center gap-3">
          {connections.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-xs">
              {c.name}
              <select
                value={c.demoStatus}
                onChange={(e) => patch('connections', { connections: connections.map((x) => (x.id === c.id ? { ...x, demoStatus: e.target.value as ConnectionStatus } : x)) })}
                className="rounded border border-warning bg-warning/10 text-warning-foreground text-xs"
              >
                {Object.entries(CONNECTION_STATUS_META).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </DemoControlsGroup>,
  )

  const testingConnection = testing ? connectionOf(testing) : undefined

  return (
    <div className="space-y-4">
      {connections.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Plug className="size-5 text-muted-foreground" />
          </span>
          <h3 className="text-base font-semibold">Connect your agent to your systems</h3>
          <p className="max-w-md text-muted-foreground text-sm">
            Let your agent look things up and act for customers, like checking stock or an order, instead of only answering from its knowledge. You&rsquo;ll need the system&rsquo;s web address and a key, so you may want your developer nearby.
          </p>
          {canEdit && (
            <Button onClick={() => setConnectionForm({ mode: 'add' })}>
              <Plus className="size-4" /> Connect a system
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {connections.length} connection{connections.length === 1 ? '' : 's'} · {actions.length} tool{actions.length === 1 ? '' : 's'}
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => setConnectionForm({ mode: 'add' })}>
                <Plus className="size-4" /> Connect a system
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {connections.map((c) => (
              <ConnectionCard
                key={c.id}
                connection={c}
                tools={toolsOf(c.id)}
                expanded={expandedId === c.id}
                canEdit={canEdit}
                refreshing={refreshing === c.id}
                rowError={rowError}
                onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                onAddTool={() => setToolForm({ connection: c })}
                onRefreshTools={() => void refreshTools(c)}
                onEditTool={(tool) => setToolForm({ connection: c, tool })}
                onTestTool={setTesting}
                onDeleteTool={setDeleteToolOf}
                onEdit={() => setConnectionForm({ mode: 'edit', connection: c })}
                onReplaceKey={() => setConnectionForm({ mode: 'edit', connection: c, replaceKeys: true })}
                onErrors={() => setErrorsFor(c)}
                onDelete={() => setDeleteConnection(c)}
                onClearError={(id) => fail(id, '')}
              />
            ))}
          </div>
        </>
      )}

      {connectionForm && (
        <ConnectionDialog
          initial={connectionForm.mode === 'edit' ? connectionForm.connection : undefined}
          replaceKeys={connectionForm.mode === 'edit' && connectionForm.replaceKeys}
          onSave={saveConnection}
          onClose={() => setConnectionForm(null)}
        />
      )}
      {toolForm && (
        <ToolDialog
          connection={toolForm.connection}
          initial={toolForm.tool}
          siblings={toolsOf(toolForm.connection.id)}
          onSave={saveToolDraft}
          onClose={() => setToolForm(null)}
        />
      )}
      {testing && testingConnection && (
        <ToolTestDialog
          tool={testing}
          connection={testingConnection}
          onRun={runTest}
          onReplaceKey={() => {
            setTesting(null)
            setConnectionForm({ mode: 'edit', connection: testingConnection, replaceKeys: true })
          }}
          onClose={() => setTesting(null)}
        />
      )}
      {errorsFor && <ErrorsDialog connection={errorsFor} rows={activity.filter((a) => a.connectionId === errorsFor.id)} onClose={() => setErrorsFor(null)} />}

      <ConfirmDialog
        open={!!deleteConnection}
        title={`Delete ${deleteConnection?.name ?? 'this connection'}?`}
        description={`Its ${deleteConnection ? toolsOf(deleteConnection.id).length : 0} tool(s) go with it, and your agent stops using them straight away.`}
        onConfirm={() => void confirmDeleteConnection()}
        onCancel={() => setDeleteConnection(null)}
      />
      <ConfirmDialog
        open={!!deleteToolOf}
        title={`Delete ${deleteToolOf?.name ?? 'this tool'}?`}
        description="Your agent stops using it straight away."
        onConfirm={() => void confirmDeleteTool()}
        onCancel={() => setDeleteToolOf(null)}
      />
    </div>
  )
}

function recipeToTool(recipe: RecipeAction, connectionId: string, id: string, createdAt: number): ConnectionAction {
  return {
    id,
    connectionId,
    name: recipe.name.replace(/[^A-Za-z0-9_]+/g, '_'),
    description: recipe.description,
    method: recipe.method,
    path: recipe.path,
    values: recipe.values.map((v) => ({ ...v, id: newId('value'), required: v.location === 'path' })),
    createdAt,
  }
}
