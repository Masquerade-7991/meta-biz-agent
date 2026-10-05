// WhatsApp number management, like Meta's WhatsApp Manager: every number of the workspace's
// WhatsApp accounts, its public profile, display name, ice breakers and commands, two-step PIN,
// registration, ownership check, blocked customers and webhook routing. Meta is the source of truth:
// each change goes to Meta first and is recorded here (phone_numbers, events) only once it's accepted.
import type http from 'node:http'
import { HttpError, type Obj, type Titles, arr, obj, readJson, serveJson, str } from './http.ts'
import { col, db, dbOffReason, ws } from './db.ts'
import { currentAssets } from './context.ts'
import { env, graphBase, metaJson, tokenForId } from './upstream.ts'
import { accounts, forgetAssets, tokenKey } from './accounts.ts'
import { open, seal } from './crypto.ts'
import { allow } from './cache.ts'
import { appUrl } from './mail.ts'
import { trace } from './trace.ts'
import { defineJob, enqueue } from './jobs.ts'
import { can, type Action } from '../src/app/lib/permissions.ts'
import { isBsuid } from '../src/app/lib/customer.ts'
import { automationErrors, displayNameError, profileErrors, VERTICALS, type Automation, type Profile } from '../src/app/whatsapp/profileRules.ts'
import type { Actor } from './inbox.ts'

const numbers = () => col('phone_numbers')
const FIELDS = 'id,display_phone_number,verified_name,quality_rating,name_status,new_name_status,new_display_name,status,code_verification_status,platform_type,throughput'
const PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical'
const STALE_MS = 5 * 60_000

// ---- sync ----
/** Reads every number of the workspace's WhatsApp accounts from Meta, so numbers added in Meta's own
 *  tools show up too. A failed account keeps its last known numbers. */
export async function syncNumbers() {
  let count = 0
  for (const a of await accounts().find({ workspaceId: ws() }).toArray()) {
    let rows: Obj[]
    try {
      rows = arr((await metaJson('graph', 'GET', `/${a.wabaId}/phone_numbers?fields=${FIELDS}&limit=100`)).data).map(obj)
    } catch (err) {
      trace('numbers.sync_failed', { wabaId: a.wabaId, error: err instanceof Error ? err.message.slice(0, 200) : String(err) })
      continue
    }
    for (const p of rows) {
      const id = String(p.id)
      // The thumbnail in the list; its URL expires, so it's refreshed on every sync.
      const photo = await metaJson('graph', 'GET', `/${id}/whatsapp_business_profile?fields=profile_picture_url`)
        .then((r) => str(obj(arr(r.data)[0]).profile_picture_url) ?? null)
        .catch(() => null)
      await numbers().updateOne(
        { workspaceId: ws(), id },
        {
          $set: {
            wabaId: a.wabaId,
            wabaName: a.wabaName,
            display: str(p.display_phone_number) ?? id,
            verifiedName: str(p.verified_name) ?? '',
            status: str(p.status) ?? 'UNKNOWN',
            codeVerification: str(p.code_verification_status) ?? null,
            quality: str(p.quality_rating) ?? 'UNKNOWN',
            nameStatus: str(p.name_status) ?? null,
            newName: str(p.new_display_name) ?? null,
            newNameStatus: str(p.new_name_status) ?? null,
            platform: str(p.platform_type) ?? null,
            throughput: str(obj(p.throughput).level) ?? null,
            photo,
            syncedAt: new Date(),
          },
          $setOnInsert: { workspaceId: ws(), createdAt: new Date() },
        },
        { upsert: true },
      )
      count++
    }
    if (rows.length) await accounts().updateOne({ _id: a._id }, { $set: { phoneNumbers: rows.map((p) => ({ id: String(p.id), display: str(p.display_phone_number) ?? '', verifiedName: str(p.verified_name) ?? '' })) } })
  }
  forgetAssets(ws())
  trace('numbers.synced', { count })
}
defineJob('numbers.sync', async () => void (await syncNumbers()), { maxAttempts: 2 })
export const queueNumbersSync = () => enqueue('numbers.sync', {}, { key: 'numbers.sync' })

