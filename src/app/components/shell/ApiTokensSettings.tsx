import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Copy, Loader2, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Label } from '@/app/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { useAuth } from '@/app/auth/AuthContext'
import { Field, FormError } from '@/app/auth/AuthLayout'
import { authApi, type ApiToken } from '@/app/auth/api'
import { errorDetail } from '@/app/api/meta'
import { can } from '@/app/lib/permissions'
import { SettingsSection } from './SettingsSection'
import { LoadGate, SettingsLink } from './settings/SettingsUi'
import { copyText } from './settings/clipboard'

const DOCS_URL = 'https://helo-docs.vercel.app/docs/developers/api'
const EXPIRY = [
  { days: '30', label: '30 days' },
  { days: '90', label: '90 days' },
  { days: '365', label: '1 year' },
  { days: '0', label: 'Never' },
]
const date = (iso: string | null, none: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : none)

const expiredAt = (t: ApiToken) => !!t.expiresAt && Date.parse(t.expiresAt) < Date.now()

/** Settings › API tokens: personal tokens for scripts and the API reference's "Try it". Each acts as
 *  its owner, in this workspace, with their current role. (Everyone's tokens: Members, for admins.) */
export function ApiTokensSettings() {
  const { me } = useAuth()
  const [mine, setMine] = useState<ApiToken[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [days, setDays] = useState('90')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const load = useCallback(() => {
    setLoadError(null)
    authApi.tokens().then(
      (m) => setMine(m.tokens),
      (err) => setLoadError(errorDetail(err)),
    )
  }, [])
  useEffect(load, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const t = await authApi.createToken(name.trim(), Number(days))
      setCreated({ name: t.name, token: t.token })
      setName('')
      load()
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (t: ApiToken) => {
    try {
      await authApi.revokeToken(t.id)
      toast.success(`“${t.name}” revoked`)
    } catch (err) {
      toast.error(errorDetail(err))
    }
    load()
  }

  return (
    <div>
      <SettingsSection
        title="Create a token"
        description={`For scripts and the API reference’s “Try it”. A token acts as you, in ${me?.workspace?.name ?? 'this workspace'}, with your current role. Send it as Authorization: Bearer <token>.`}
      >
        <form onSubmit={create} className="space-y-4">
          <Field label="Name" placeholder="e.g. Docs try it" maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="space-y-1.5">
            <Label htmlFor="token-expiry">Expires after</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger id="token-expiry" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY.map((x) => (
                  <SelectItem key={x.days} value={x.days}>
                    {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {days === '0' && <p className="text-xs text-warning-foreground">A token that never expires keeps working until someone revokes it. Prefer an expiry for anything that leaves your laptop.</p>}
          {error && <FormError>{error}</FormError>}
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create token
          </Button>
          {created && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3" role="status">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">Copy “{created.name}” now. You won’t see it again.</p>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => setCreated(null)}>
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs select-all">{created.token}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => void copyText(created.token, 'Token copied')}>
                  <Copy className="size-4" />
                  Copy
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Try it in the{' '}
                <a className="text-primary underline-offset-2 hover:underline" href={DOCS_URL} target="_blank" rel="noreferrer">
                  API reference
                </a>
                .
              </p>
            </div>
          )}
        </form>
      </SettingsSection>

      <SettingsSection stacked title="Your tokens" description="They stop working when they expire, when you revoke them, when you change your password, or if you leave the workspace.">
        {mine ? <TokenTable tokens={mine} empty="No tokens yet." onRevoke={setRevoking} /> : <LoadGate error={loadError} onRetry={load} what="your tokens" />}
        {can(me?.role, 'tokens.manage') && (
          <p className="text-sm text-muted-foreground">
            Everyone’s tokens in this workspace are listed in <SettingsLink tab="members">Members</SettingsLink>.
          </p>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={!!revoking}
        title={`Revoke “${revoking?.name ?? ''}”?`}
        description="Anything using this token stops working at once. This can’t be undone."
        confirmLabel="Revoke token"
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const r = revoking
          setRevoking(null)
          if (r) void revoke(r)
        }}
      />
    </div>
  )
}

function TokenTable({ tokens, owners, empty, onRevoke }: { tokens: ApiToken[]; owners?: boolean; empty: string; onRevoke: (t: ApiToken) => void }) {
  if (!tokens.length) return <p className="text-muted-foreground text-sm">{empty}</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            {owners && <TableHead>Owner</TableHead>}
            <TableHead>Created</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="w-0" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((t) => (
            <TableRow key={t.id} data-density-row>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {t.name}
                  {expiredAt(t) && <Badge variant="warning">Expired</Badge>}
                </div>
                <code className="text-muted-foreground font-mono text-xs">{t.prefix}…</code>
              </TableCell>
              {owners && <TableCell className="text-muted-foreground">{t.ownerName || t.ownerEmail}</TableCell>}
              <TableCell className="text-muted-foreground">{date(t.createdAt, '')}</TableCell>
              <TableCell className="text-muted-foreground">{date(t.lastUsedAt, 'Never')}</TableCell>
              <TableCell className="text-muted-foreground">{date(t.expiresAt, 'Never')}</TableCell>
              <TableCell>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onRevoke(t)}>
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Members (owners and admins): every token in the workspace, to revoke one when a laptop is lost. */
export function WorkspaceTokens() {
  const [all, setAll] = useState<ApiToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const load = useCallback(() => {
    setError(null)
    authApi.workspaceTokens().then(
      (r) => setAll(r.tokens),
      (err) => setError(errorDetail(err)),
    )
  }, [])
  useEffect(load, [load])
  return (
    <SettingsSection stacked title="API tokens in this workspace" description="Everyone’s personal tokens. Revoke one when a laptop is lost or someone shouldn’t use the API any more. Your own are also in API tokens.">
      {all ? <TokenTable tokens={all} owners empty="Nobody in this workspace has a token." onRevoke={setRevoking} /> : <LoadGate error={error} onRetry={load} what="the tokens" />}
      <ConfirmDialog
        open={!!revoking}
        title={`Revoke “${revoking?.name ?? ''}”?`}
        description={`Anything using ${revoking?.ownerName ? `${revoking.ownerName}’s` : 'this'} token stops working at once. This can’t be undone.`}
        confirmLabel="Revoke token"
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const t = revoking
          setRevoking(null)
          if (!t) return
          authApi.revokeWorkspaceToken(t.id).then(
            () => toast.success(`“${t.name}” revoked`),
            (err) => toast.error(errorDetail(err)),
          ).finally(load)
        }}
      />
    </SettingsSection>
  )
}
