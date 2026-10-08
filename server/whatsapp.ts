// Embedded Signup: a business connects its own WhatsApp account from the console.
// The browser runs Meta's signup popup and sends us the one-time code (valid 30 s) plus the IDs it
// picked; we exchange the code for the business's token, then subscribe our app to their WABA,
// register the number (not for WhatsApp Business app numbers, which already are), set up billing
// (Helo.ai's credit line, or the business pays Meta itself) and, for app numbers, start the chat and
// contacts sync. Each step is recorded so a failure can be retried without signing up again.
import type http from 'node:http'
import { randomInt } from 'node:crypto'
import { HttpError, arr, obj, readJson, serveJson, str, type Obj, type Titles } from './http.ts'
import { db, dbOffReason, ws } from './db.ts'
import { runIn } from './context.ts'
import { env, metaJson } from './upstream.ts'
import { allow } from './cache.ts'
import { seal, open } from './crypto.ts'
import { accounts, forgetAssets, tokenKey, type Account, type StepState } from './accounts.ts'
import type { Actor } from './inbox.ts'
import { trace } from './trace.ts'
import { enqueue } from './jobs.ts'
import { isProtected } from './protect.ts'
import { can } from '../src/app/lib/permissions.ts'

type Step = keyof Account['steps']
// The app is the console's own Meta app; APP_ID / APP_SECRET (also used to check webhook
// signatures) count when the META_ names aren't set.
const cfg = () => ({
  appId: env('META_APP_ID') || env('APP_ID'),
  configId: env('META_ES_CONFIG_ID'),
  appSecret: env('META_APP_SECRET') || env('APP_SECRET'),
  creditLineId: env('WA_CREDIT_LINE_ID'),
  creditCurrency: env('WA_CREDIT_CURRENCY') || 'INR',
  sdkVersion: env('META_SDK_VERSION') || 'v23.0',
  graph: (env('GRAPH_BASE_URL') || 'https://graph.facebook.com/v23.0').replace(/\/+$/, ''),
})
/** Signup works only when every piece is in place; the browser is told why not otherwise. */
function missing() {
  const c = cfg()
  return [!c.appId && 'META_APP_ID', !c.configId && 'META_ES_CONFIG_ID', !c.appSecret && 'META_APP_SECRET', !tokenKey() && 'TOKEN_ENCRYPTION_KEY'].filter(Boolean) as string[]
}

const now = (): StepState => ({ state: 'done', at: new Date() })
const failed = (err: unknown): StepState => ({ state: 'failed', at: new Date(), error: err instanceof Error ? err.message : String(err) })

/** Runs `fn` as the business: Meta calls naming its WABA or number use its own token. */
function asBusiness<T>(a: Pick<Account, 'wabaId' | 'businessId' | 'phoneNumbers'>, token: string, fn: () => Promise<T>) {
  const ids = [a.wabaId, a.businessId, ...a.phoneNumbers.map((p) => p.id)].filter(Boolean)
  return runIn(ws(), { wabaId: a.wabaId, phoneNumberId: a.phoneNumbers[0]?.id ?? '', businessId: a.businessId, token, ids: new Set(ids), tokens: new Map(ids.map((id) => [id, token])) }, fn)
}
/** Runs `fn` as Helo.ai (the server's own token), e.g. to share its credit line. */
const asPartner = <T>(fn: () => Promise<T>) => runIn(ws(), null, fn)