// ---- guards ----
function need(me: Actor, action: Action) {
  if (!can(me.role, action)) throw new HttpError(403, action === 'whatsapp.manage' ? 'Only owners change a number’s PIN, registration or webhooks.' : 'Your role can’t change WhatsApp numbers. Ask an owner or admin.')
}
/** The number, if it belongs to this workspace; 404 otherwise (never another workspace's). */
async function own(id: string) {
  if (!currentAssets()?.ids.has(id)) throw new HttpError(404, 'That number isn’t connected to this workspace.')
  return (await numbers().findOne({ workspaceId: ws(), id })) ?? (await syncNumbers(), await numbers().findOne({ workspaceId: ws(), id }))
}
const changed = (id: string, action: string, data: Obj = {}) => trace(`number.${action}`, data, { entity: 'number', id })

// ---- PIN, kept sealed so registering again needs no typing ----
async function storedPin(id: string): Promise<string | null> {
  const key = tokenKey()
  if (!key) return null
  const n = await numbers().findOne({ workspaceId: ws(), id }, { projection: { pinEnc: 1 } })
  if (n?.pinEnc) return open(String(n.pinEnc), key)
  // Numbers connected through Embedded Signup got their PIN on the account.
  const a = await accounts().findOne({ workspaceId: ws(), 'phoneNumbers.0.id': id }, { projection: { pinEnc: 1 } })
  return a?.pinEnc ? open(a.pinEnc, key) : null
}
async function keepPin(id: string, pin: string) {
  const key = tokenKey()
  if (key) await numbers().updateOne({ workspaceId: ws(), id }, { $set: { pinEnc: seal(pin, key) } })
}
const pinOf = (v: unknown) => {
  const p = String(v ?? '')
  if (!/^\d{6}$/.test(p)) throw new HttpError(400, 'The PIN is 6 digits.')
  return p
}

// ---- blocking (also used from the Inbox) ----
/** Blocks or unblocks a customer on a number; WhatsApp blocks by phone number only. */
export async function setBlocked(id: string, user: string, block: boolean) {
  if (isBsuid(user.trim())) throw new HttpError(400, 'WhatsApp blocks by phone number, and this customer hides theirs.')
  const digits = user.replace(/\D/g, '')
  if (!/^\d{8,15}$/.test(digits)) throw new HttpError(400, 'Enter the customer’s number with its country code.')
  const r = await metaJson('graph', block ? 'POST' : 'DELETE', `/${id}/block_users`, { messaging_product: 'whatsapp', block_users: [{ user: digits }] }).catch((err: HttpError) => {
    if (err.code === 131047) throw new HttpError(400, 'WhatsApp only lets you block someone who messaged this number in the last 24 hours.')
    if (err.code === 139101) throw new HttpError(400, 'The block list is full (64,000 people). Unblock someone first.')
    throw err
  })
  if (block && arr(obj(obj(r.block_users).failed_users ?? r.failed_users)).length) throw new HttpError(400, 'WhatsApp only lets you block someone who messaged this number in the last 24 hours.')
  await col('contacts').updateOne({ workspaceId: ws(), phone: digits }, block ? { $set: { blocked: true } } : { $unset: { blocked: '' } })
  changed(id, block ? 'blocked' : 'unblocked')
}

// ---- reads ----
const view = (n: Obj, extra: Obj = {}) => {
  const { _id, workspaceId: _w, pinEnc, ...rest } = n
  return { ...rest, pinKnown: !!pinEnc, ...extra }
}
async function list() {
  const newest = await numbers().findOne({ workspaceId: ws() }, { sort: { syncedAt: -1 }, projection: { syncedAt: 1 } })
  if (!newest || Date.now() - +newest.syncedAt > STALE_MS) await syncNumbers()
  const health = new Map((await col('number_health').find({ workspaceId: ws() }).toArray()).map((h) => [String(h.phoneNumberId), h]))
  const ids = currentAssets()?.ids
  return (await numbers().find({ workspaceId: ws() }).sort({ display: 1 }).toArray())
    .filter((n) => ids?.has(String(n.id)))
    .map((n) => view(n, { limit: health.get(String(n.id))?.limit ?? null }))
}

