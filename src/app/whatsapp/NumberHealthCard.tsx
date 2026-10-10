import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { errorDetail } from '@/app/api/meta'
import { getNumberHealth, refreshNumberHealth, type NumberHealth } from '@/app/api/whatsapp'
import { cn } from '@/app/lib/utils'

const QUALITY: Record<string, { label: string; dot: string; help: string }> = {
  GREEN: { label: 'High quality', dot: 'bg-success', help: 'Customers are happy with your messages.' },
  YELLOW: { label: 'Medium quality', dot: 'bg-warning', help: 'Some customers blocked or reported you lately. Send marketing only to people who asked for it.' },
  RED: { label: 'Low quality', dot: 'bg-destructive', help: 'Many customers blocked or reported you. WhatsApp may lower your daily limit; pause marketing broadcasts.' },
}
const NAME: Record<string, string> = { APPROVED: 'Display name approved', PENDING_REVIEW: 'Display name in review', DECLINED: 'Display name declined', EXPIRED: 'Display name review expired', AVAILABLE_WITHOUT_REVIEW: 'Display name approved' }

/** Each number's WhatsApp quality rating, display-name review and the daily limit on new conversations. */
export function NumberHealthCard({ compact }: { compact?: boolean }) {
  const [rows, setRows] = useState<NumberHealth[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getNumberHealth().then(setRows, (err) => setError(errorDetail(err)))
  }, [])
  if (error) return <p className="text-muted-foreground text-xs">Couldn&rsquo;t read number health: {error}</p>
  if (!rows) return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  if (!rows.length) return null
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((r) => {
          const q = QUALITY[r.quality]
          return (
            <li key={r.phoneNumberId} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{r.display}</p>
                <span className="flex items-center gap-1.5 text-xs">
                  <span className={cn('size-2 rounded-full', q?.dot ?? 'bg-muted-foreground')} />
                  {q?.label ?? 'Quality not rated yet'}
                </span>
              </div>
              {!compact && q && q.help && r.quality !== 'GREEN' && <p className="mt-1 text-muted-foreground text-xs">{q.help}</p>}
              <p className="mt-1 text-muted-foreground text-xs">
                {r.limitLabel ? `Can start ${r.limitLabel} new conversations a day` : 'Daily limit not available'}
                {r.nameStatus && NAME[r.nameStatus] ? ` · ${NAME[r.nameStatus]}` : ''}
              </p>
            </li>
          )
        })}
      </ul>
      {!compact && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            refreshNumberHealth()
              .then(setRows, (err) => toast.error(errorDetail(err)))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Check now
        </Button>
      )}
    </div>
  )
}
