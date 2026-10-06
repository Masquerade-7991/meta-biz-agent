import { useState } from 'react'
import { Loader2, Lock, Plug } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/app/components/ui/avatar'
import { Badge } from '@/app/components/ui/badge'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { INTEGRATION_CATALOG } from '@/app/wizard/mockData'
import type { InstalledIntegration, IntegrationDef } from '@/app/wizard/types'

// Deterministic per-category color from the chart palette, so each integration category reads
// as a distinct visual group in the catalog grid instead of every avatar being the same gray.
const CATEGORY_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
function categoryColor(category: string): string {
  let hash = 0
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length]!
}

// A plausible stand-in for what each integration would show once connected, used when nothing
// the user typed in this session makes a better one (see deriveConnectedAs below).
const CONNECTED_AS_FALLBACK: Record<string, string> = {
  salesforce: 'Acme Corp (Salesforce org)',
  hubspot: 'Acme Corp workspace',
  zoho_crm: 'Acme Corp workspace',
  airtable: 'Acme Retail base',
  google_sheets: 'Order Tracker spreadsheet',
  woocommerce: 'yourstore.com',
  magento: 'yourstore.com',
  google_docs: 'Shared Drive',
  notion: 'Acme Corp workspace',
  razorpay: 'Acme Corp account',
  stripe: 'Acme Corp account',
}

/** Prefers whatever the user actually typed in this session over the static fallback — a
 *  Shopify domain, a Zendesk subdomain, and so on read as far more real than a canned string. */
