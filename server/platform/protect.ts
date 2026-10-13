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
const RISKY_PATH = /\/(subscribed_apps|register|deregister|request_code|verify_code|smb_app_data|whatsapp_credit_sharing_and_attach)(\/|\?|$)/i
/** Body or query fields that move or rewire webhooks, or set a PIN (JSON, query or form body). */
const RISKY_FIELD = /override_callback_uri|webhook_configuration|"pin"\s*:|[?&]pin=/i
const FORM_PIN = /(^|&)pin=/i

/** Why this call must not reach Meta, or null when it may. `path` is resolved (real ids). */
export function refusal(kind: 'meta' | 'graph', method: string, path: string, body?: Buffer | string): string | null {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || kind !== 'graph') return null
  const [p] = path.split('?')
  // A write must name the object it changes: batch requests (POST /) and other root calls would
  // carry the real target in their body, out of sight of every check here.
  if (!/^\/\d{6,}(\/|$)/.test(p)) return 'Graph writes from this console must name one WhatsApp object in the path.'
  const text = `${path} ${body ? String(body) : ''}`
  // Any protected id anywhere: in the path, the query, or the body (e.g. a waba_id field).
  if (![...text.matchAll(/\d{6,}/g)].some((x) => isProtected(x[0]))) return null
  const formBody = body && !String(body).trimStart().startsWith('{') && FORM_PIN.test(String(body))
  if (RISKY_PATH.test(path) || RISKY_FIELD.test(text) || formBody)
    return 'This WhatsApp account is managed by Helo.ai: its webhooks, registration and PIN can’t be changed from this console.'
  return null
}
