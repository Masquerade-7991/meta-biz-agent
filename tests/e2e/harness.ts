// One shared helper for every end-to-end journey: a fake Meta (Graph + agent API), the real API
// server on its own port against a throwaway MongoDB database, people and workspaces seeded
// straight into that database, and a cleanup that always stops everything and drops the database.
//
// Safety: the database name must start with meta_agent_e2e_; nothing here talks to real Meta (the
// server is pointed at the fake with UPSTREAM=meta); the user's servers on :5173/:8787 are never
// touched. MONGODB_URI comes from E2E_MONGODB_URI, else the nearest .env up the tree (the main
// checkout's): only that one key is read and it is never printed.
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { MongoClient, type Db } from 'mongodb'

export const ROOT = path.resolve(import.meta.dirname, '../..')
type Obj = Record<string, unknown>

export function mongoUri(): string {
  if (process.env.E2E_MONGODB_URI) return process.env.E2E_MONGODB_URI
  for (let dir = ROOT; ; dir = path.dirname(dir)) {
    const f = path.join(dir, '.env')
    if (existsSync(f)) {
      const uri = parseEnv(readFileSync(f, 'utf8')).MONGODB_URI
      if (uri) return uri
    }
    if (path.dirname(dir) === dir) throw new Error('No MONGODB_URI: set E2E_MONGODB_URI or keep a .env with it above this checkout.')
  }
}

// ---- fake Meta ----
export interface Call {
  method: string
  path: string
  query: URLSearchParams
  headers: http.IncomingHttpHeaders
  body: Obj | null
  raw: string
}
type Handler = (c: Call) => { status?: number; json?: unknown } | undefined
export interface FakeMeta {
  url: string
  calls: Call[]
  /** Answers matching calls (newest rule first) until removed. */
  on(method: string, path: RegExp, h: Handler): () => void
  /** Calls whose path matches. */
  find(method: string, path: RegExp): Call[]
  close(): Promise<void>
}

export const TEMPLATE = {
  id: 'tpl1',
  name: 'order_update',
  language: 'en',
  status: 'APPROVED',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Hi {{1}}, your order is on its way.', example: { body_text: [['Asha']] } }],
}

export async function startFakeMeta(): Promise<FakeMeta> {
  const calls: Call[] = []
  const rules: { method: string; path: RegExp; h: Handler }[] = []
  let n = 0
  const defaults: Handler = (c) => {
    if (c.method === 'POST' && /\/messages$/.test(c.path)) return { json: { messaging_product: 'whatsapp', contacts: [{ wa_id: String(c.body?.to ?? '') }], messages: [{ id: `wamid.FAKE${++n}` }] } }
    if (/\/message_templates$/.test(c.path) && c.method === 'GET') return { json: { data: [TEMPLATE], paging: {} } }
    if (/\/thread_control$/.test(c.path)) return { json: { success: true } }
    if (/\/agent_test$/.test(c.path)) return { json: { message_id: `wamid.T${++n}`, conversation_id: String(c.body?.conversation_id || `conv_${n}`), timestamp: Math.floor(Date.now() / 1000), agent_response: 'Hello from the fake agent.' } }
    if (/\/insights\/conversations\/turns$/.test(c.path)) return { json: { data: [] } }
    if (c.method === 'GET') return { json: { data: [] } }
    return { json: { success: true } }
  }
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const u = new URL(req.url ?? '/', 'http://fake')
      let body: Obj | null = null
      try {
        body = raw ? (JSON.parse(raw) as Obj) : null
      } catch {
        body = null
      }
      const c: Call = { method: req.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: req.headers, body, raw }
      calls.push(c)
      const rule = rules.find((r) => r.method === c.method && r.path.test(c.path))
      const out = (rule && rule.h(c)) ?? defaults(c) ?? {}
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(out.json ?? {}))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    calls,
    on(method, p, h) {
      const r = { method, path: p, h }
      rules.unshift(r)
      return () => void rules.splice(rules.indexOf(r), 1)
    },
    find: (method, p) => calls.filter((c) => c.method === method && p.test(c.path)),
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