async function detail(id: string) {
  const n = await own(id)
  if (!n) throw new HttpError(404, 'That number isn’t connected to this workspace.')
  const [profile, extra, activity, pin] = await Promise.all([
    metaJson('graph', 'GET', `/${id}/whatsapp_business_profile?fields=${PROFILE_FIELDS}`).then((r) => obj(arr(r.data)[0])),
    // Ice breakers, webhook routing and the official-account badge; each may be missing on some numbers.
    metaJson('graph', 'GET', `/${id}?fields=conversational_automation,webhook_configuration,is_official_business_account`).catch(() => ({}) as Obj),
    col('events').find({ workspaceId: ws(), entity: 'number', entityId: id }).sort({ at: -1 }).limit(20).toArray(),
    storedPin(id).catch(() => null),
  ])
  const auto = obj(extra.conversational_automation)
  const hook = obj(extra.webhook_configuration)
  const health = await col('number_health').findOne({ workspaceId: ws(), phoneNumberId: id })
  const people = new Map((await col('users').find({ _id: { $in: [...new Set(activity.map((e) => e.userId).filter(Boolean))] } }, { projection: { name: 1 } }).toArray()).map((u) => [String(u._id), String(u.name)]))
  return {
    number: view(n, { pinKnown: !!pin, limit: health?.limit ?? null }),
    /** Whether the server can keep a PIN (needs TOKEN_ENCRYPTION_KEY). */
    pinStorage: !!tokenKey(),
    profile: {
      about: str(profile.about) ?? '',
      address: str(profile.address) ?? '',
      description: str(profile.description) ?? '',
      email: str(profile.email) ?? '',
      websites: arr(profile.websites).map(String),
      vertical: str(profile.vertical) && VERTICALS.some((v) => v.id === profile.vertical) ? String(profile.vertical) : 'OTHER',
      photo: str(profile.profile_picture_url) ?? null,
    },
    automation: {
      prompts: arr(auto.prompts).map(String),
      commands: arr(auto.commands).map((c) => ({ name: String(obj(c).command_name ?? ''), description: String(obj(c).command_description ?? '') })),
    },
    official: typeof extra.is_official_business_account === 'boolean' ? extra.is_official_business_account : null,
    webhook: {
      number: str(hook.phone_number) ?? null,
      account: str(hook.whatsapp_business_account) ?? null,
      app: str(hook.application) ?? null,
      console: `${appUrl}/api/webhooks/whatsapp`,
      reachable: !/\/\/(localhost|127\.|0\.0\.0\.0)/.test(appUrl),
      verifyTokenSet: !!env('WEBHOOK_VERIFY_TOKEN'),
    },
    activity: activity.map((e) => ({ kind: String(e.kind).replace(/^number\./, ''), data: e.data, at: e.at, by: e.userId ? (people.get(String(e.userId)) ?? 'Someone') : 'WhatsApp' })),
  }
}

// ---- writes ----
async function saveProfile(id: string, b: Obj) {
  const p: Profile = {
    about: String(b.about ?? '').trim(),
    address: String(b.address ?? '').trim(),
    description: String(b.description ?? '').trim(),
    email: String(b.email ?? '').trim(),
    websites: arr(b.websites).map((w) => String(w).trim()).filter(Boolean),
    vertical: String(b.vertical ?? 'OTHER'),
  }
  const errors = profileErrors(p)
  if (Object.keys(errors).length) throw new HttpError(400, Object.values(errors)[0]!)
  await metaJson('graph', 'POST', `/${id}/whatsapp_business_profile`, { messaging_product: 'whatsapp', ...p })
  changed(id, 'profile_updated', { fields: Object.keys(p).filter((k) => b[k] !== undefined) })
}

/** Resumable Upload (app → upload session → handle), then the handle goes on the profile. Meta asks
 *  for a user token here; when a system-user token is refused, the error says so. */
