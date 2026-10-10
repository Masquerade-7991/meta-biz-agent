import { useEffect, useState } from 'react'
import { listTickets, type Ticket } from '@/app/api/tickets'

/** The chat's open (or waiting) ticket, reloaded whenever `version` moves. */
export function useOpenTicket(phone: string | null, version: number) {
  const [ticket, setTicket] = useState<Ticket | null>(null)
  useEffect(() => {
    if (!phone) return setTicket(null)
    let live = true
    listTickets({ phone }).then(
      (rows) => live && setTicket(rows.find((t) => t.status !== 'resolved') ?? null),
      () => live && setTicket(null),
    )
    return () => {
      live = false
    }
  }, [phone, version])
  return ticket
}
