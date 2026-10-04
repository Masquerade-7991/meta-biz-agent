// Who a WhatsApp customer is. Since WhatsApp usernames (June 2026) a customer may hide their phone
// number; Meta then names them by a business-scoped user ID (BSUID), e.g. "US.13491208655302741918"
// (country code, dot, up to 128 letters/digits; parent BSUIDs add ".ENT"). Every chat, contact,
// ticket and broadcast recipient is keyed by the customer's phone number when known, else their BSUID.
// Shared by the server (keys, sending) and the browser (labels).

const BSUID = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/

export const isBsuid = (key: string) => BSUID.test(key)

/** The key to store a customer under: digits of the phone number when there is one, else the BSUID; '' if neither. */
export function customerKey(phone: unknown, bsuid?: unknown): string {
  const p = String(phone ?? '').replace(/\D/g, '')
  if (p) return p
  const b = String(bsuid ?? '').trim()
  return isBsuid(b) ? b : ''
}

/** A key typed or taken from a URL: a BSUID as is, otherwise the digits of a phone number. */
export const parseCustomerKey = (v: string) => (isBsuid(v.trim()) ? v.trim() : v.replace(/\D/g, ''))

/** The Cloud API send field for a customer: `to` for a phone number, `recipient` for a BSUID. */
export const sendTarget = (key: string): { to: string } | { recipient: string } => (isBsuid(key) ? { recipient: key } : { to: key })

/** How to show a customer who has no saved name: +phone, @username, or a plain description. */
export function customerLabel(key: string, username?: string | null): string {
  if (!isBsuid(key)) return `+${key}`
  return username ? `@${username}` : 'WhatsApp user (number hidden)'
}

/** Meta's thread control takes a phone number (its BSUID field is "accepted but not yet wired"),
 *  so these chats can't move between the AI agent and people yet. */
export const NO_CONTROL_HIDDEN = 'This customer hides their phone number, and WhatsApp doesn’t yet let apps move these chats between the AI agent and people.'
