// Why a WhatsApp message didn't go out, from Meta's error code (Cloud API error codes reference),
// in words a business owner can act on: the line the Inbox shows when a reply didn't go out.

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
  | 'other'

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
