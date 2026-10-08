// The business's own WhatsApp setup is never changed from this console: which apps receive its
// webhooks (subscribed_apps), where they're sent (override_callback_uri, webhook_configuration),
// the number's registration and two-step PIN, verification codes, coexistence sync and billing
// lines. Reading it, and configuring the Meta Business Agent, stay allowed.
//
// Protected: the server's own account from .env (WABA_ID, PHONE_NUMBER_ID, BUSINESS_ID and every
// number the console learns it has), plus anything in PROTECTED_IDS. callUpstream (upstream.ts)
// asks refusal() before every call to Meta, so the relay and every server module are covered.
// Imports nothing from the app, so upstream.ts can use it without a cycle.

const ids = new Set<string>()
export const addProtected = (...list: (string | undefined | null)[]) => {
  for (const id of list) if (id && /^\d+$/.test(id)) ids.add(id)
}
export const isProtected = (id: string | undefined | null) => !!id && ids.has(id)
/** Test hook. */
export const clearProtected = () => ids.clear()

/** Paths that change who gets the account's webhooks, or the number's registration, PIN or codes. */
const RISKY_PATH = /\/(subscribed_apps|register|deregister|request_code|verify_code|smb_app_data|whatsapp_credit_sharing_and_attach)(\/|\?|$)/
/** Body or query fields that move or rewire webhooks, or set a PIN. */
const RISKY_FIELD = /override_callback_uri|webhook_configuration|"pin"\s*:|[?&]pin=/

/** Why this call must not reach Meta, or null when it may. `path` is resolved (real ids). */
export function refusal(kind: 'meta' | 'graph', method: string, path: string, body?: Buffer | string): string | null {
  if (method === 'GET' || method === 'HEAD' || kind !== 'graph') return null
  const [p, query = ''] = path.split('?')
  const named = [...(p.match(/\d{6,}/g) ?? []), ...(query.match(/(?:^|&)waba_id=(\d+)/)?.slice(1) ?? [])]
  if (!named.some(isProtected)) return null
  const text = `${path} ${body ? String(body) : ''}`
  if (RISKY_PATH.test(path) || RISKY_FIELD.test(text))
    return 'This WhatsApp account is managed by Helo.ai: its webhooks, registration and PIN can’t be changed from this console.'
  return null
}