async function savePhoto(id: string, req: http.IncomingMessage) {
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (mime !== 'image/jpeg' && mime !== 'image/png') throw new HttpError(400, 'Use a JPG or PNG image.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > 5 * 1024 * 1024) throw new HttpError(413, 'Profile photos can be 5 MB at most.')
    chunks.push(c as Buffer)
  }
  const buf = Buffer.concat(chunks)
  if (!buf.length) throw new HttpError(400, 'That file is empty.')
  const token = tokenForId(id)
  if (!token) throw new HttpError(403, 'This number has no access token on the server.')
  const fail = (step: string, text: string) => {
    const msg = str(obj(obj(JSON.parse(text || '{}')).error).message) ?? text.slice(0, 200)
    return new HttpError(502, `WhatsApp didn’t take the photo (${step}): ${msg} You can change it in WhatsApp Manager instead.`)
  }
  const dbg = await fetch(`${graphBase()}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json() as Promise<Obj>)
  const appId = str(obj(dbg.data).app_id) ?? env('META_APP_ID')
  if (!appId) throw new HttpError(502, 'Couldn’t tell which Meta app this number’s token belongs to. Set META_APP_ID, or change the photo in WhatsApp Manager.')
  const name = encodeURIComponent(`profile.${mime === 'image/png' ? 'png' : 'jpg'}`)
  const s1 = await fetch(`${graphBase()}/${appId}/uploads?file_name=${name}&file_length=${buf.length}&file_type=${encodeURIComponent(mime)}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
  const t1 = await s1.text()
  if (!s1.ok) throw fail('start', t1)
  const session = String(obj(JSON.parse(t1)).id ?? '')
  const s2 = await fetch(`${graphBase()}/${session}`, { method: 'POST', headers: { authorization: `OAuth ${token}`, file_offset: '0' }, body: new Uint8Array(buf) })
  const t2 = await s2.text()
  if (!s2.ok) throw fail('upload', t2)
  const handle = String(obj(JSON.parse(t2)).h ?? '')
  await metaJson('graph', 'POST', `/${id}/whatsapp_business_profile`, { messaging_product: 'whatsapp', profile_picture_handle: handle })
  changed(id, 'photo_updated', { size: buf.length })
}

async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const m = req.method ?? 'GET'
  need(me, 'numbers.view')
  if (u.pathname === '/api/whatsapp/numbers' && m === 'GET') {
    if (u.searchParams.has('refresh')) await syncNumbers()
    return list()
  }
  const seg = u.pathname.match(/^\/api\/whatsapp\/numbers\/(\d{6,20})(?:\/([a-z-]+))?(?:\/([^/]+))?$/)
  if (!seg) throw new HttpError(404, 'Not found.')
  const [, id, action = '', arg] = seg
  if (!action && m === 'GET') return detail(id)
  if (!(await own(id))) throw new HttpError(404, 'That number isn’t connected to this workspace.')

  if (action === 'photo' && m === 'POST') {
    need(me, 'numbers.edit')
    await savePhoto(id, req)
    return detail(id)
  }
  if (action === 'pin' && m === 'GET') {
    need(me, 'whatsapp.manage')
    const pin = await storedPin(id)
    if (!pin) throw new HttpError(404, 'We don’t have this number’s PIN. Set a new one below.')
    changed(id, 'pin_viewed')
    return { pin }
  }
  if (action === 'blocked' && m === 'GET') {
    need(me, 'numbers.edit')
    const r = await metaJson('graph', 'GET', `/${id}/block_users?limit=100`)
    return arr(r.data).map((x) => ({ user: String(obj(x).wa_id ?? obj(x).user ?? '') })).filter((x) => x.user)
  }
  if (action === 'blocked' && m === 'DELETE' && arg) {
    need(me, 'numbers.edit')
    await setBlocked(id, decodeURIComponent(arg), false)
    return { ok: true }
  }

  const b = m === 'GET' || m === 'DELETE' ? {} : obj(await readJson(req))
  switch (`${m} ${action}`) {
    case 'PUT profile':
      need(me, 'numbers.edit')
      await saveProfile(id, b)
      break
    case 'POST display-name': {
      need(me, 'numbers.edit')
      const name = String(b.name ?? '').trim()
      const problem = displayNameError(name)
      if (problem) throw new HttpError(400, problem)
      await metaJson('graph', 'POST', `/${id}?new_display_name=${encodeURIComponent(name)}`, {})
      changed(id, 'name_requested', { name })
      await syncNumbers()
      break
    }
    case 'PUT automation': {
      need(me, 'numbers.edit')
      const a: Automation = {
        prompts: arr(b.prompts).map((x) => String(x).trim()).filter(Boolean),
        commands: arr(b.commands).map((c) => ({ name: String(obj(c).name ?? '').trim().replace(/^\//, ''), description: String(obj(c).description ?? '').trim() })).filter((c) => c.name || c.description),
      }
      const problem = automationErrors(a)
      if (problem) throw new HttpError(400, problem)
      await metaJson('graph', 'POST', `/${id}/conversational_automation`, { prompts: a.prompts, commands: a.commands.map((c) => ({ command_name: c.name, command_description: c.description })) })
      changed(id, 'automation_updated', { prompts: a.prompts.length, commands: a.commands.length })
      break
    }
    case 'POST blocked': {
      need(me, 'numbers.edit')
      await setBlocked(id, String(b.user ?? ''), true)
      return { ok: true }
    }
    case 'POST request-code': {
      need(me, 'numbers.edit')
      const method = b.method === 'VOICE' ? 'VOICE' : 'SMS'
      if (!allow(`code|${id}`, 5)) throw new HttpError(429, 'Too many codes asked for this number. Try again in an hour.')
      await metaJson('graph', 'POST', `/${id}/request_code`, { code_method: method, language: String(b.language || 'en') })
      changed(id, 'code_requested', { method })
      return { ok: true }
    }
    case 'POST verify-code': {
      need(me, 'numbers.edit')
      const code = String(b.code ?? '').replace(/\D/g, '')
      if (code.length < 4) throw new HttpError(400, 'Enter the code WhatsApp sent you.')
      await metaJson('graph', 'POST', `/${id}/verify_code`, { code })
      changed(id, 'verified')
      await syncNumbers()
      break
    }
    case 'POST pin': {
      need(me, 'whatsapp.manage')
      const pin = pinOf(b.pin)
      await metaJson('graph', 'POST', `/${id}`, { pin })
      await keepPin(id, pin)
      changed(id, 'pin_changed')
      break
    }
    case 'POST register': {
      need(me, 'whatsapp.manage')
      const pin = b.pin ? pinOf(b.pin) : await storedPin(id)
      if (!pin) throw new HttpError(400, 'Enter the number’s 6-digit PIN to register it.')
      await metaJson('graph', 'POST', `/${id}/register`, { messaging_product: 'whatsapp', pin })
      if (b.pin) await keepPin(id, pin)
      changed(id, 'registered')
      await syncNumbers()
      break
    }
    case 'POST deregister': {
      need(me, 'whatsapp.manage')
      const n = await numbers().findOne({ workspaceId: ws(), id })
      if (String(b.confirm ?? '').replace(/\D/g, '') !== String(n?.display ?? '').replace(/\D/g, '')) throw new HttpError(400, 'Type the number exactly to confirm.')
      await metaJson('graph', 'POST', `/${id}/deregister`, {})
      changed(id, 'deregistered')
      await syncNumbers()
      break
    }
    case 'PUT webhook': {
      need(me, 'whatsapp.manage')
      // console: send this number's events here. other: back to a URL the user gives (with its token).
      const url = b.target === 'console' ? `${appUrl}/api/webhooks/whatsapp` : String(b.url ?? '').trim()
      const token = b.target === 'console' ? env('WEBHOOK_VERIFY_TOKEN') : String(b.verifyToken ?? '').trim()
      if (b.target === 'console' && /\/\/(localhost|127\.|0\.0\.0\.0)/.test(appUrl)) throw new HttpError(400, 'This app runs on your computer, which WhatsApp can’t reach. Deploy the server first (see render.yaml), then set APP_URL to its address.')
      if (!/^https:\/\//.test(url)) throw new HttpError(400, 'WhatsApp only sends webhooks to an https:// address.')
      if (!token) throw new HttpError(400, b.target === 'console' ? 'Set WEBHOOK_VERIFY_TOKEN on the server first.' : 'Enter the verify token that address expects.')
      const before = obj((await metaJson('graph', 'GET', `/${id}?fields=webhook_configuration`)).webhook_configuration)
      await metaJson('graph', 'POST', `/${id}`, { webhook_configuration: { override_callback_uri: url, verify_token: token } })
      changed(id, 'webhook_changed', { from: str(before.phone_number) ?? str(before.whatsapp_business_account) ?? str(before.application) ?? null, to: url })
      break
    }
    default:
      throw new HttpError(404, 'Not found.')
  }
  return detail(id)
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 413: 'Too big', 429: 'Slow down', 502: 'WhatsApp didn’t accept it' }
export async function handleNumbers(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/whatsapp/numbers')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Number management needs the database.' } }, () => route(req, u, me))
}
