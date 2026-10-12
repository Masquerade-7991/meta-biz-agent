// Messages Meta's Embedded Signup popup posts to our window (v4). Only facebook.com origins count.

export type SignupEvent =
  /** phoneNumberId is '' when Meta connected only the account (FINISH_ONLY_WABA). */
  | { kind: 'finish'; flow: 'new' | 'coexistence'; wabaId: string; phoneNumberId: string; businessId: string }
  | { kind: 'cancel'; step: string }
  | { kind: 'error'; message: string; code: string; sessionId: string }

/** null when the message isn't from the signup (other frames post messages too). */
export function parseSignupEvent(origin: string, data: unknown): SignupEvent | null {
  let host = ''
  try {
    host = new URL(origin).hostname
  } catch {
    return null
  }
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return null
  let m: { type?: string; event?: string; data?: Record<string, unknown> }
  try {
    m = typeof data === 'string' ? JSON.parse(data) : (data as typeof m)
  } catch {
    return null
  }
  if (m?.type !== 'WA_EMBEDDED_SIGNUP') return null
  const d = m.data ?? {}
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')
  if (m.event === 'FINISH' || m.event === 'FINISH_ONLY_WABA' || m.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING')
    return { kind: 'finish', flow: m.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ? 'coexistence' : 'new', wabaId: s('waba_id'), phoneNumberId: s('phone_number_id'), businessId: s('business_id') }
  if (m.event === 'ERROR' || (m.event === 'CANCEL' && d.error_message)) return { kind: 'error', message: s('error_message') || 'Something went wrong in Meta’s signup.', code: s('error_code'), sessionId: s('session_id') }
  if (m.event === 'CANCEL') return { kind: 'cancel', step: s('current_step') }
  return null
}

/** Meta's step codes in plain words (others are read as they are, lowercased). */
const STEP_WORDS: Record<string, string> = {
  LOGIN: 'logging in',
  BUSINESS_ACCOUNT_SELECTION: 'choosing the business',
  WABA_PHONE_PROFILE_PICKER: 'choosing the WhatsApp account and number',
  PHONE_NUMBER_SETUP: 'adding the phone number',
  PHONE_NUMBER_VERIFICATION: 'verifying the phone number',
  PERMISSIONS: 'reviewing permissions',
}
export const stepWords = (step: string) => STEP_WORDS[step] ?? step.toLowerCase().replace(/_/g, ' ')

/** What to tell the person when Meta's signup ends without connecting anything. */
export function signupMessage(ev: Exclude<SignupEvent, { kind: 'finish' }>): string {
  if (ev.kind === 'cancel') return `You left Meta’s signup${ev.step ? ` while ${stepWords(ev.step)}` : ''}. Nothing was connected.`
  return `Meta stopped the signup: ${ev.message}${ev.sessionId ? ` (reference ${ev.sessionId})` : ''}`
}