// ---- the API server ----
export const WEBHOOK_SECRET = 'e2e-webhook-secret'
export interface Stack {
  base: string
  fake: FakeMeta
  db: Db
  dbName: string
  /** Everything the server printed (emails, magic links included). */
  log: () => string
  seed: ReturnType<typeof seeder>
  api: (who: Person | null, method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Reply>
  webhook: (payload: unknown, opts?: { secret?: string | null; raw?: string }) => Promise<Reply>
  /** Waits until `check` is truthy (or throws after `ms`). */
  until: <T>(check: () => Promise<T> | T, ms?: number) => Promise<T>
  stop: () => Promise<void>
}
export interface Reply {
  status: number
  json: any
  text: string
  headers: Headers
}

export async function startStack(name: string, opts: { jobs?: boolean; port?: number; env?: Record<string, string> } = {}): Promise<Stack> {
  const dbName = `meta_agent_e2e_${name}_${Date.now().toString(36)}`
  if (!/^meta_agent_e2e_[a-z0-9_]+$/.test(dbName)) throw new Error(`Refusing database name ${dbName}`)
  const uri = mongoUri()
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  const db = client.db(dbName)
  const fake = await startFakeMeta()
  const port = opts.port ?? Number(process.env.E2E_PORT || 8797)
  if (port === 8787 || port === 5173) throw new Error('Those ports belong to the user’s own servers.')
  let out = ''
  // A minimal environment: nothing from the caller's shell leaks in (no real tokens).
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TZ: 'UTC',
    SERVER_PORT: String(port),
    MONGODB_URI: uri,
    MONGODB_DB: dbName,
    COLLECTORS: 'off',
    JOBS: opts.jobs ? 'on' : 'off',
    SMTP_PASS: '',
    SMTP_USER: '',
    UPSTREAM: 'meta',
    GRAPH_BASE_URL: fake.url,
    BASE_URL_1: fake.url,
    BASE_URL_2: fake.url,
    META_TOKEN: 'fake-server-token',
    WEBHOOK_APP_SECRETS: WEBHOOK_SECRET,
    WEBHOOK_VERIFY_TOKEN: 'e2e-verify',
    APP_URL: 'http://localhost:5176',
    ...opts.env,
  }
  const proc: ChildProcess = spawn(process.execPath, ['server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stdout!.on('data', (b: Buffer) => (out += b.toString()))
  proc.stderr!.on('data', (b: Buffer) => (out += b.toString()))
  const base = `http://127.0.0.1:${port}`

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    proc.kill('SIGTERM')
    await new Promise((done) => setTimeout(done, 300))
    if (proc.exitCode === null) proc.kill('SIGKILL')
    await fake.close().catch(() => {})
    // Always drop the throwaway database, whatever happened (a few tries: Atlas DNS blips happen).
    for (let i = 0; i < 3; i++) {
      const ok = await db.dropDatabase().then(() => true, (err: unknown) => (i === 2 && console.error(`could not drop ${dbName} (run tests/e2e/cleanup.ts): ${err instanceof Error ? err.message : err}`), false))
      if (ok) break
      await new Promise((done) => setTimeout(done, 3000))
    }
    await client.close().catch(() => {})
  }
  const onExit = () => void stop()
  process.once('SIGINT', onExit)
  process.once('SIGTERM', onExit)

  const until = async <T>(check: () => Promise<T> | T, ms = 15_000): Promise<T> => {
    const end = Date.now() + ms
    for (;;) {
      const v = await check()
      if (v) return v
      if (Date.now() > end) throw new Error('Timed out waiting')
      await new Promise((done) => setTimeout(done, 150))
    }
  }
  try {
    await until(async () => {
      if (proc.exitCode !== null) throw new Error(`server exited:\n${out.slice(-2000)}`)
      const r = await fetch(`${base}/api/health`).catch(() => null)
      return r?.ok && (await r.json()).database === 'ok'
    }, 60_000)
  } catch (err) {
    await stop()
    throw err
  }

  const api: Stack['api'] = async (who, method, p, body, headers = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { ...(who && { cookie: `sid=${who.token}` }), ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual',
    })
    // Keep a leading byte-order mark (CSV downloads start with one; r.text() would drop it).
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer())
    let json: unknown = null
    try {
      json = text && !text.startsWith('\uFEFF') ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: r.status, json, text, headers: r.headers }
  }
  const webhook: Stack['webhook'] = async (payload, o = {}) => {
    const raw = o.raw ?? JSON.stringify(payload)
    const secret = o.secret === undefined ? WEBHOOK_SECRET : o.secret
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (secret !== null) headers['x-hub-signature-256'] = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
    const r = await fetch(`${base}/api/webhooks/whatsapp`, { method: 'POST', headers, body: raw })
    return { status: r.status, json: null, text: await r.text(), headers: r.headers }
  }
  return { base, fake, db, dbName, log: () => out, seed: seeder(db), api, webhook, until, stop }
}

/**
 * The server's own modules, loaded in this test process against the same throwaway database, for
 * work that only runs on a timer (the escalation sweep): call it with a chosen `now` instead of
 * waiting. Sets the same environment as the spawned server first.
 */
export async function serverModules(s: Stack) {
  Object.assign(process.env, { MONGODB_URI: mongoUri(), MONGODB_DB: s.dbName, UPSTREAM: 'meta', GRAPH_BASE_URL: s.fake.url, BASE_URL_1: s.fake.url, META_TOKEN: 'fake-server-token', SMTP_PASS: '', SMTP_USER: '', COLLECTORS: 'off' })
  const db = await import('../../server/db.ts')
  if (!db.db && !(await db.initDb())) throw new Error('in-process database did not connect')
  const accounts = await import('../../server/accounts.ts')
  const ops = await import('../../server/supportOps.ts')
  return {
    /** Runs the escalation sweep for one workspace as if it were `now`. */
    escalate: async (workspaceId: string, now: number) => db.withWorkspace(workspaceId, () => ops.escalateDue(now), await accounts.assetsFor(workspaceId)),
  }
}