function deriveConnectedAs(integration: IntegrationDef, fieldValues: Record<string, string>): string {
  switch (integration.id) {
    case 'shopify':
      return fieldValues.domain || CONNECTED_AS_FALLBACK.shopify || 'Connected account'
    case 'zendesk':
      return fieldValues.subdomain ? `${fieldValues.subdomain}.zendesk.com` : 'acmecorp.zendesk.com'
    case 'postgresql':
      return fieldValues.database && fieldValues.host ? `${fieldValues.database}@${fieldValues.host}` : 'production database'
    case 'shiprocket':
      return fieldValues.email || 'Acme Corp account'
    default:
      return CONNECTED_AS_FALLBACK[integration.id] ?? 'Connected account'
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

function IntegrationCard({
  integration,
  record,
  onOpen,
}: {
  integration: IntegrationDef
  record: InstalledIntegration | null
  onOpen: () => void
}) {
  const connected = Boolean(record?.connectedAs)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/50"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <Avatar size="lg">
          <AvatarFallback
            className="text-white"
            style={{ backgroundColor: categoryColor(integration.category) }}
          >
            {initials(integration.name)}
          </AvatarFallback>
        </Avatar>
        {connected ? (
          <Badge className="bg-success text-success-foreground shrink-0">Connected</Badge>
        ) : record ? (
          <Badge variant="secondary" className="shrink-0">
            Installed
          </Badge>
        ) : null}
      </div>
      <div>
        <p className="font-semibold">{integration.name}</p>
        <p className="text-muted-foreground text-xs">
          {integration.category}
        </p>
      </div>
      <span className="text-primary text-xs">
        {record ? 'Manage' : 'View integration'}
      </span>
    </button>
  )
}

export function IntegrationsTab() {
  const { state, patch } = useWizard()
  const installed = state.integrations.installed
  const [detailFor, setDetailFor] = useState<IntegrationDef | null>(null)
  const [pendingUninstallId, setPendingUninstallId] = useState<string | null>(null)

  function recordFor(id: string): InstalledIntegration | null {
    return installed.find((i) => i.integrationId === id) ?? null
  }

  function consumeForcedFailure(): boolean {
    if (!state.demo.forceNextFailure) return false
    patch('demo', { forceNextFailure: false })
    return true
  }

  // Installing only adds the integration to your list — it does not authenticate it. Connecting
  // is a separate, later action, same as a real integration marketplace.
  function completeInstall(integration: IntegrationDef) {
    patch('integrations', (prev) => ({
      installed: [
        ...prev.installed.filter((i) => i.integrationId !== integration.id),
        { integrationId: integration.id, installedAt: Date.now(), connectedAs: null, connectedAt: null },
      ],
    }))
  }

  function completeConnect(integrationId: string, connectedAs: string) {
    patch('integrations', (prev) => ({
      installed: prev.installed.map((i) => (i.integrationId === integrationId ? { ...i, connectedAs, connectedAt: Date.now() } : i)),
    }))
  }

  function disconnectOnly(integrationId: string) {
    patch('integrations', (prev) => ({
      installed: prev.installed.map((i) => (i.integrationId === integrationId ? { ...i, connectedAs: null, connectedAt: null } : i)),
    }))
  }

  function uninstall(id: string) {
    patch('integrations', (prev) => ({ installed: prev.installed.filter((i) => i.integrationId !== id) }))
    setPendingUninstallId(null)
  }

  function preInstallSamples() {
    const now = Date.now()
    patch('integrations', (prev) => ({
      installed: [
        ...prev.installed.filter((i) => i.integrationId !== 'shopify' && i.integrationId !== 'salesforce'),
        { integrationId: 'shopify', installedAt: now, connectedAs: 'yourstore.myshopify.com', connectedAt: now },
        { integrationId: 'salesforce', installedAt: now - 1000, connectedAs: CONNECTED_AS_FALLBACK.salesforce, connectedAt: now - 1000 },
      ],
    }))
  }

  useRegisterDevControls(
    'integrations',
    <DemoControlsGroup label="Integrations">
      <Button variant="outline" size="sm" onClick={preInstallSamples}>
        Pre-install two sample integrations (connected)
      </Button>
      <Button variant="outline" size="sm" onClick={() => patch('demo', { forceNextFailure: !state.demo.forceNextFailure })}>
        {state.demo.forceNextFailure ? 'Force connect failure (armed)' : 'Force connect failure'}
      </Button>
    </DemoControlsGroup>,
  )

  const installedIntegrations = INTEGRATION_CATALOG.filter((i) => recordFor(i.id))
  const availableIntegrations = INTEGRATION_CATALOG.filter((i) => !recordFor(i.id))

  return (
    <div className="space-y-6">
      {installedIntegrations.length > 0 && (
        <div className="space-y-2">
          <Label>Installed</Label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {installedIntegrations.map((integration) => (
              <IntegrationCard key={integration.id} integration={integration} record={recordFor(integration.id)} onOpen={() => setDetailFor(integration)} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {installedIntegrations.length > 0 && <Label>Available</Label>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {availableIntegrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} record={null} onOpen={() => setDetailFor(integration)} />
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        This is a prototype. Installing and connecting here are both simulated; no real account is
        contacted.
      </p>

      {detailFor && (
        <IntegrationDetailDialog
          integration={detailFor}
          installedRecord={recordFor(detailFor.id)}
          consumeForcedFailure={consumeForcedFailure}
          onInstall={() => completeInstall(detailFor)}
          onConnected={(connectedAs) => completeConnect(detailFor.id, connectedAs)}
          onDisconnectOnly={() => disconnectOnly(detailFor.id)}
          onUninstall={() => setPendingUninstallId(detailFor.id)}
          onClose={() => setDetailFor(null)}
        />
      )}

      <ConfirmDialog
        open={pendingUninstallId !== null}
        title="Uninstall this integration?"
        description="The agent will immediately lose access to everything this integration provided, including its connection."
        confirmLabel="Uninstall"
        onConfirm={() => pendingUninstallId && uninstall(pendingUninstallId)}
        onCancel={() => setPendingUninstallId(null)}
      />
    </div>
  )
}

// Idle: nothing in progress — either not installed yet, installed-but-not-connected, or
// connected. Fields: collecting a key/credentials, or an OAuth pre-redirect field (Shopify's
// store domain). Redirecting/Consent: a simulated vendor OAuth screen. Connecting: the final
// resolve, same for every auth pattern.
type Phase = 'idle' | 'fields' | 'redirecting' | 'consent' | 'connecting' | 'failed'

function IntegrationDetailDialog({
  integration,
  installedRecord,
  consumeForcedFailure,
  onInstall,
  onConnected,
  onDisconnectOnly,
  onUninstall,
  onClose,
}: {
  integration: IntegrationDef
  installedRecord: InstalledIntegration | null
  consumeForcedFailure: () => boolean
  onInstall: () => void
  onConnected: (connectedAs: string) => void
  onDisconnectOnly: () => void
  onUninstall: () => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  const fieldsComplete = integration.authFields.every((f) => (fieldValues[f.id] ?? '').trim().length > 0)

  function resolveConnection() {
    setPhase('connecting')
    const shouldFail = consumeForcedFailure()
    setTimeout(() => {
      if (shouldFail) {
        setPhase('failed')
        return
      }
      onConnected(deriveConnectedAs(integration, fieldValues))
      setPhase('idle')
    }, 1500)
  }

  function startOauthRedirect() {
    setPhase('redirecting')
    setTimeout(() => setPhase('consent'), 1300)
  }

  function handleConnectClick() {
    if (integration.authPattern === 'oauth' && integration.authFields.length === 0) {
      startOauthRedirect()
    } else {
      setPhase('fields')
    }
  }

  function handleFieldsContinue() {
    if (!fieldsComplete) return
    if (integration.authPattern === 'oauth') {
      startOauthRedirect()
    } else {
      resolveConnection()
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback
                className="text-white"
                style={{ backgroundColor: categoryColor(integration.category) }}
              >
                {initials(integration.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <DialogTitle>{integration.name}</DialogTitle>
              <DialogDescription className="mt-0.5">{integration.category}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <p className="text-sm">{integration.description}</p>

          {!installedRecord ? (
            <div className="space-y-1.5">
              <p className="font-medium">Setup</p>
              <ol className="list-decimal space-y-1 pl-5">
                {integration.setupSteps.map((step, i) => (
                  <li key={i} className="text-muted-foreground text-sm">
                    {step}
                  </li>
                ))}
              </ol>
              <Button onClick={onInstall}>
                <Plug className="size-4" />
                Install Integration
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <Badge variant="secondary">Installed</Badge>
                <Button size="sm" variant="outline" className="text-destructive" onClick={onUninstall}>
                  Uninstall
                </Button>
              </div>

              <div>
                <p className="font-semibold">Connections</p>
                <p className="text-muted-foreground text-xs">
                  Manage the connection this integration uses.
                </p>
              </div>

              {phase === 'failed' && (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                  <p className="font-semibold">Could not connect</p>
                  <p className="text-muted-foreground text-sm">
                    Something went wrong connecting to {integration.name}. Check your details and
                    try again.
                  </p>
                  <Button size="sm" onClick={resolveConnection}>
                    Try again
                  </Button>
                </div>
              )}

              {phase === 'fields' && (
                <div className="space-y-3 rounded-lg bg-muted p-3">
                  {integration.authFields.map((field) => (
                    <div key={field.id} className="space-y-1.5">
                      <Label htmlFor={`auth-${integration.id}-${field.id}`}>{field.label}</Label>
                      <Input
                        id={`auth-${integration.id}-${field.id}`}
                        type={field.type}
                        placeholder={field.placeholder}
                        value={fieldValues[field.id] ?? ''}
                        onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <Button size="sm" onClick={handleFieldsContinue} disabled={!fieldsComplete}>
                    {integration.authPattern === 'oauth' ? 'Continue' : 'Connect'}
                  </Button>
                </div>
              )}

              {phase === 'redirecting' && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Redirecting to {integration.name} to sign in&hellip;</span>
                </div>
              )}

              {phase === 'consent' && (
                <div className="space-y-3 rounded-lg bg-muted p-3">
                  <p className="font-semibold">Approve access for Helo</p>
                  <p className="text-muted-foreground text-sm">
                    Helo is requesting access to your {integration.name} account to use the tools
                    listed below.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={resolveConnection}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPhase('idle')}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {phase === 'connecting' && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">Connecting to {integration.name}&hellip;</span>
                </div>
              )}

              {phase === 'idle' &&
                (installedRecord.connectedAs ? (
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                      <span className="size-1.5 shrink-0 rounded-full bg-success" />
                      Connected to {installedRecord.connectedAs}
                    </p>
                    <Button size="sm" variant="outline" onClick={onDisconnectOnly}>
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                      <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      You are not connected to {integration.name}.
                    </p>
                    <Button size="sm" onClick={handleConnectClick}>
                      <Lock className="size-3.5" />
                      Connect
                    </Button>
                  </div>
                ))}
            </div>
          )}

          <div className="space-y-1.5">
            <p className="font-medium">Tools this makes available</p>
            <ul className="space-y-1.5 rounded-lg bg-muted p-3">
              {integration.tools.map((tool) => (
                <li key={tool.name} className="text-xs">
                  <code className="text-foreground">{tool.name}</code>{' '}
                  <span className="text-muted-foreground">{tool.description}</span>
                </li>
              ))}
            </ul>
          </div>
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
