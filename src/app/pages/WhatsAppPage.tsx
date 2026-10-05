import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { listNumbers, type WaNumber } from '@/app/api/numbers'
import { getSignupConfig, type SignupConfig } from '@/app/api/whatsapp'
import { ConnectWhatsApp } from '@/app/whatsapp/ConnectWhatsApp'
import { NumberAvatar, NumberPage } from '@/app/whatsapp/NumberPage'
import { statusHelp } from '@/app/whatsapp/profileRules'
import { can } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { TEXT_SM, TEXT_XS } from '@/app/lib/text'

const QUALITY: Record<string, string> = { GREEN: 'bg-success', YELLOW: 'bg-amber-500', RED: 'bg-destructive' }
const limitText = (l: string | null) => (l ? l.replace('TIER_', '').replace('UNLIMITED', 'Unlimited') : '—')

/** Every WhatsApp number of the workspace, like WhatsApp Manager's phone-number list. One number
 *  opens straight away; none shows how to connect one. */
export function WhatsAppPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { me } = useAuth()
  const [rows, setRows] = useState<WaNumber[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [config, setConfig] = useState<SignupConfig | null>(null)

  const load = useCallback((refresh = false) => {
    setRefreshing(refresh)
    setError(null)
    listNumbers(refresh)
      .then((r) => {
        setRows(r)
        if (r.length === 1) setOpen((o) => o ?? r[0].id)
      }, (err) => setError(errorDetail(err)))
      .finally(() => setRefreshing(false))
  }, [])
  useEffect(() => load(), [load])
  useEffect(() => {
    if (rows?.length === 0) getSignupConfig().then(setConfig, () => {})
  }, [rows])

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      {open ? (
        <NumberPage key={open} id={open} showBack={(rows?.length ?? 0) > 1} onBack={() => (setOpen(null), load())} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1>WhatsApp</h1>
              <p className="mt-1 text-muted-foreground">Your numbers, their profiles, names and settings, as customers see them on WhatsApp.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => load(true)} disabled={refreshing}>
                {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Refresh from WhatsApp
              </Button>
              {can(me?.role, 'whatsapp.manage') && (
                <Button variant="outline" onClick={onOpenSettings}>
                  Connect a number
                </Button>
              )}
            </div>
          </div>
          {error ? (
            <div className="space-y-2">
              <FormError>{error}</FormError>
              <Button variant="outline" onClick={() => load()}>
                Try again
              </Button>
            </div>
          ) : !rows ? (
            <p className="flex items-center gap-2 text-muted-foreground" style={TEXT_SM}>
              <Loader2 className="size-4 animate-spin" /> Reading your numbers from WhatsApp&hellip;
            </p>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-border p-6">
              <ConnectWhatsApp config={config} isOwner={can(me?.role, 'whatsapp.manage')} workspaceName={me?.workspace?.name ?? 'this workspace'} variant="compact" onConnected={() => load(true)} />
            </div>
          ) : (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>Daily limit</TableHead>
                    <TableHead>Account</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((n) => {
                    const st = statusHelp(n.status)
                    return (
                      <TableRow key={n.id} className="cursor-pointer" onClick={() => setOpen(n.id)}>
                        <TableCell>
                          <button type="button" className="flex items-center gap-3 text-left" onClick={() => setOpen(n.id)}>
                            <NumberAvatar photo={n.photo} name={n.verifiedName} size="sm" />
                            <span>
                              <span className="block" style={{ fontWeight: 'var(--font-weight-medium)' }}>
                                {n.verifiedName || n.display}
                              </span>
                              <span className="block text-muted-foreground" style={TEXT_XS}>
                                {n.display}
                                {n.newNameStatus === 'PENDING_REVIEW' && ` · "${n.newName}" in review`}
                              </span>
                            </span>
                          </button>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5" style={TEXT_SM} title={st.help}>
                            <span className={cn('size-2 rounded-full', st.tone === 'ok' ? 'bg-success' : st.tone === 'warn' ? 'bg-amber-500' : 'bg-destructive')} />
                            {st.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={cn('inline-block size-2 rounded-full', QUALITY[n.quality] ?? 'bg-muted-foreground')} title={n.quality} />
                        </TableCell>
                        <TableCell style={TEXT_SM}>{limitText(n.limit)}</TableCell>
                        <TableCell className="text-muted-foreground" style={TEXT_SM}>
                          {n.wabaName}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
