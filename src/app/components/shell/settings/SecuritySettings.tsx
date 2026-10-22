import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Laptop, Loader2, Smartphone } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { authApi, type SessionRow } from '@/app/auth/api'
import { errorDetail } from '@/app/api/meta'
import { SettingsSection } from '../SettingsSection'
import { LoadGate } from './SettingsUi'

/** "Chrome on macOS" from a user-agent string; good enough to recognise your own devices. */
function deviceName(ua: string | null): { name: string; phone: boolean } {
  if (!ua) return { name: 'Unknown device', phone: false }
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser'
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  return { name: os ? `${browser} on ${os}` : browser, phone: /iPhone|Android|Mobile/.test(ua) }
}
const ago = (iso: string | null) => {
  if (!iso) return 'unknown'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 2 ? 'active now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`
}

/** You › Security: where you're signed in, and signing out the devices you don't recognise. */
export function SecuritySettings() {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const load = useCallback(() => {
    setError(null)
    authApi.sessions().then(
      (r) => setRows([...r.sessions].sort((a, z) => Number(z.current) - Number(a.current) || Date.parse(z.lastSeenAt ?? z.createdAt) - Date.parse(a.lastSeenAt ?? a.createdAt))),
      (err) => setError(errorDetail(err)),
    )
  }, [])
  useEffect(load, [load])
  if (!rows) return <LoadGate error={error} onRetry={load} what="where you’re signed in" />

  const others = rows.filter((r) => !r.current)
  const revoke = async (id: string) => {
    setBusy(id)
    try {
      await authApi.revokeSession(id)
      setRows((p) => p?.filter((r) => r.id !== id) ?? p)
      toast.success('Signed out that device')
    } catch (err) {
      toast.error('Couldn’t sign it out', { description: errorDetail(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <SettingsSection
        stacked
        title="Where you’re signed in"
        description="Every browser and device logged in to your account. If you don’t recognise one, sign it out and change your password. Places are approximate (from the network address)."
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => {
            const d = deviceName(r.userAgent)
            const Icon = d.phone ? Smartphone : Laptop
            return (
              <li key={r.id} data-density-row className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Icon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {d.name}
                    {r.current && <Badge variant="success">This device</Badge>}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {r.ip ?? 'Unknown network'} · {r.current ? 'active now' : `last active ${ago(r.lastSeenAt)}`} · signed in {new Date(r.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                {!r.current && (
                  <Button variant="ghost" size="sm" className="text-destructive" disabled={busy === r.id} onClick={() => void revoke(r.id)}>
                    {busy === r.id && <Loader2 className="size-3.5 animate-spin" />}
                    Sign out
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        {others.length > 0 ? (
          <Button variant="outline" onClick={() => setConfirmAll(true)}>
            Sign out everywhere else
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">You’re only signed in here.</p>
        )}
      </SettingsSection>
      <ConfirmDialog
        open={confirmAll}
        title={`Sign out ${others.length} other device${others.length === 1 ? '' : 's'}?`}
        description="They’ll need your password to log in again. This device stays signed in. API tokens aren’t affected (revoke them in API tokens)."
        confirmLabel="Sign out everywhere else"
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => {
          setConfirmAll(false)
          authApi.revokeOtherSessions().then(
            () => {
              setRows((p) => p?.filter((r) => r.current) ?? p)
              toast.success('Signed out everywhere else')
            },
            (err) => toast.error('Couldn’t sign the other devices out', { description: errorDetail(err) }),
          )
        }}
      />
    </div>
  )
}
