import { useState } from 'react'
import { toast } from 'sonner'
import {
  Ban,
  ChevronDown,
  Code,
  Info,
  Loader2,
  Plus,
  ShoppingBag,
  Store,
  Trash2,
} from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Badge } from '@/app/components/ui/badge'
import { Switch } from '@/app/components/ui/switch'
import { Card, CardContent } from '@/app/components/ui/card'
import { Textarea } from '@/app/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select'
import { useWizard } from '@/app/wizard/WizardContext'
import { CONNECTOR_TOOL_TEMPLATES, newId } from '@/app/wizard/mockData'
import type { ConnectorType, CustomTool } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

const CONNECTOR_OPTIONS: { id: Exclude<ConnectorType, null>; label: string; icon: typeof ShoppingBag }[] = [
  { id: 'shopify', label: 'Shopify', icon: ShoppingBag },
  { id: 'woocommerce', label: 'WooCommerce', icon: Store },
  { id: 'custom_rest', label: 'Custom REST', icon: Code },
  { id: 'none', label: 'None', icon: Ban },
]

const TOOL_MOCK_RESPONSES: Record<string, string> = {
  'Check order status': JSON.stringify({ status: 'shipped', tracking: '1Z999AA1' }, null, 2),
  'Create a cart': JSON.stringify(
    { cart_id: 'c_88213', checkout_url: 'https://aurorahome.com/checkout/c_88213' },
    null,
    2,
  ),
  'Track a shipment': JSON.stringify(
    { carrier: 'FedEx', tracking: '1Z999AA1', eta: '2026-08-09' },
    null,
    2,
  ),
}