// ---- seeding ----
export type Role = 'owner' | 'admin' | 'supervisor' | 'agent'
export interface Person {
  id: string
  email: string
  name: string
  role: Role | null
  /** Session token (the sid cookie). */
  token: string
  password: string
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const hashPassword = (pw: string) => {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`
}

function seeder(db: Db) {
  /** A finished account with a live session, optionally a member of `workspaceId`. */
  async function person(o: { name: string; email?: string; role?: Role; workspaceId?: string }): Promise<Person> {
    const id = randomUUID()
    const email = o.email ?? `${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${id.slice(0, 6)}@e2e.test`
    const password = 'correct horse battery'
    const now = new Date()
    await db.collection('users').insertOne({ _id: id as never, email, name: o.name, passwordHash: hashPassword(password), emailVerifiedAt: now, createdAt: now })
    if (o.workspaceId && o.role) await db.collection('memberships').insertOne({ workspaceId: o.workspaceId, userId: id, role: o.role, createdAt: now })
    const token = randomBytes(32).toString('base64url')
    await db.collection('sessions').insertOne({ tokenHash: sha256(token), userId: id, createdAt: now, expiresAt: new Date(Date.now() + 86_400_000), ...(o.workspaceId && { workspaceId: o.workspaceId }) })
    return { id, email, name: o.name, role: o.role ?? null, token, password }
  }

  /** A workspace with one person per role (owner, admin, supervisor, agent) and, unless `account: null`,
   *  a connected WhatsApp account (not the protected .env one, so the console may message customers). */
  async function workspace(o: { name?: string; account?: { wabaId: string; numbers: string[]; source?: 'env' | 'signup' } | null } = {}) {
    const id = randomUUID()
    await db.collection('workspaces').insertOne({ _id: id as never, name: o.name ?? 'E2E Store', ownerId: '', createdAt: new Date() })
    const owner = await person({ name: 'Olivia Owner', role: 'owner', workspaceId: id })
    await db.collection('workspaces').updateOne({ _id: id as never }, { $set: { ownerId: owner.id } })
    const admin = await person({ name: 'Adam Admin', role: 'admin', workspaceId: id })
    const supervisor = await person({ name: 'Sara Supervisor', role: 'supervisor', workspaceId: id })
    const agent = await person({ name: 'Ajay Agent', role: 'agent', workspaceId: id })
    const acct = o.account === undefined ? { wabaId: '880000000000001', numbers: ['880000000000101'] } : o.account
    if (acct)
      await db.collection('whatsapp_accounts').insertOne({
        workspaceId: id,
        wabaId: acct.wabaId,
        wabaName: 'E2E WABA',
        businessId: '880000000000999',
        phoneNumbers: acct.numbers.map((n, i) => ({ id: n, display: `+91 90000 0000${i}`, verifiedName: `E2E Number ${i + 1}` })),
        source: acct.source ?? 'signup',
        tokenEnc: null,
        billing: { mode: 'own', state: 'confirmed' },
        steps: {},
        connectedBy: owner.id,
        createdAt: new Date(),
      })
    return { id, owner, admin, supervisor, agent, numbers: acct?.numbers ?? [], wabaId: acct?.wabaId ?? null }
  }
  return { person, workspace }
}

// ---- WhatsApp webhook payloads ----
export const ts = (d = new Date()) => String(Math.floor(+d / 1000))
export function inbound(phoneNumberId: string, from: string, text: string, o: { id?: string; name?: string; at?: Date; field?: 'messages' | 'standby'; fromUserId?: string } = {}) {
  const event = {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '919000000000', phone_number_id: phoneNumberId },
    contacts: [{ wa_id: from, ...(o.fromUserId && { user_id: o.fromUserId }), profile: { name: o.name ?? 'Customer' } }],
    messages: [{ ...(from && { from }), ...(o.fromUserId && { from_user_id: o.fromUserId }), id: o.id ?? `wamid.IN${randomUUID()}`, timestamp: ts(o.at), type: 'text', text: { body: text } }],
  }
  const field = o.field ?? 'messages'
  return { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field, value: field === 'standby' ? { metadata: event.metadata, standby: event } : event }] }] }
}
export function statusEvent(phoneNumberId: string, wamid: string, status: string, recipient: string, extra: Obj = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: wamid, status, recipient_id: recipient, timestamp: ts(), ...extra }] } }] }],
  }
}
export function handover(phoneNumberId: string, customer: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messaging_handovers', value: { metadata: { phone_number_id: phoneNumberId }, type: 'control_taken', recipient_id: customer } }] }],
  }
}
