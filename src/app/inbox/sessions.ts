// A chat is one long thread per customer; WhatsApp bills and allows free replies per 24-hour window
// that each customer message opens. A "session" here is one such stretch: it starts with a customer
// message that came more than 24 hours after their previous one (or their first ever).
export interface SessionStart {
  n: number
  at: string
}

const DAY = 86_400_000

/** Message id → the session it starts. Messages that don't start one are absent. */
export function sessionStarts(messages: { id: string; at: string; author: string; kind?: string }[]): Map<string, SessionStart> {
  const out = new Map<string, SessionStart>()
  let lastCustomer = -Infinity
  let n = 0
  for (const m of messages) {
    if (m.author !== 'customer') continue
    const t = Date.parse(m.at)
    if (t - lastCustomer > DAY) out.set(m.id, { n: ++n, at: m.at })
    lastCustomer = t
  }
  return out
}