export function ConnectorsStep() {
  const { state, patch } = useWizard()
  const { connectors } = state
  const [customToolOpen, setCustomToolOpen] = useState(false)
  const [expandedTools, setExpandedTools] = useState<string[]>([])
  const [draftTool, setDraftTool] = useState<Omit<CustomTool, 'id'>>({
    name: '',
    method: 'GET',
    path: '',
    paramsJson: '{}',
  })

  const showAuth = connectors.connectorType && connectors.connectorType !== 'none'
  const isCustom = connectors.connectorType === 'custom_rest'

  function selectConnector(type: Exclude<ConnectorType, null>) {
    patch('connectors', {
      connectorType: type,
      connectionStatus: 'untested',
      tools: [],
      skipped: false,
    })
  }

  function testConnection() {
    const credential = isCustom ? connectors.clientId : connectors.apiKey
    if (!credential.trim()) {
      patch('connectors', { connectionStatus: 'failed' })
      toast.error('Enter credentials before testing the connection.')
      return
    }
    patch('connectors', { connectionStatus: 'testing' })
    setTimeout(() => {
      if (credential.trim().toLowerCase() === 'invalid') {
        patch('connectors', { connectionStatus: 'failed' })
        toast.error('Authentication failed. Check the credential and try again.')
        return
      }
      const templates =
        connectors.connectorType && connectors.connectorType in CONNECTOR_TOOL_TEMPLATES
          ? CONNECTOR_TOOL_TEMPLATES[connectors.connectorType as 'shopify' | 'woocommerce']
          : []
      patch('connectors', {
        connectionStatus: 'success',
        tools: templates.map((tool) => ({
          ...tool,
          id: newId('tool'),
          enabled: true,
          testStatus: 'untested' as const,
          lastResponse: null,
        })),
      })
      toast.success('Connection succeeded')
    }, 900)
  }

  function toggleTool(id: string) {
    patch('connectors', {
      tools: connectors.tools.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    })
  }

  function testTool(id: string) {
    patch('connectors', {
      tools: connectors.tools.map((t) => (t.id === id ? { ...t, testStatus: 'testing' } : t)),
    })
    setTimeout(() => {
      patch('connectors', (prev) => ({
        tools: prev.tools.map((t) =>
          t.id === id
            ? { ...t, testStatus: 'success', lastResponse: TOOL_MOCK_RESPONSES[t.name] ?? '{ "status": "ok" }' }
            : t,
        ),
      }))
    }, 800)
  }

  function addCustomTool() {
    if (!draftTool.name.trim() || !draftTool.path.trim()) return
    patch('connectors', {
      customTools: [...connectors.customTools, { ...draftTool, id: newId('customtool') }],
    })
    setDraftTool({ name: '', method: 'GET', path: '', paramsJson: '{}' })
  }

  function removeCustomTool(id: string) {
    patch('connectors', { customTools: connectors.customTools.filter((t) => t.id !== id) })
  }

  return (
    <div className="space-y-8">
      <Card className="border-accent bg-accent/40">
        <CardContent className="flex items-start gap-2 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            This step is optional and often handled by a technical contact. Skip it and the rest
            of the wizard still completes — your agent can go live in a knowledge-and-conversation
            only mode.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-1.5">
        <Label>Connector</Label>
        <div className="grid grid-cols-4 gap-3">
          {CONNECTOR_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = connectors.connectorType === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => selectConnector(option.id)}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border px-4 py-5 transition-colors',
                  active ? 'border-primary bg-accent' : 'border-border hover:border-primary/50',
                )}
              >
                <Icon className="size-6 text-muted-foreground" />
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                  {option.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {showAuth && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          {isCustom ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="client-id">Client ID</Label>
                <Input
                  id="client-id"
                  value={connectors.clientId}
                  onChange={(e) => patch('connectors', { clientId: e.target.value, connectionStatus: 'untested' })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-secret">Client secret</Label>
                <Input
                  id="client-secret"
                  type="password"
                  value={connectors.clientSecret}
                  onChange={(e) => patch('connectors', { clientSecret: e.target.value, connectionStatus: 'untested' })}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="api-key">API key</Label>
              <Input
                id="api-key"
                type="password"
                value={connectors.apiKey}
                onChange={(e) => patch('connectors', { apiKey: e.target.value, connectionStatus: 'untested' })}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={testConnection} disabled={connectors.connectionStatus === 'testing'}>
              {connectors.connectionStatus === 'testing' && <Loader2 className="size-4 animate-spin" />}
              Test connection
            </Button>
            {connectors.connectionStatus === 'success' && (
              <Badge className="bg-success text-success-foreground">Connected</Badge>
            )}
            {connectors.connectionStatus === 'failed' && <Badge variant="destructive">Failed</Badge>}
          </div>
        </div>
      )}

      {connectors.tools.length > 0 && (
        <div className="space-y-1.5">
          <Label>Available tools</Label>
          <div className="space-y-2">
            {connectors.tools.map((tool) => {
              const expanded = expandedTools.includes(tool.id)
              return (
                <div key={tool.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{tool.name}</p>
                      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        {tool.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {tool.testStatus === 'success' && (
                        <Badge className="bg-success text-success-foreground">Tested</Badge>
                      )}
                      <Switch checked={tool.enabled} onCheckedChange={() => toggleTool(tool.id)} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testTool(tool.id)}
                        disabled={tool.testStatus === 'testing'}
                      >
                        {tool.testStatus === 'testing' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        Test
                      </Button>
                      {tool.lastResponse && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTools((prev) =>
                              expanded ? prev.filter((id) => id !== tool.id) : [...prev, tool.id],
                            )
                          }
                          className="text-muted-foreground"
                        >
                          <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && tool.lastResponse && (
                    <pre
                      className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-foreground"
                      style={{ fontSize: 'var(--text-xs)' }}
                    >
                      {tool.lastResponse}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setCustomToolOpen((v) => !v)}
          className="flex items-center gap-1 text-primary"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}
        >
          <ChevronDown className={cn('size-4 transition-transform', customToolOpen && 'rotate-180')} />
          Custom tool (advanced)
        </button>
        {customToolOpen && (
          <Card className="mt-2">
            <CardContent className="space-y-3 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tool-name">Name</Label>
                  <Input
                    id="tool-name"
                    value={draftTool.name}
                    onChange={(e) => setDraftTool((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Check loyalty points"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tool-method">Method</Label>
                  <Select
                    value={draftTool.method}
                    onValueChange={(value) => setDraftTool((d) => ({ ...d, method: value as CustomTool['method'] }))}
                  >
                    <SelectTrigger id="tool-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['GET', 'POST', 'PUT', 'DELETE'] as const).map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tool-path">Path</Label>
                  <Input
                    id="tool-path"
                    value={draftTool.path}
                    onChange={(e) => setDraftTool((d) => ({ ...d, path: e.target.value }))}
                    placeholder="/loyalty/{customer_id}"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tool-params">Parameters (JSON)</Label>
                <Textarea
                  id="tool-params"
                  rows={3}
                  value={draftTool.paramsJson}
                  onChange={(e) => setDraftTool((d) => ({ ...d, paramsJson: e.target.value }))}
                />
              </div>
              <Button size="sm" onClick={addCustomTool}>
                <Plus className="size-3.5" />
                Add tool
              </Button>

              {connectors.customTools.length > 0 && (
                <div className="space-y-2 pt-2">
                  {connectors.customTools.map((tool) => (
                    <div key={tool.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <span style={{ fontSize: 'var(--text-sm)' }}>
                        <Badge variant="outline" className="mr-2">
                          {tool.method}
                        </Badge>
                        {tool.name} &middot; {tool.path}
                      </span>
                      <Button variant="ghost" size="icon-sm" onClick={() => removeCustomTool(tool.id)}>
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
