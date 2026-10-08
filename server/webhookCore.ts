// The parts of receiving Meta's webhooks that are plain logic, kept apart so they can be tested:
// which app signed an event, whether a delivery status may replace another, and what an event
// says a message cost. Imports nothing from the app.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Index of the app secret that signed `raw` (X-Hub-Signature-256), or null when none did. */
export function signedBy(raw: Buffer, header: string | undefined, secrets: string[]): number | null {
  const got = Buffer.from(String(header ?? ''))
  for (const [i, secret] of secrets.entries()) {
    const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'))
    if (got.length === expected.length && timingSafeEqual(got, expected)) return i
  }
  return null
}

/** One id per delivery: Meta's retries of the same body share it, so they're stored once. */
export const deliveryId = (raw: Buffer) => createHash('sha256').update(raw).digest('hex')

/** Statuses only move forward (sent → delivered → read); failed is final. Late or repeated
 *  deliveries never move a message back. Returns the statuses a message may have now for `next` to apply. */
const ORDER = ['sent', 'delivered', 'read'] as const
export function replaceable(next: string): (string | null)[] | null {
  if (next === 'failed') return [null, 'sent', 'delivered', 'read']
  const i = ORDER.indexOf(next as (typeof ORDER)[number])
  return i < 0 ? null : [null, ...ORDER.slice(0, i)]
}

export interface Charge {
  waMessageId: string
  phone: string
  status: string
  at: Date
  billable: boolean | null
  pricingModel: string | null
  category: string | null
  type: string | null
  conversationId: string | null
  conversationOrigin: string | null
  conversationExpiresAt: Date | null
}
type Obj = Record<string, unknown>
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const s = (v: unknown) => (typeof v === 'string' && v ? v : null)
const secondsToDate = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : new Date(Number(v) * 1000))

/** What a status event says the message cost, when it carries pricing (null otherwise). */
export function chargeOf(status: Obj): Charge | null {
  const pricing = o(status.pricing)
  const conv = o(status.conversation)
  if (!Object.keys(pricing).length && !Object.keys(conv).length) return null
  return {
    waMessageId: String(status.id ?? ''),
    phone: String(status.recipient_id ?? ''),
    status: String(status.status ?? ''),
    at: secondsToDate(status.timestamp) ?? new Date(),
    billable: typeof pricing.billable === 'boolean' ? pricing.billable : null,
    pricingModel: s(pricing.pricing_model),
    category: s(pricing.category),
    type: s(pricing.type),
    conversationId: s(conv.id),
    conversationOrigin: s(o(conv.origin).type),
    conversationExpiresAt: secondsToDate(conv.expiration_timestamp),
  }
}
