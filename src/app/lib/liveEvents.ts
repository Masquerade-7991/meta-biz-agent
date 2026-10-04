// One shared connection to GET /api/stream (server/stream.ts) for the whole tab. Screens subscribe
// to the event kinds they show and refresh when one arrives. Polling stays as the fallback, so a
// dropped stream (or dummy mode, which has no server) only means updates come on the timer.
import { isDummyMode } from '@/app/api/dummy'

export interface LiveEvent {
  /** Dotted name from the server's trace(): 'message.added', 'ticket.updated', 'broadcast.progress'… */
  kind: string
  entity?: string
  entityId?: string
  data: Record<string, unknown>
  at: string
  traceId?: string
}
type Listener = (e: LiveEvent) => void

const listeners = new Set<Listener>()
let source: EventSource | null = null

function connect() {
  if (source || isDummyMode() || typeof EventSource === 'undefined') return
  source = new EventSource('/api/stream')
  source.onmessage = (m) => {
    let e: LiveEvent
    try {
      e = JSON.parse(m.data as string) as LiveEvent
    } catch {
      return
    }
    for (const l of listeners) l(e)
  }
  // EventSource retries by itself (the server asks for 5 s); a 401 after logout closes it for good.
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) source = null
  }
}

/** Calls `fn` for each live event; returns the unsubscribe. The connection closes with the last listener. */
export function onLiveEvent(fn: Listener): () => void {
  listeners.add(fn)
  connect()
  return () => {
    listeners.delete(fn)
    if (!listeners.size) {
      source?.close()
      source = null
    }
  }
}

/** `prefixes` match the start of the kind: ['ticket.', 'message.added'] */
export const matchesKind = (kind: string, prefixes: readonly string[]) => prefixes.some((p) => kind.startsWith(p))
