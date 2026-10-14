// Keeps a failing Meta from taking requests down with it, and keeps this process from flooding it.
// Circuit breaker, one per kind of call (meta: the agent API; graph): 5 failures in a row (no
// answer, or a 5xx) within 30 s open it for BREAKER_OPEN_MS (20 s), and calls fail at once instead
// of each waiting on a timeout. The open state is shared through locks.ts, so every instance backs
// off together; when it expires calls flow again, and one more failure re-opens it (half-open).
// Bulkhead: at most 8 calls in flight per process, up to 64 waiting, then a 503.
import { env } from './env.ts'
import { HttpError } from './http.ts'
import { isLocked, tryLock } from './locks.ts'

const OPEN_MS = Number(env('BREAKER_OPEN_MS')) || 20_000
const THRESHOLD = 5
const WINDOW_MS = 30_000
const IN_FLIGHT = 8
const WAITING = 64

class BreakerOpen extends Error {
  constructor(kind: string) {
    super(`Meta is not answering (${kind} calls are paused for a moment after repeated failures).`)
    this.name = 'BreakerOpen'
  }
}

const fails = new Map<string, number[]>()
const openUntil = new Map<string, number>() // this process's view; the lock is the shared one
const checkedAt = new Map<string, number>()

/** Throws BreakerOpen when calls of this kind are paused, here or on another instance. */
export async function guard(kind: string): Promise<void> {
  const now = Date.now()
  if ((openUntil.get(kind) ?? 0) > now) throw new BreakerOpen(kind)
  // Other instances' verdict, looked up at most once a second.
  if (now - (checkedAt.get(kind) ?? 0) > 1000) {
    checkedAt.set(kind, now)
    if (await isLocked(`breaker:${kind}`)) {
      openUntil.set(kind, now + 1000)
      throw new BreakerOpen(kind)
    }
  }
}

/** One call's outcome. `ok` is any answer below 500: a 4xx is Meta working, not Meta down. */
export function record(kind: string, ok: boolean): void {
  if (ok) {
    fails.delete(kind)
    return
  }
  const now = Date.now()
  const list = (fails.get(kind) ?? []).filter((t) => t > now - WINDOW_MS)
  list.push(now)
  fails.set(kind, list)
  if (list.length >= THRESHOLD) {
    openUntil.set(kind, now + OPEN_MS)
    void tryLock(`breaker:${kind}`, OPEN_MS).catch(() => null)
    console.log(`${kind}: circuit open for ${OPEN_MS / 1000}s after ${THRESHOLD} failures in a row`)
  }
}

export const breakerState = (kind: string): 'open' | 'closed' => ((openUntil.get(kind) ?? 0) > Date.now() ? 'open' : 'closed')

/** Only for tests: forget every failure and open circuit. */
export function resetBreakers(): void {
  fails.clear()
  openUntil.clear()
  checkedAt.clear()
}

let inFlight = 0
const waiters: (() => void)[] = []
/** A seat for one upstream call; returns the function that gives it back. */
export async function acquire(): Promise<() => void> {
  if (inFlight >= IN_FLIGHT) {
    if (waiters.length >= WAITING) throw new HttpError(503, 'Too many calls to Meta are in flight. Try again in a moment.')
    await new Promise<void>((seat) => waiters.push(seat))
  }
  inFlight++
  let released = false
  return () => {
    if (released) return
    released = true
    inFlight--
    waiters.shift()?.()
  }
}
export const inFlightCount = () => inFlight
