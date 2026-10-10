import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/app/lib/utils'

const DAY = 86_400_000
const left = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

/** How long free replies stay allowed: 24 hours from the customer's last message. Amber in the last hour. */
export function WindowChip({ lastInboundAt }: { lastInboundAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const ms = lastInboundAt ? Date.parse(lastInboundAt) + DAY - now : -1
  const closing = ms > 0 && ms < 3_600_000
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded px-1.5', ms <= 0 ? 'bg-muted text-muted-foreground' : closing ? 'bg-warning/15 text-warning-foreground' : 'bg-success/15 text-foreground')}
      style={{ fontSize: '0.6875rem', lineHeight: '1.125rem' }}
      title="WhatsApp allows free-form replies for 24 hours after the customer’s last message. After that, only approved templates."
    >
      <Clock className="size-3" />
      {ms <= 0 ? 'Reply window closed' : `Free replies for ${left(ms)}`}
    </span>
  )
}
