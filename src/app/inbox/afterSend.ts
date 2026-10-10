import { listTickets, resolveTicket, updateTicket, type Ticket } from '@/app/api/tickets'
import { setChatControl } from '@/app/api/inbox'
import type { CannedActions } from './macros'

/** What to do with the ticket once a reply is sent: from the split Send button or a macro. */
export async function afterSend(phone: string, known: Ticket | null, a: CannedActions) {
  // The reply itself may have opened the ticket (the server opens one on a team reply), so look again.
  const ticket = known ?? (await listTickets({ phone })).find((t) => t.status !== 'resolved') ?? null
  if (!ticket && (a.status || a.priority || a.tags?.length)) throw new Error('This chat has no open ticket to update.')
  if (ticket) {
    const patch: Parameters<typeof updateTicket>[1] = {}
    if (a.priority) patch.priority = a.priority
    if (a.tags?.length) patch.tags = [...new Set([...ticket.tags, ...a.tags])]
    if (a.status === 'pending') patch.status = 'pending'
    if (Object.keys(patch).length) await updateTicket(ticket.number, patch)
    // Resolving asks for feedback (when it's on) and gives the chat back to the AI.
    if (a.status === 'resolved') return resolveTicket(ticket.number, { resolution: '', askFeedback: true, handBack: true })
  }
  if (a.handBack) await setChatControl(phone, 'release')
}
