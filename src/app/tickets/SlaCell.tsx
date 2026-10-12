import { slaText, type Ticket } from '@/app/api/tickets'
import { cn } from '@/app/lib/utils'

/** The ticket's deadline in words, red when overdue, darker when under 30 minutes. */
export function SlaCell({ t }: { t: Pick<Ticket, 'sla' | 'status'> }) {
  const due = t.sla.at ? Date.parse(t.sla.at) - Date.now() : null
  return (
    <span className={cn('text-xs tabular-nums', t.sla.breached ? 'font-semibold text-destructive' : due !== null && due < 30 * 60_000 ? 'text-foreground' : 'text-muted-foreground')}>
      {slaText(t)}
    </span>
  )
}
