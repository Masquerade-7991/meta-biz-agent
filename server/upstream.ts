// The one way to reach Meta (via Helo.ai's server): used by the relay and the collectors, so
// headers, placeholders and timeouts stay the same for both.
try {
  process.loadEnvFile?.('.env')
} catch {
  // no .env: run on the process environment
}
export const env = (k: string) => (process.env[k] ?? '').trim()

// UPSTREAM=meta → BASE_URL_1 (needs META_TOKEN); anything else → BASE_URL_2 (Helo.ai server).
export const upstream = (env('UPSTREAM') === 'meta' ? env('BASE_URL_1') : env('BASE_URL_2')).replace(/\/+$/, '')
const GRAPH_PREFIX = env('GRAPH_PREFIX').replace(/\/+$/, '')
// Meta Business Agent endpoints live on api.facebook.com, not graph.facebook.com (Graph answers
// "Unknown path components", code 2500). AGENT_BASE_URL points agent calls at a route that reaches
// api.facebook.com; Graph calls (WABA / phone-number lists) keep using the upstream above.
export const agentUpstream = (env('AGENT_BASE_URL') || upstream).replace(/\/+$/, '')
export const ids: Record<string, string> = {
  WABA_ID: env('WABA_ID'),
  PHONE_NUMBER_ID: env('PHONE_NUMBER_ID'),
  BUSINESS_ID: env('BUSINESS_ID'),
}

/** Swaps literal WABA_ID / PHONE_NUMBER_ID / BUSINESS_ID path segments for the .env values. */
export const resolveIds = (rest: string) =>
  rest.replace(/\/(WABA_ID|PHONE_NUMBER_ID|BUSINESS_ID)(?=\/|\?|$)/g, (_, k: string) => '/' + ids[k])

export type Kind = 'meta' | 'graph'
export interface UpstreamReply {
  status: number
  text: string
  contentType: string
}

/** `path` is already resolved (real IDs). Throws on network failure or timeout. */
export async function callUpstream(kind: Kind, method: string, path: string, body?: Buffer, contentType?: string): Promise<UpstreamReply> {
  const headers: Record<string, string> = {}
  // Thread Control is the one endpoint on the 1.0.0 contract; Graph calls send no version.
  if (kind === 'meta') headers['X-API-Version'] = path.includes('/thread_control') ? '1.0.0' : '2.0.0'
  if (contentType) headers['content-type'] = contentType
  if (env('META_TOKEN')) headers.authorization = `Bearer ${env('META_TOKEN')}`
  const target = (kind === 'meta' ? agentUpstream : upstream + GRAPH_PREFIX) + path
  const r = await fetch(target, { method, headers, body, signal: AbortSignal.timeout(20_000) })
  const text = await r.text()
  console.log(`${method} ${target} → ${r.status}`)
  return { status: r.status, text, contentType: r.headers.get('content-type') ?? 'application/json' }
}

export const parseJson = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** GET on the Meta API returning parsed JSON; throws on non-2xx (err.status set) or network failure. */
export async function metaGet<T = Record<string, unknown>>(path: string): Promise<T> {
  const r = await callUpstream('meta', 'GET', path).catch((err: unknown) => Promise.reject(Object.assign(new Error(String(err)), { down: true })))
  if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`HTTP ${r.status} for ${path}`), { status: r.status })
  return parseJson(r.text) as T
}
