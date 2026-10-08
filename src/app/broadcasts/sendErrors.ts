// Why a WhatsApp message didn't go out, from Meta's error code (Cloud API error codes reference),
// in words a business owner can act on. Shared by the server (what to record, what to retry) and the
// browser (how failures are grouped in a broadcast report).

export type FailureReason =
  | 'marketing_limit'
  | 'stopped_marketing'
  | 'not_on_whatsapp'
  | 'test_number'
  | 'outside_window'
  | 'too_fast'
  | 'template_problem'
  | 'account_problem'
  | 'meta_down'
  | 'opted_out'
  | 'no_phone'
  | 'other'

/** Headline per reason, for the broadcast report. */
export const FAILURE_LABEL: Record<FailureReason, string> = {
  marketing_limit: 'Meta’s daily marketing limit for this person',
  stopped_marketing: 'Turned off marketing messages from you in WhatsApp',
  not_on_whatsapp: 'Not on WhatsApp, or their app is too old',
  test_number: 'Test number: this recipient isn’t verified for it',
  outside_window: 'Outside the 24-hour reply window',
  too_fast: 'Sent too fast; WhatsApp asked to slow down',
  template_problem: 'Template problem (paused, not approved or wrong values)',
  account_problem: 'Your WhatsApp account needs attention (billing, policy or registration)',
  meta_down: 'WhatsApp was unavailable',
  opted_out: 'Opted out of your broadcasts',
  no_phone: 'Hides their phone number (login codes need one)',
  other: 'Other errors',
}

/** What to do about each reason: shown under the headline. */
export const FAILURE_HELP: Partial<Record<FailureReason, string>> = {
  marketing_limit: 'WhatsApp caps how many marketing messages one person gets from all businesses in a day. We try again in 24 hours, up to twice.',
  stopped_marketing: 'They can turn marketing back on from your chat in WhatsApp. Utility messages still reach them.',
  test_number: 'Meta test numbers can only message up to 5 verified recipients. Add the phone under WhatsApp → API Setup → To in the Meta app that owns the number, or use a real number.',
  outside_window: 'Only templates can start a conversation. Send a template instead.',
  too_fast: 'We retry these automatically after a short wait.',
  template_problem: 'Check the template in Broadcasts → Templates, or in WhatsApp Manager.',
  account_problem: 'Open WhatsApp Manager to fix billing, display name or policy issues, then send again.',
}

const CODES: Record<number, FailureReason> = {
  131049: 'marketing_limit',
  131050: 'stopped_marketing',
  131026: 'not_on_whatsapp',
  131047: 'outside_window',
  131030: 'test_number',
  4: 'too_fast',
  80007: 'too_fast',
  130429: 'too_fast',
  131056: 'too_fast',
  132000: 'template_problem',
  132001: 'template_problem',
  132005: 'template_problem',
  132007: 'template_problem',
  132012: 'template_problem',
  132015: 'template_problem',
  132016: 'template_problem',
  368: 'account_problem',
  131031: 'account_problem',
  131037: 'account_problem',
  131042: 'account_problem',
  131045: 'account_problem',
  131048: 'account_problem',
  131057: 'account_problem',
  133010: 'account_problem',
  131000: 'meta_down',
  131016: 'meta_down',
}

export const reasonOf = (code: unknown): FailureReason => (typeof code === 'number' && CODES[code]) || 'other'

/** Retries per reason: the daily cap waits a day (twice at most); throttling waits a minute. */
export const RETRY: Partial<Record<FailureReason, { afterMs: number; max: number }>> = {
  marketing_limit: { afterMs: 24 * 3_600_000, max: 2 },
  too_fast: { afterMs: 60_000, max: 3 },
  meta_down: { afterMs: 5 * 60_000, max: 2 },
}

/** When to try again after this failure, or null to give up. `retries` = retries already made. */
export function retryAt(reason: FailureReason, retries: number, now = Date.now()): Date | null {
  const r = RETRY[reason]
  return r && retries < r.max ? new Date(now + r.afterMs) : null
}

/** One sentence for the chat when WhatsApp couldn't deliver a message (the AI agent's reply or a team
 *  member's), so the Inbox doesn't just show an answer the customer never got. */
export function undeliveredLine(code: unknown, detail?: string | null): string {
  const reason = reasonOf(code)
  const why: Partial<Record<FailureReason, string>> = {
    test_number: 'this is a Meta test number, which can only message up to 5 verified recipients. Add the phone in the Meta app’s WhatsApp → API Setup → To list, or use a real number.',
    outside_window: 'it’s more than 24 hours since the customer last wrote. Send a template to start again.',
    not_on_whatsapp: 'the number isn’t on WhatsApp, or their app is too old.',
    stopped_marketing: 'the customer turned off marketing messages from you.',
    account_problem: 'your WhatsApp account needs attention (billing, policy or registration).',
    too_fast: 'WhatsApp asked to slow down.',
    meta_down: 'WhatsApp was unavailable.',
  }
  const text = why[reason] ?? (detail ? `${detail.replace(/[.\s]+$/, '')}.` : 'WhatsApp gave no reason.')
  return `WhatsApp couldn’t deliver a reply to this customer: ${text}${typeof code === 'number' ? ` (error ${code})` : ''}`
}
