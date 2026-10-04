import { useState } from 'react'
import { AlarmClock, Bell, Inbox, UserCheck } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { listNotices, type Notice } from '@/app/api/tickets'
import { cn } from '@/app/lib/utils'
import { usePolling } from '@/app/lib/usePolling'

const LIVE_TICKETS = ['ticket.']

const SEEN_KEY = 'helo-notices-seen'
const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0)
  } catch {
    return 0
  }
}
const ICON = { breached: AlarmClock, due: AlarmClock, assigned: UserCheck, unassigned: Inbox }

/** Header bell: overdue or due-soon SLAs, tickets assigned to you, and tickets nobody has. */
export function NotificationsBell({ onOpenChat }: { onOpenChat: (phone: string) => void }) {
  const [items, setItems] = useState<Notice[]>([])
  const [seen, setSeen] = useState(readSeen)
  const [open, setOpen] = useState(false)
  usePolling(() => void listNotices().then(setItems, () => {}), 30_000, [], true, LIVE_TICKETS)
  const fresh = items.filter((n) => Date.parse(n.at) > seen || n.kind === 'breached').length
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) return
        const now = Date.now()
        setSeen(now)
        try {
          localStorage.setItem(SEEN_KEY, String(now))
        } catch {
          // private mode: the badge just resets on reload
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="relative rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={fresh ? `Notifications, ${fresh} new` : 'Notifications'}>
          <Bell className="size-4" />
          {fresh > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-destructive-foreground" style={{ fontSize: '0.625rem', lineHeight: '1rem' }}>
              {fresh}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b border-border px-4 py-3" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semi-bold)' }}>
          Notifications
        </p>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            You&rsquo;re all caught up.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.map((n) => {
              const Icon = ICON[n.kind]
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted"
                    onClick={() => {
                      setOpen(false)
                      onOpenChat(n.phone)
                    }}
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0', n.kind === 'breached' ? 'text-destructive' : 'text-muted-foreground')} />
                    <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.4 }}>{n.text}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
