import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { KNOWN_MCP_SERVERS, newId } from '@/app/wizard/mockData'

/** Calls the server's real `tools/list` JSON-RPC method — an actual network call, not a
 *  simulation, so it fails for the ordinary real-world reasons a browser-only prototype with no
 *  backend proxy would (CORS, an SSE-only transport, an unreachable address), not a fake reason. */
async function fetchMcpTools(serverUrl: string, accessKey: string): Promise<{ name: string; description: string }[]> {
  const res = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(accessKey.trim() ? { Authorization: `Bearer ${accessKey.trim()}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: newId('mcp'), method: 'tools/list', params: {} }),
  })
  if (!res.ok) throw new Error(`Server responded with ${res.status} ${res.statusText}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('This server did not return a plain JSON response.')
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error.message ?? 'The server returned an error.')
  const tools = data.result?.tools
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('This server did not report any tools.')
  }
  return tools.map((t: { name: string; description?: string }) => ({ name: t.name, description: t.description ?? '' }))
}

export function McpTab() {
  const { state, patch } = useWizard()
  const connection = state.mcp.connection

  const [serverUrl, setServerUrl] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = useState(false)

  async function handleConnect() {
    const url = serverUrl.trim()
    if (!url) return
    setConnecting(true)
    setError(null)
    try {
      const tools = await fetchMcpTools(url, accessKey)
      patch('mcp', {
        connection: {
          serverUrl: url,
          hasAccessKey: accessKey.trim().length > 0,
          connectedAt: Date.now(),
          tools: tools.map((t) => ({ ...t, enabled: true })),
        },
      })
      setServerUrl('')
      setAccessKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach this server.')
    } finally {
      setConnecting(false)
    }
  }

  function toggleTool(name: string) {
    if (!connection) return
    patch('mcp', {
      connection: { ...connection, tools: connection.tools.map((t) => (t.name === name ? { ...t, enabled: !t.enabled } : t)) },
    })
  }

  function disconnect() {
    patch('mcp', { connection: null })
    setPendingDisconnect(false)
  }

  function loadSampleConnection() {
    patch('mcp', {
      connection: {
        serverUrl: 'inventory-server.example.com',
        hasAccessKey: false,
        connectedAt: Date.now(),
        tools: [
          { name: 'search_inventory', description: 'Search products by name or SKU', enabled: true },
          { name: 'check_stock', description: 'Check stock for one product', enabled: true },
          { name: 'update_price', description: "Change a product's price", enabled: false },
        ],
      },
    })
  }

  useRegisterDevControls(
    'mcp',
    <DemoControlsGroup label="MCP">
      <Button variant="outline" size="sm" onClick={loadSampleConnection}>
        Show sample MCP server connected
      </Button>
    </DemoControlsGroup>,
  )

  if (connection) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
          <div>
            <div className="flex items-center gap-1.5">
              <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>Connected: {connection.serverUrl}</p>
              <Badge className="bg-success text-success-foreground">Connected</Badge>
            </div>
          </div>
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setPendingDisconnect(true)}>
            Disconnect
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label>Discovered tools</Label>
          <div className="space-y-1 rounded-lg border border-border p-1">
            {connection.tools.map((tool) => (
              <label key={tool.name} className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/40" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={tool.enabled} onChange={() => toggleTool(tool.name)} />
                <div className="min-w-0">
                  <code style={{ fontSize: 'var(--text-sm)' }}>{tool.name}</code>{' '}
                  <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    {tool.description}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <ConfirmDialog
          open={pendingDisconnect}
          title="Disconnect this MCP server?"
          description="The agent will immediately lose access to every tool this server provided."
          confirmLabel="Disconnect"
          onConfirm={disconnect}
          onCancel={() => setPendingDisconnect(false)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h3>Connect an MCP server</h3>
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Point your agent at any MCP server and it automatically finds what that server can do.
        </p>
      </div>

      <div className="mx-auto max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mcp-server-url">MCP server address</Label>
          <Input
            id="mcp-server-url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://your-server.example.com/mcp"
          />
        </div>
        <div className="space-y-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="mcp-access-key">Access key, if it needs one</Label>
            <InfoTooltip text="Some MCP servers are open, others need a key. Your developer or the server's own documentation can tell you which." />
          </span>
          <Input id="mcp-access-key" type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
          </p>
        )}

        <Button onClick={handleConnect} disabled={!serverUrl.trim() || connecting} className="w-full">
          {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
          Connect
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Or choose a known server</Label>
        {KNOWN_MCP_SERVERS.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            A curated gallery of known MCP servers is coming soon.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {KNOWN_MCP_SERVERS.map((server) => (
              <button
                key={server.url}
                type="button"
                onClick={() => setServerUrl(server.url)}
                className="space-y-1 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/50"
              >
                <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{server.name}</p>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {server.description}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