/** The code from the popup → this business's token. Must happen within 30 seconds of signup. */
async function exchangeCode(code: string): Promise<string> {
  const c = cfg()
  const q = new URLSearchParams({ client_id: c.appId, client_secret: c.appSecret, code })
  const r = await fetch(`${c.graph}/oauth/access_token?${q}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
  const json = obj(r ? await r.json().catch(() => ({})) : {})
  const token = str(json.access_token)
  if (!r?.ok || !token) {
    const e = obj(json.error)
    throw new HttpError(400, `Meta didn’t accept the signup (${str(e.error_user_msg) ?? str(e.message) ?? 'no token returned'}). Please run the signup again.`)
  }
  return token
}

/** The follow-up steps, in order. Steps already done are skipped, so this also retries. */
async function finish(a: Account & { _id?: unknown }, token: string, flow: 'new' | 'coexistence', pin?: string) {
  const c = cfg()
  const steps = { ...a.steps }
  const billing = { ...a.billing }
  const todo = (s: Step) => steps[s]?.state !== 'done' && steps[s]?.state !== 'skipped'
  const run = async (s: Step, fn: () => Promise<unknown>) => {
    if (!todo(s)) return
    try {
      await fn()
      steps[s] = now()
    } catch (err) {
      steps[s] = failed(err)
    }
  }
  const phoneId = a.phoneNumbers[0]?.id
  await asBusiness(a, token, async () => {
    await run('subscribe', () => metaJson('graph', 'POST', `/${a.wabaId}/subscribed_apps`))
    if (flow === 'coexistence') steps.register ??= { state: 'skipped', at: new Date() }
    else
      await run('register', async () => {
        if (!pin) throw new Error('The number’s PIN is missing; disconnect and connect it again.')
        await metaJson('graph', 'POST', `/${phoneId}/register`, { messaging_product: 'whatsapp', pin })
      })
    if (flow === 'coexistence')
      // Meta allows 24 hours after signup to start these, or the business must sign up again.
      await run('sync', async () => {
        await metaJson('graph', 'POST', `/${phoneId}/smb_app_data`, { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' })
        await metaJson('graph', 'POST', `/${phoneId}/smb_app_data`, { messaging_product: 'whatsapp', sync_type: 'history' })
      })
    else steps.sync ??= { state: 'skipped', at: new Date() }
    await run('details', async () => {
      const w = await metaJson('graph', 'GET', `/${a.wabaId}?fields=name`)
      const nums = await metaJson('graph', 'GET', `/${a.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`)
      a.wabaName = str(w.name) ?? a.wabaName
      const list = arr(nums.data).map(obj)
      if (list.length) a.phoneNumbers = list.map((n) => ({ id: String(n.id), display: str(n.display_phone_number) ?? '', verifiedName: str(n.verified_name) ?? '' }))
    })
  })
  if (billing.mode === 'partner_credit')
    await run('billing', async () => {
      if (!c.creditLineId) throw new Error('Helo.ai’s credit line isn’t configured on this server (WA_CREDIT_LINE_ID).')
      await asPartner(() => metaJson('graph', 'POST', `/${c.creditLineId}/whatsapp_credit_sharing_and_attach?waba_id=${a.wabaId}&waba_currency=${c.creditCurrency}`))
      billing.state = 'shared'
    })
  else if (todo('billing')) {
    // The business adds its own payment method in WhatsApp Manager; it tells us when it's done.
    steps.billing = billing.state === 'confirmed' ? now() : { state: 'failed', at: new Date(), error: 'Add a payment method in WhatsApp Manager, then confirm here.' }
  }
  if (steps.billing?.state === 'failed' && billing.mode === 'partner_credit') billing.state = 'failed'
  return { ...a, steps, billing }
}

const tokenOf = (a: Account) => {
  const key = tokenKey()
  if (!a.tokenEnc || !key) throw new HttpError(400, 'This account’s access can’t be read on this server. Disconnect it and connect again.')
  return open(a.tokenEnc, key)
}
const MANAGED = 'This WhatsApp account is managed by Helo.ai. The console reads it and configures its AI agent, but never changes its webhooks, registration, PIN or billing.'
/** The business's own account (.env) or one listed in PROTECTED_IDS (protect.ts). */
const isManaged = (a: Account) => a.source === 'env' || isProtected(a.wabaId)
const flowOf = (a: Account) => (a.source === 'coexistence' ? 'coexistence' : 'new')

/** What the browser sees: no tokens, no PIN. */
function view(a: Account) {
  const { tokenEnc: _t, pinEnc, workspaceId: _w, ...rest } = a as Account & { _id?: unknown }
  delete (rest as { _id?: unknown })._id
  const steps = Object.fromEntries(Object.entries(a.steps).map(([k, v]) => [k, v]))
  return { ...rest, steps, hasPin: !!pinEnc, protected: isManaged(a), canDisconnect: !isManaged(a), needsAttention: Object.values(a.steps).some((s) => s?.state === 'failed') }
}

async function connect(b: Obj, me: Actor) {
  if (!can(me.role, 'whatsapp.manage')) throw new HttpError(403, 'Only workspace owners can connect WhatsApp accounts.')
  const gaps = missing()
  if (gaps.length) throw new HttpError(503, `Embedded Signup isn’t set up on this server yet (missing ${gaps.join(', ')}).`)
  if (!allow(`wa-connect|${ws()}`, 10)) throw new HttpError(429, 'Too many signup attempts. Try again in an hour.')
  const code = str(b.code)
  const wabaId = String(b.wabaId ?? '').replace(/\D/g, '')
  const phoneId = String(b.phoneNumberId ?? '').replace(/\D/g, '')
  if (!code || !wabaId || !phoneId) throw new HttpError(400, 'The signup didn’t return a WhatsApp account and number. Please run it again.')
  // Signup re-subscribes the app and re-registers the number with a new PIN: never on the business's own account.
  if (isProtected(wabaId) || isProtected(phoneId)) throw new HttpError(403, MANAGED)
  const flow = b.flow === 'coexistence' ? 'coexistence' : 'new'
  const mode = b.billing === 'partner_credit' && cfg().creditLineId ? 'partner_credit' : 'own'
  // The code expires 30 seconds after signup, so it's exchanged before anything else.
  const token = await exchangeCode(code)
  const existing = await accounts().findOne({ wabaId })
  if (existing && existing.workspaceId !== ws()) throw new HttpError(409, 'This WhatsApp account is already connected to another workspace.')
  const pin = flow === 'new' ? String(randomInt(0, 1_000_000)).padStart(6, '0') : undefined
  const key = tokenKey()!
  const base: Account = existing ?? {
    workspaceId: ws(),
    wabaId,
    wabaName: `WhatsApp account ${wabaId}`,
    businessId: String(b.businessId ?? '').replace(/\D/g, ''),
    phoneNumbers: [{ id: phoneId, display: '', verifiedName: '' }],
    source: flow === 'coexistence' ? 'coexistence' : 'signup',
    tokenEnc: null,
    billing: { mode, state: mode === 'partner_credit' ? 'pending' : 'pending' },
    steps: {},
    connectedBy: me._id,
    createdAt: new Date(),
  }
  const fresh: Account = { ...base, tokenEnc: seal(token, key), ...(pin && { pinEnc: seal(pin, key) }), steps: { ...(existing ? {} : base.steps), exchange: now() } }
  const done = await finish(fresh, token, flow, pin)
  const { _id: _ignored, ...doc } = done as Account & { _id?: unknown }
  await accounts().updateOne({ wabaId }, { $set: doc }, { upsert: true })
  forgetAssets(ws())
  trace('whatsapp.connected', { wabaId, flow })
  // A new number gets its health and spend checks now, then on their usual schedule.
  await enqueue('health.check', {}, { key: 'health.check' })
  await enqueue('billing.sync', {}, { key: 'billing.sync' })
  return { account: view(done), ...(pin && done.steps.register?.state === 'done' && { pin }) }
}

async function find(wabaId: string) {
  const a = await accounts().findOne({ workspaceId: ws(), wabaId })
  if (!a) throw new HttpError(404, 'That WhatsApp account isn’t connected to this workspace.')
  return a
}

async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/whatsapp/config' && m === 'GET') {
    const c = cfg()
    const gaps = missing()
    return { ready: !gaps.length, missing: gaps, appId: c.appId || null, configId: c.configId || null, sdkVersion: c.sdkVersion, partnerCredit: !!c.creditLineId }
  }
  if (path === '/api/whatsapp/accounts' && m === 'GET') return (await accounts().find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()).map(view)
  if (path === '/api/whatsapp/connect' && m === 'POST') return connect(obj(await readJson(req)), me)
  if ((seg = path.match(/^\/api\/whatsapp\/accounts\/(\d+)(?:\/([a-z]+))?$/))) {
    const a = await find(seg[1])
    const owner = () => {
      if (!can(me.role, 'whatsapp.manage')) throw new HttpError(403, 'Only workspace owners can change WhatsApp accounts.')
      // Disconnect, retry and billing all rewire the account on Meta; the business's own stays as it is.
      if (isManaged(a)) throw new HttpError(403, MANAGED)
    }
    if (!seg[2] && m === 'DELETE') {
      owner()
      // Stop our app receiving its events; the WhatsApp account itself stays the business's.
      await asBusiness(a, tokenOf(a), () => metaJson('graph', 'DELETE', `/${a.wabaId}/subscribed_apps`)).catch(() => null)
      await accounts().deleteOne({ workspaceId: ws(), wabaId: a.wabaId })
      forgetAssets(ws())
      return { ok: true }
    }
    if (seg[2] === 'retry' && m === 'POST') {
      owner()
      const key = tokenKey()
      const done = await finish(a, tokenOf(a), flowOf(a), a.pinEnc && key ? open(a.pinEnc, key) : undefined)
      await accounts().updateOne({ _id: (a as Account & { _id: unknown })._id as never }, { $set: { steps: done.steps, billing: done.billing, wabaName: done.wabaName, phoneNumbers: done.phoneNumbers } })
      forgetAssets(ws())
      return view(done)
    }
    if (seg[2] === 'billing' && m === 'POST') {
      owner()
      const b = obj(await readJson(req))
      if (b.mode === 'own') {
        const billing = { mode: 'own' as const, state: b.confirmed === true ? ('confirmed' as const) : ('pending' as const) }
        const steps = { ...a.steps, billing: billing.state === 'confirmed' ? now() : { state: 'failed' as const, at: new Date(), error: 'Add a payment method in WhatsApp Manager, then confirm here.' } }
        await accounts().updateOne({ workspaceId: ws(), wabaId: a.wabaId }, { $set: { billing, steps } })
        return view({ ...a, billing, steps })
      }
      if (b.mode === 'partner_credit') {
        if (!cfg().creditLineId) throw new HttpError(400, 'Billing through Helo.ai isn’t available on this server.')
        const base = { ...a, billing: { mode: 'partner_credit' as const, state: 'pending' as const }, steps: { ...a.steps, billing: undefined } }
        const done = a.tokenEnc ? await finish(base, tokenOf(a), flowOf(a)) : base
        await accounts().updateOne({ workspaceId: ws(), wabaId: a.wabaId }, { $set: { billing: done.billing, steps: done.steps } })
        return view(done)
      }
      throw new HttpError(400, 'Billing mode must be partner_credit or own.')
    }
    if (seg[2] === 'pin' && m === 'GET') {
      if (!can(me.role, 'whatsapp.manage')) throw new HttpError(403, 'Only workspace owners can change WhatsApp accounts.')
      const key = tokenKey()
      if (!a.pinEnc || !key) throw new HttpError(404, 'There’s no PIN stored for this number.')
      return { pin: open(a.pinEnc, key) }
    }
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 409: 'Already connected', 429: 'Too many attempts', 503: 'Not set up yet', 502: 'WhatsApp didn’t accept it' }
export async function handleWhatsApp(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/whatsapp/')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'WhatsApp accounts need the database.' } }, () => route(req, u, me))
}
