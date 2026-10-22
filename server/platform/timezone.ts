// The workspace's time zone (its support hours' zone) for modules outside support, without importing
// support: the composition root (server/app.ts) wires the source once, so no domain cycle appears.
let source: () => Promise<unknown> = async () => 'UTC'

/** Called once by the composition root with how to read the current workspace's time zone. */
export function setTimeZoneSource(fn: () => Promise<unknown>) {
  source = fn
}

/** The current workspace's IANA time zone; UTC when unset, unreadable or not a real zone. */
export async function workspaceTimeZone(): Promise<string> {
  try {
    const tz = String((await source()) || 'UTC')
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/** How far `tz`'s wall clock is ahead of UTC at instant `t`, in ms. */
function offsetAt(tz: string, t: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000
}

/** The month `d` falls in within `tz`: its label (YYYY-MM) and the instant it began. */
export function monthIn(tz: string, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]))
  const wall = Date.UTC(+p.year, +p.month - 1, 1)
  // Twice: the offset at the guessed instant can differ from the one at the real start (DST).
  const start = wall - offsetAt(tz, wall - offsetAt(tz, wall))
  return { month: `${p.year}-${p.month}`, start: new Date(start) }
}
