import { useState } from 'react'
import { AlarmClock, AlertTriangle, Bell, BellRing, Inbox, UserCheck, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { dismissNotice, isAlert, listNotices, type AlertNotice, type Notice } from '@/app/api/tickets'
import { cn } from '@/app/lib/utils'
import { HEADER_ICON_BUTTON } from './headerButton'
import { usePolling } from '@/app/lib/usePolling'

const LIVE_NOTICES = ['ticket.', 'alert.', 'reminder.']

const SEEN_KEY = 'helo-notices-seen'
const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0)
  } catch {
    return 0
  }
}
const ICON = { breached: AlarmClock, due: AlarmClock, assigned: UserCheck, unassigned: Inbox, alert: AlertTriangle, alert_critical: AlertTriangle, reminder: BellRing }

/** Header bell: account alerts (owners), overdue or due-soon SLAs, tickets assigned to you, and tickets nobody has. */
export function NotificationsBell({ onOpenChat, onOpenTarget }: { onOpenChat: (phone: string) => void; onOpenTarget: (target: AlertNotice['target']) => void }) {
  const [items, setItems] = useState<Notice[]>([])
  const [seen, setSeen] = useState(readSeen)
  const [open, setOpen] = useState(false)
  usePolling(() => void listNotices().then(setItems, () => {}), 30_000, [], true, LIVE_NOTICES)
  const fresh = items.filter((n) => Date.parse(n.at) > seen || n.kind === 'breached' || n.kind === 'alert_critical' || n.kind === 'reminder').length
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
        <button type="button" className={HEADER_ICON_BUTTON} aria-label={fresh ? `Notifications, ${fresh} new` : 'Notifications'}>
          <Bell className="size-5" />
          {fresh > 0 && (
            <span className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] leading-4 text-destructive-foreground">
              {fresh}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b border-border px-4 py-3 text-sm font-semibold">
          Notifications
        </p>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground text-sm">
            You&rsquo;re all caught up.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.map((n) => {
              const Icon = ICON[n.kind]
              return (
                <li key={n.id} className="group relative">
                  <button
                    type="button"
                    className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted"
                    onClick={() => {
                      setOpen(false)
                      if (isAlert(n)) onOpenTarget(n.target)
                      else onOpenChat(n.phone)
                    }}
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0', n.kind === 'breached' || n.kind === 'alert_critical' ? 'text-destructive' : n.kind === 'alert' ? 'text-amber-600' : n.kind === 'reminder' ? 'text-primary' : 'text-muted-foreground')} />
                    <span className={cn('text-sm', n.kind.startsWith('alert') || n.kind === 'reminder' ? 'pr-6' : '')}>
                      {n.text}
                    </span>
                  </button>
                  {(isAlert(n) || n.kind === 'reminder') && (
                    <button
                      type="button"
                      aria-label="Dismiss"
                      className="absolute top-2.5 right-2 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => {
                        setItems((xs) => xs.filter((x) => x.id !== n.id))
                        void dismissNotice(n.id).catch(() => {})
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
