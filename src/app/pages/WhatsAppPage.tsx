import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
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
import { TEXT_SM } from '@/app/lib/text'

const QUALITY: Record<string, string> = { GREEN: 'bg-success', YELLOW: 'bg-amber-500', RED: 'bg-destructive' }
const limitText = (l: string | null) => (l ? l.replace('TIER_', '').replace('UNLIMITED', 'Unlimited') : '—')

const ACCOUNT_KEY = 'helo-whatsapp-account'
const readAccount = () => {
  try {
    return localStorage.getItem(ACCOUNT_KEY)
  } catch {
    return null
  }
}

/** The workspace's numbers the way WhatsApp Manager shows them: pick the WhatsApp Business account,
 *  see its phone numbers, open one for its profile, name and settings. None shows how to connect one. */
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
      }, (err) => setError(errorDetail(err)))
      .finally(() => setRefreshing(false))
  }, [])
  useEffect(() => load(), [load])

  // The accounts, from the numbers they hold. The chosen one is remembered in this browser.
  const accounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>()
    for (const n of rows ?? []) {
      const a = m.get(n.wabaId) ?? { id: n.wabaId, name: n.wabaName || n.wabaId, count: 0 }
      a.count++
      m.set(n.wabaId, a)
    }
    return [...m.values()]
  }, [rows])
  const [chosen, setChosen] = useState<string | null>(readAccount)
  const account = accounts.find((a) => a.id === chosen) ?? accounts[0]
  const choose = (id: string) => {
    setChosen(id)
    try {
      localStorage.setItem(ACCOUNT_KEY, id)
    } catch {
      // a blocked store just means the choice isn't remembered
    }
  }
  const shown = account ? (rows ?? []).filter((n) => n.wabaId === account.id) : []
  useEffect(() => {
    if (rows?.length === 0) getSignupConfig().then(setConfig, () => {})
  }, [rows])

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      {open ? (
        <NumberPage key={open} id={open} showBack backLabel={account ? `All numbers in ${account.name}` : 'All numbers'} onBack={() => (setOpen(null), load())} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1>WhatsApp</h1>
              <p className="mt-1 text-muted-foreground">Your numbers, their profiles, names and settings, as customers see them on WhatsApp.</p>
              {account && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-sm">
                    WhatsApp Business account
                  </span>
                  {accounts.length > 1 ? (
                    <Select value={account.id} onValueChange={choose}>
                      <SelectTrigger className="h-9 min-w-56" aria-label="WhatsApp Business account">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} · {a.count} number{a.count === 1 ? '' : 's'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="rounded-md border border-border px-3 py-1.5" style={{ ...TEXT_SM, fontWeight: 'var(--font-weight-medium)' }}>
                      {account.name}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
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
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> Reading your numbers from WhatsApp&hellip;
            </p>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-border p-6">
              <ConnectWhatsApp config={config} isOwner={can(me?.role, 'whatsapp.manage')} workspaceName={me?.workspace?.name ?? 'this workspace'} variant="compact" onConnected={() => load(true)} />
            </div>
          ) : (
            <div className="space-y-2">
              <h2 className="text-base font-semibold">
                Phone numbers in {account?.name} ({shown.length})
              </h2>
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Quality</TableHead>
                      <TableHead>Daily limit</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((n) => {
                      const st = statusHelp(n.status)
                      return (
                        <TableRow key={n.id} className="cursor-pointer" onClick={() => setOpen(n.id)}>
                          <TableCell>
                            <button type="button" className="flex items-center gap-3 text-left" onClick={(e) => (e.stopPropagation(), setOpen(n.id))} aria-label={`Open ${n.verifiedName || n.display}`}>
                              <NumberAvatar photo={n.photo} name={n.verifiedName} size="sm" />
                              <span>
                                <span className="block font-medium">
                                  {n.verifiedName || n.display}
                                </span>
                                <span className="block text-muted-foreground text-xs">
                                  {n.display}
                                  {n.newNameStatus === 'PENDING_REVIEW' && ` · "${n.newName}" in review`}
                                </span>
                              </span>
                            </button>
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-sm" title={st.help}>
                              <span className={cn('size-2 rounded-full', st.tone === 'ok' ? 'bg-success' : st.tone === 'warn' ? 'bg-amber-500' : 'bg-destructive')} />
                              {st.label}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-sm">
                              <span className={cn('inline-block size-2 rounded-full', QUALITY[n.quality] ?? 'bg-muted-foreground')} />
                              {n.quality === 'GREEN' ? 'High' : n.quality === 'YELLOW' ? 'Medium' : n.quality === 'RED' ? 'Low' : '—'}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{limitText(n.limit)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            <ChevronRight className="size-4" />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
