import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Ban, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { blockUser, listBlocked, unblockUser } from '@/app/api/numbers'
import { can } from '@/app/lib/permissions'
import { SearchInput } from '@/app/components/Filters'
import { useForcedFailure } from './useForcedFailure'
import type { TabProps } from './NumberPage'

/** People this number won't hear from. WhatsApp only blocks someone who wrote in the last 24 hours. */
export function BlockedTab({ detail }: TabProps) {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'numbers.edit')
  const failNext = useForcedFailure()
  const id = detail.number.id
  const [rows, setRows] = useState<{ user: string }[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [user, setUser] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setLoadError(null)
    listBlocked(id).then(setRows, (err) => setLoadError(errorDetail(err)))
  }, [id])
  useEffect(() => {
    if (canEdit) load()
  }, [canEdit, load])

  if (!canEdit)
    return (
      <p className="text-muted-foreground text-sm">
        Owners and admins manage who&rsquo;s blocked.
      </p>
    )
  const shown = rows?.filter((r) => r.user.includes(q.replace(/\D/g, ''))) ?? []

  return (
    <div className="max-w-2xl space-y-6">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          setBusy('block')
          setError(null)
          Promise.resolve()
            .then(() => (failNext(), blockUser(id, user)))
            .then(() => {
              toast.success('Blocked. They can’t message this number any more.')
              setUser('')
              load()
            }, (err) => setError(errorDetail(err)))
            .finally(() => setBusy(null))
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Input className="w-64" value={user} onChange={(e) => setUser(e.target.value)} placeholder="+91 98765 43210" aria-label="Number to block" inputMode="tel" />
          <Button type="submit" variant="outline" disabled={!!busy || user.replace(/\D/g, '').length < 8}>
            {busy === 'block' ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
            Block
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          WhatsApp only lets you block someone who messaged this number in the last 24 hours. You can also block from a chat in the Inbox.
        </p>
        {error && <FormError>{error}</FormError>}
      </form>
      {loadError ? (
        <div className="space-y-2">
          <FormError>{loadError}</FormError>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : !rows ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
          Nobody is blocked on this number.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.length > 8 && <SearchInput value={q} onChange={setQ} placeholder="Search blocked numbers" label="Search blocked numbers" />}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shown.map((r) => (
              <li key={r.user} className="flex items-center justify-between px-4 py-2 text-sm">
                +{r.user}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => {
                    setBusy(r.user)
                    Promise.resolve()
                      .then(() => (failNext(), unblockUser(id, r.user)))
                      .then(() => (toast.success('Unblocked.'), load()), (err) => toast.error(errorDetail(err)))
                      .finally(() => setBusy(null))
                  }}
                >
                  {busy === r.user && <Loader2 className="size-4 animate-spin" />} Unblock
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
