// Accounts, sessions, magic links, workspaces and members.
// - Emailed magic links only verify the email: opening one uses it up and signs the person in to an
//   unfinished account. The rest of setup (name, password, workspace) happens in the app, and an
//   unfinished account can do nothing else. Forgot password works the same way.
// - After setup: email + password login.
// - Tokens and session ids are random; only their sha256 is stored. Passwords use scrypt.
// - Owners invite and manage members; every workspace keeps at least one owner.
// - A person can belong to several workspaces. Each session works in one of them (sessions.workspaceId)
//   and switches with POST /api/account/workspace. Someone who already has an account accepts an invite
//   in the app, signed in as the invited email; opening the emailed link never joins them by itself.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import type http from 'node:http'
import { promisify } from 'node:util'
import { ObjectId } from 'mongodb'
import { allow } from './cache.ts'
import { col, db, dbOffReason } from './db.ts'
import { appUrl, mail } from './mail.ts'
import { HttpError, readJson, serveJson, type Titles } from './http.ts'
import { migrateEnvAccount } from './accounts.ts'
import { can, canSetRole, isRole, roleLabel, type Action, type Role } from '../src/app/lib/permissions.ts'
import { trace } from './trace.ts'

type Obj = Record<string, unknown>
type Purpose = 'signup' | 'invite' | 'reset' | 'email_change'
interface User {
  _id: string
  email: string
  name: string
  /** Unset until the person finishes setup in the app. */
  passwordHash?: string
  emailVerifiedAt: Date
  createdAt: Date
  /** Invited but not finished setup: the workspace they join when they do. */
  pendingWorkspaceId?: string
  pendingInvitedBy?: string
  /** The role the invite offered; given on joining. */
  pendingRole?: Role
  /** Opened a reset link: must choose a new password before anything else. */
  mustSetPassword?: boolean
}
/** Where the person is: done, or what the app still needs from them. */
type Setup = 'complete' | 'account' | 'password'
const setupOf = (u: User): Setup => (!u.passwordHash ? 'account' : u.mustSetPassword ? 'password' : 'complete')
interface Workspace {
  _id: string
  name: string
  ownerId: string
  createdAt: Date
  /** Owns the WhatsApp assets in .env; only members of this workspace reach them. */
  metaAssets?: boolean
}
interface Membership {
  workspaceId: string
  userId: string
  role: Role
  createdAt: Date
}
interface MagicLink {
  tokenHash: string
  email: string
  purpose: Purpose
  workspaceId?: string
  invitedBy?: string
  /** For an invite: the role the person joins with. */
  role?: Role
  userId?: string
  expiresAt: Date
  createdAt: Date
  usedAt?: Date
  revokedAt?: Date
  /** The invited person said no (an invite revoked by them rather than by the workspace). */
  declinedAt?: Date
}

const MIN = 60_000
const LINK_TTL: Record<Purpose, number> = { signup: 30 * MIN, reset: 30 * MIN, email_change: 30 * MIN, invite: 7 * 24 * 60 * MIN }
const SESSION_TTL = 30 * 24 * 60 * MIN
const COOKIE = 'sid'
const secure = appUrl.startsWith('https://')

const users = () => col<User>('users')
const workspaces = () => col<Workspace>('workspaces')
const memberships = () => col<Membership>('memberships')
const links = () => col<MagicLink>('magic_links')
/** `workspaceId`: the workspace this session works in; unset falls back to the most recent membership. */
const sessions = () => col<{ tokenHash: string; userId: string; createdAt: Date; expiresAt: Date; workspaceId?: string }>('sessions')

// ---- crypto ----
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`
}
async function verifyPassword(pw: string, stored: string | undefined) {
  if (!stored) stored = DUMMY_HASH
  const [salt, hash] = stored.split(':')
  const got = await scryptAsync(pw, Buffer.from(salt, 'hex'), 64)
  return timingSafeEqual(got, Buffer.from(hash, 'hex'))
}
// Compared against when an email has no account, so a login takes as long either way.
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`

// ---- input ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function email(v: unknown): string {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(e) || e.length > 254) throw new HttpError(400, 'Enter a valid email address.')
  return e
}
function text(v: unknown, what: string, max = 80): string {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) throw new HttpError(400, `Enter ${what}.`)
  if (t.length > max) throw new HttpError(400, `${what[0].toUpperCase() + what.slice(1)} must be ${max} characters or fewer.`)
  return t
}
function password(v: unknown): string {
  const p = typeof v === 'string' ? v : ''
  if (p.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.')
  if (p.length > 200) throw new HttpError(400, 'Use 200 characters or fewer for your password.')
  return p
}
function limit(key: string, max: number, message: string) {
  if (!allow(`auth|${key}`, max)) throw new HttpError(429, message)
}

// ---- sessions ----
const cookieValue = (req: http.IncomingMessage) =>
  (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1]
const cookie = (value: string, maxAgeMs: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`

async function startSession(res: http.ServerResponse, userId: string, workspaceId?: string) {
  const token = newToken()
  const now = new Date()
  await sessions().insertOne({ tokenHash: sha256(token), userId, createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL), ...(workspaceId && { workspaceId }) })
  res.setHeader('set-cookie', cookie(token, SESSION_TTL))
  return sha256(token)
}

export interface Session {
  user: User
  workspace: Workspace | null
  role: Role | null
  setup: Setup
  sessionHash: string
}
/** The signed-in user and their workspace (if any), or null. */
export async function getSession(req: http.IncomingMessage): Promise<Session | null> {
  if (!db) return null
  const token = cookieValue(req)
  if (!token) return null
  const s = await sessions().findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } })
  const user = s && (await users().findOne({ _id: s.userId }))
  if (!s || !user) return null
  return { user, ...(await activeWorkspace(user._id, s.workspaceId)), setup: setupOf(user), sessionHash: s.tokenHash }
}

/** The workspace a session works in: the one it chose if the person is still a member there,
 *  otherwise the one they joined most recently. */
async function activeWorkspace(userId: string, preferred?: string) {
  const m =
    (preferred && (await memberships().findOne({ userId, workspaceId: preferred }))) ||
    (await memberships().find({ userId }).sort({ createdAt: -1 }).limit(1).next())
  const workspace = m ? await workspaces().findOne({ _id: m.workspaceId }) : null
  return { workspace: workspace ?? null, role: workspace ? m!.role : null }
}

/** Invites waiting for this email, from workspaces the person isn't in yet. */
async function invitesFor(user: User) {
  const ls = await links().find({ email: user.email, purpose: 'invite', ...live() }).sort({ createdAt: -1 }).toArray()
  const mine = new Set((await memberships().find({ userId: user._id }).toArray()).map((mm) => mm.workspaceId))
  const open = ls.filter((l) => l.workspaceId && !mine.has(l.workspaceId))
  const ws = await workspaces().find({ _id: { $in: open.map((l) => l.workspaceId!) } }).toArray()
  const by = await users().find({ _id: { $in: open.map((l) => l.invitedBy ?? '') } }).toArray()
  const wName = new Map(ws.map((w) => [w._id, w.name]))
  const uName = new Map(by.map((u) => [u._id, u.name]))
  return open
    .filter((l) => wName.has(l.workspaceId!))
    .map((l) => ({
      id: String((l as MagicLink & { _id: ObjectId })._id),
      workspaceName: wName.get(l.workspaceId!)!,
      inviterName: (l.invitedBy && uName.get(l.invitedBy)) || null,
      role: l.role ?? 'agent',
      expiresAt: l.expiresAt,
    }))
}

async function me(s: Pick<Session, 'user' | 'workspace' | 'role'>) {
  const pending = s.user.pendingWorkspaceId ? await workspaces().findOne({ _id: s.user.pendingWorkspaceId }) : null
  const inviter = s.user.pendingInvitedBy ? await users().findOne({ _id: s.user.pendingInvitedBy }) : null
  const ms = await memberships().find({ userId: s.user._id }).sort({ createdAt: 1 }).toArray()
  const ws = await workspaces().find({ _id: { $in: ms.map((mm) => mm.workspaceId) } }).toArray()
  const wName = new Map(ws.map((w) => [w._id, w.name]))
  return {
    user: { id: s.user._id, name: s.user.name, email: s.user.email },
    workspace: s.workspace ? { id: s.workspace._id, name: s.workspace.name } : null,
    role: s.role,
    setup: setupOf(s.user),
    joining: pending ? { workspaceName: pending.name, inviterName: inviter?.name ?? null } : null,
    workspaces: ms.filter((mm) => wName.has(mm.workspaceId)).map((mm) => ({ id: mm.workspaceId, name: wName.get(mm.workspaceId)!, role: mm.role })),
    invites: setupOf(s.user) === 'complete' ? await invitesFor(s.user) : [],
  }
}

// ---- magic links ----
async function createLink(l: Omit<MagicLink, 'tokenHash' | 'expiresAt' | 'createdAt'>) {
  const token = newToken()
  const now = new Date()
  await links().insertOne({ ...l, tokenHash: sha256(token), createdAt: now, expiresAt: new Date(now.getTime() + LINK_TTL[l.purpose]) })
  return token
}
/** Creates a link and emails it; if the email fails the link is withdrawn, so no unsent invite lingers as pending. */
async function mailLink(l: Parameters<typeof createLink>[0], deliver: (token: string) => Promise<void>) {
  const token = await createLink(l)
  try {
    await deliver(token)
  } catch (err) {
    await links().updateOne({ tokenHash: sha256(token) }, { $set: { revokedAt: new Date() } })
    throw err
  }
}
const live = () => ({ usedAt: { $exists: false }, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
async function findLink(token: unknown) {
  const l = typeof token === 'string' && token ? await links().findOne({ tokenHash: sha256(token), ...live() }) : null
  if (!l) throw new HttpError(410, 'This link has expired or was already used.')
  return l
}
/** Marks the link used; only one request can win. */
async function consumeLink(l: MagicLink) {
  const r = await links().updateOne({ tokenHash: l.tokenHash, ...live() }, { $set: { usedAt: new Date() } })
  if (!r.modifiedCount) throw new HttpError(410, 'This link has expired or was already used.')
}

// ---- workspaces ----
/** Creates a workspace owned by the user. The first workspace ever adopts the records made before accounts existed. */
async function createWorkspace(userId: string, name: string) {
  const first = (await workspaces().countDocuments()) === 0
  const w: Workspace = { _id: randomUUID(), name, ownerId: userId, createdAt: new Date(), ...(first && { metaAssets: true }) }
  await workspaces().insertOne(w)
  await memberships().insertOne({ workspaceId: w._id, userId, role: 'owner', createdAt: new Date() })
  if (first) {
    await adoptDefaultRecords(w._id)
    await migrateEnvAccount(db!) // the server's own WhatsApp account (.env) belongs to the first workspace
  }
  return w
}
async function adoptDefaultRecords(workspaceId: string) {
  const names = (await db!.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  for (const n of names) {
    // MongoDB's own collections can't be written; time-series keep the workspace in `meta`, left as is.
    if (n.startsWith('system.') || ['metrics_daily', 'handoff_snapshots'].includes(n)) continue
    await db!.collection(n).updateMany({ workspaceId: 'default' }, { $set: { workspaceId } })
  }
}
async function ownersLeft(workspaceId: string, exceptUserId: string) {
  return memberships().countDocuments({ workspaceId, role: 'owner', userId: { $ne: exceptUserId } })
}

// ---- routes ----
function needSession(s: Session | null): Session {
  if (!s) throw new HttpError(401, 'Log in to continue.')
  return s
}
/** Signed in and finished setup. */
function needReady(s: Session | null): Session {
  const x = needSession(s)
  if (x.setup !== 'complete') throw new HttpError(403, 'Finish setting up your account first.')
  return x
}
function needWorkspace(s: Session | null): Session & { workspace: Workspace } {
  const x = needReady(s)
  if (!x.workspace) throw new HttpError(403, 'Create or join a workspace first.')
  return x as Session & { workspace: Workspace }
}
function needCan(s: Session | null, action: Action) {
  const x = needWorkspace(s)
  if (!can(x.role, action)) throw new HttpError(403, 'Your role doesn’t allow this. Ask an owner or admin.')
  return x
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, u: URL): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  const ip = req.socket.remoteAddress ?? ''
  // A cross-site HTML form always sends a form content type; only JSON (or no body) is accepted.
  const ct = String(req.headers['content-type'] ?? '')
  if (m !== 'GET' && ct && !ct.includes('application/json')) throw new HttpError(415, 'Send JSON.')
  const body = m === 'POST' || m === 'PUT' ? ((await readJson(req)) as Obj | null) ?? {} : {}
  let seg: RegExpMatchArray | null

  // -- sign-up, login, links --
  if (path === '/api/auth/signup' && m === 'POST') {
    const e = email(body.email)
    limit(`send|${e}`, 5, 'Too many emails sent to this address. Try again in an hour.')
    limit(`send-ip|${ip}`, 20, 'Too many sign-up attempts. Try again in an hour.')
    const existing = await users().findOne({ email: e })
    // An account that never finished setup can sign up again (e.g. the setup tab was closed).
    if (existing?.passwordHash) throw new HttpError(409, 'You already have an account. Log in instead.')
    await mailLink({ email: e, purpose: 'signup' }, (t) => mail.signup(e, t))
    return { ok: true }
  }
  // POST, not GET: email scanners that pre-open links don't use them up.
  if (path === '/api/auth/verify' && m === 'POST') return verify(res, body.token)
  if (path === '/api/auth/login' && m === 'POST') {
    const e = email(body.email)
    limit(`login|${e}|${ip}`, 10, 'Too many login attempts. Try again in an hour, or reset your password.')
    const pw = typeof body.password === 'string' ? body.password : ''
    const user = await users().findOne({ email: e })
    const ok = await verifyPassword(pw, user?.passwordHash ?? DUMMY_HASH)
    if (!user?.passwordHash || !ok) throw new HttpError(401, 'Email or password is incorrect.')
    await startSession(res, user._id)
    return me((await sessionFor(user._id))!)
  }
  if (path === '/api/auth/logout' && m === 'POST') {
    const token = cookieValue(req)
    if (token) await sessions().deleteOne({ tokenHash: sha256(token) })
    res.setHeader('set-cookie', cookie('', 0))
    return { ok: true }
  }
  if (path === '/api/auth/me' && m === 'GET') return me(needSession(await getSession(req)))
  if (path === '/api/account/setup' && m === 'POST') return finishSetup(needSession(await getSession(req)), body)
  if (path === '/api/account/new-password' && m === 'POST') {
    const x = needSession(await getSession(req))
    if (x.setup !== 'password') throw new HttpError(400, 'Use Settings to change your password.')
    await users().updateOne({ _id: x.user._id }, { $set: { passwordHash: await hashPassword(password(body.password)) }, $unset: { mustSetPassword: '' } })
    await sessions().deleteMany({ userId: x.user._id, tokenHash: { $ne: x.sessionHash } }) // every other device logs out
    await mail.passwordChanged(x.user.email)
    return me((await sessionFor(x.user._id))!)
  }
  if (path === '/api/auth/forgot' && m === 'POST') {
    const e = email(body.email)
    limit(`send|${e}`, 5, 'Too many emails sent to this address. Try again in an hour.')
    limit(`send-ip|${ip}`, 20, 'Too many requests. Try again in an hour.')
    // Same answer either way, so this can't be used to find out who has an account.
    // Failures are only logged: this route must answer the same whether or not the account exists.
    if (await users().findOne({ email: e })) await mailLink({ email: e, purpose: 'reset' }, (t) => mail.reset(e, t)).catch(() => {})
    return { ok: true }
  }

  const s = await getSession(req)

  // -- account --
  if (path === '/api/account' && m === 'PUT') {
    const x = needReady(s)
    await users().updateOne({ _id: x.user._id }, { $set: { name: text(body.name, 'your name') } })
    return me((await sessionFor(x.user._id))!)
  }
  if (path === '/api/account/password' && m === 'POST') {
    const x = needReady(s)
    limit(`pw|${x.user._id}`, 10, 'Too many attempts. Try again in an hour.')
    if (!(await verifyPassword(String(body.currentPassword ?? ''), x.user.passwordHash))) throw new HttpError(400, 'Your current password is incorrect.')
    await users().updateOne({ _id: x.user._id }, { $set: { passwordHash: await hashPassword(password(body.newPassword)) } })
    await sessions().deleteMany({ userId: x.user._id, tokenHash: { $ne: x.sessionHash } }) // other devices log out
    await mail.passwordChanged(x.user.email)
    return { ok: true }
  }
  if (path === '/api/account/email' && m === 'POST') {
    const x = needReady(s)
    limit(`send|${x.user._id}`, 5, 'Too many emails sent. Try again in an hour.')
    if (!(await verifyPassword(String(body.password ?? ''), x.user.passwordHash))) throw new HttpError(400, 'Your password is incorrect.')
    const e = email(body.newEmail)
    if (e === x.user.email) throw new HttpError(400, 'That’s already your email.')
    if (await users().findOne({ email: e })) throw new HttpError(409, 'Another account already uses that email.')
    await mailLink({ email: e, purpose: 'email_change', userId: x.user._id }, (t) => mail.emailChange(e, t))
    return { ok: true }
  }

  if (path === '/api/account/workspace' && m === 'POST') {
    const x = needReady(s)
    const id = typeof body.workspaceId === 'string' ? body.workspaceId : ''
    if (!(await memberships().findOne({ userId: x.user._id, workspaceId: id }))) throw new HttpError(404, 'You’re not a member of that workspace.')
    await sessions().updateOne({ tokenHash: x.sessionHash }, { $set: { workspaceId: id } })
    trace('workspace.switched', {})
    return me((await sessionFor(x.user._id, id))!)
  }

  // -- invites to someone who already has an account --
  if ((seg = path.match(/^\/api\/account\/invites\/([a-f0-9]{24})\/(accept|decline)$/)) && m === 'POST') {
    const x = needReady(s)
    const inv = await links().findOne({ _id: new ObjectId(seg[1]), purpose: 'invite', ...live() })
    // Only the invited email can answer; anyone else gets the same answer as an expired link.
    if (!inv || inv.email !== x.user.email || !inv.workspaceId) throw new HttpError(410, 'This invite was revoked, has expired or was already answered.')
    const w = await workspaces().findOne({ _id: inv.workspaceId })
    if (!w) throw new HttpError(410, 'This workspace no longer exists.')
    if (seg[2] === 'decline') {
      await links().updateOne({ tokenHash: inv.tokenHash, ...live() }, { $set: { revokedAt: new Date(), declinedAt: new Date() } })
      trace('member.invite_declined', {})
      return me((await sessionFor(x.user._id, x.workspace?._id))!)
    }
    await consumeLink(inv)
    if (!(await memberships().findOne({ userId: x.user._id, workspaceId: w._id })))
      await memberships().insertOne({ workspaceId: w._id, userId: x.user._id, role: inv.role ?? 'agent', createdAt: new Date() })
    await sessions().updateOne({ tokenHash: x.sessionHash }, { $set: { workspaceId: w._id } })
    const inviter = inv.invitedBy ? await users().findOne({ _id: inv.invitedBy }) : null
    if (inviter) await mail.memberJoined(inviter.email, x.user.name, w.name).catch(() => {})
    trace('member.joined', { role: inv.role ?? 'agent' })
    return me((await sessionFor(x.user._id, w._id))!)
  }

  // -- workspace --
  if (path === '/api/workspace' && m === 'POST') {
    const x = needReady(s)
    limit(`ws-create|${x.user._id}`, 5, 'Too many workspaces created. Try again in an hour.')
    const w = await createWorkspace(x.user._id, text(body.name, 'a workspace name'))
    await sessions().updateOne({ tokenHash: x.sessionHash }, { $set: { workspaceId: w._id } })
    return me((await sessionFor(x.user._id, w._id))!)
  }
  if (path === '/api/workspace/leave' && m === 'POST') {
    const x = needWorkspace(s)
    if (x.role === 'owner' && (await ownersLeft(x.workspace._id, x.user._id)) === 0)
      throw new HttpError(400, 'You’re the only owner. Make someone else an owner before you leave.')
    await memberships().deleteOne({ workspaceId: x.workspace._id, userId: x.user._id })
    await sessions().updateMany({ userId: x.user._id, workspaceId: x.workspace._id }, { $unset: { workspaceId: '' } })
    const owners = await memberships().find({ workspaceId: x.workspace._id, role: 'owner' }).toArray()
    for (const o of await users().find({ _id: { $in: owners.map((mm) => mm.userId) } }).toArray()) await mail.memberLeft(o.email, x.user.name, x.workspace.name).catch(() => {})
    trace('member.left', {})
    return me((await sessionFor(x.user._id))!)
  }
  if (path === '/api/workspace/members' && m === 'GET') {
    const x = needWorkspace(s)
    const ms = await memberships().find({ workspaceId: x.workspace._id }).sort({ createdAt: 1 }).toArray()
    const people = await users().find({ _id: { $in: ms.map((mm) => mm.userId) } }).toArray()
    const byId = new Map(people.map((p) => [p._id, p]))
    const members = ms.map((mm) => ({ userId: mm.userId, name: byId.get(mm.userId)?.name ?? '', email: byId.get(mm.userId)?.email ?? '', role: mm.role, joinedAt: mm.createdAt }))
    if (!can(x.role, 'members.manage')) return { members, invites: [], joining: [] }
    const inv = await links().find({ workspaceId: x.workspace._id, purpose: 'invite', ...live() }).sort({ createdAt: -1 }).toArray()
    // Opened their invite (email verified) but haven't finished setup yet.
    const joining = await users().find({ pendingWorkspaceId: x.workspace._id }).toArray()
    return {
      members,
      invites: inv.map((i) => ({ id: String((i as MagicLink & { _id: ObjectId })._id), email: i.email, role: i.role ?? 'agent', invitedAt: i.createdAt, expiresAt: i.expiresAt })),
      joining: joining.map((j) => ({ email: j.email, verifiedAt: j.emailVerifiedAt })),
    }
  }
  if (path === '/api/workspace/invites' && m === 'POST') {
    const x = needCan(s, 'members.manage')
    const e = email(body.email)
    const role: Role = isRole(body.role) ? body.role : 'agent'
    if (!canSetRole(x.role, 'agent', role)) throw new HttpError(403, `Your role can’t invite someone as ${roleLabel(role)}.`)
    limit(`invite|${x.workspace._id}`, 50, 'Too many invites sent. Try again in an hour.')
    const existing = await users().findOne({ email: e })
    if (existing && (await memberships().findOne({ userId: existing._id, workspaceId: x.workspace._id }))) throw new HttpError(409, 'This person is already in this workspace.')
    if (await links().findOne({ email: e, workspaceId: x.workspace._id, purpose: 'invite', ...live() }))
      throw new HttpError(409, 'This person is already invited. Resend the invite from the list.')
    const send = existing?.passwordHash ? mail.inviteExisting : mail.invite
    await mailLink({ email: e, purpose: 'invite', workspaceId: x.workspace._id, invitedBy: x.user._id, role }, (t) => send(e, t, x.user.name, x.workspace.name))
    trace('member.invited', { role })
    return { ok: true }
  }
  if ((seg = path.match(/^\/api\/workspace\/invites\/([a-f0-9]{24})(\/resend)?$/))) {
    const x = needCan(s, 'members.manage')
    const inv = await links().findOne({ _id: new ObjectId(seg[1]), workspaceId: x.workspace._id, purpose: 'invite', ...live() })
    if (!inv) throw new HttpError(404, 'This invite was already accepted, revoked or has expired.')
    if (m === 'DELETE' && !seg[2]) {
      await links().updateOne({ tokenHash: inv.tokenHash }, { $set: { revokedAt: new Date() } })
      return { ok: true }
    }
    if (m === 'POST' && seg[2]) {
      limit(`send|${inv.email}`, 5, 'Too many emails sent to this address. Try again in an hour.')
      const send = (await users().findOne({ email: inv.email }))?.passwordHash ? mail.inviteExisting : mail.invite
      await mailLink({ email: inv.email, purpose: 'invite', workspaceId: x.workspace._id, invitedBy: x.user._id, role: inv.role }, (t) => send(inv.email, t, x.user.name, x.workspace.name))
      await links().updateOne({ tokenHash: inv.tokenHash }, { $set: { revokedAt: new Date() } }) // sent: the old link stops working
      return { ok: true }
    }
  }
  if ((seg = path.match(/^\/api\/workspace\/members\/([0-9a-f-]{36})$/))) {
    const x = needCan(s, 'members.manage')
    const target = await memberships().findOne({ workspaceId: x.workspace._id, userId: seg[1] })
    const person = target && (await users().findOne({ _id: target.userId }))
    if (!target || !person) throw new HttpError(404, 'This person isn’t in your workspace.')
    if (m === 'DELETE') {
      if (target.userId === x.user._id) throw new HttpError(400, 'You can’t remove yourself.')
      if (!canSetRole(x.role, target.role, 'agent')) throw new HttpError(403, 'Only owners can remove an owner.')
      await memberships().deleteOne({ workspaceId: x.workspace._id, userId: target.userId })
      // Their other workspaces stay open; sessions working in this one fall back to another.
      await sessions().updateMany({ userId: target.userId, workspaceId: x.workspace._id }, { $unset: { workspaceId: '' } })
      await mail.removed(person.email, x.workspace.name)
      return { ok: true }
    }
    if (m === 'PUT') {
      const role = isRole(body.role) ? body.role : null
      if (!role) throw new HttpError(400, 'Role must be owner, admin, supervisor or agent.')
      if (role === target.role) return { ok: true }
      if (!canSetRole(x.role, target.role, role)) throw new HttpError(403, 'Only owners can make someone an owner or change an owner’s role.')
      if (target.role === 'owner' && (await ownersLeft(x.workspace._id, target.userId)) === 0) throw new HttpError(400, 'A workspace needs at least one owner.')
      await memberships().updateOne({ workspaceId: x.workspace._id, userId: target.userId }, { $set: { role } })
      trace('member.role_changed', { from: target.role, to: role })
      await mail.roleChanged(person.email, x.workspace.name, role)
      return { ok: true }
    }
  }
  throw new HttpError(404, `No route for ${m} ${path}.`)
}

async function sessionFor(userId: string, workspaceId?: string) {
  const user = await users().findOne({ _id: userId })
  if (!user) return null
  return { user, ...(await activeWorkspace(userId, workspaceId)) }
}

/** What an emailed link does: verifies the email, uses the link up, and signs the person in.
 *  Sign-up and invites leave an unfinished account the app then completes (finishSetup). */
async function verify(res: http.ServerResponse, token: unknown) {
  const l = await findLink(token)
  const existing = await users().findOne({ email: l.email })
  const now = new Date()

  if (l.purpose === 'email_change') {
    const user = l.userId ? await users().findOne({ _id: l.userId }) : null
    if (!user) throw new HttpError(410, 'This link has expired or was already used.')
    if (existing) throw new HttpError(409, 'Another account already uses that email.')
    await consumeLink(l)
    await users().updateOne({ _id: user._id }, { $set: { email: l.email, emailVerifiedAt: now } })
    await mail.emailChanged(user.email, l.email)
    return { purpose: l.purpose, email: l.email }
  }

  if (l.purpose === 'reset') {
    if (!existing?.passwordHash) throw new HttpError(410, 'This link has expired or was already used.')
    await consumeLink(l)
    await users().updateOne({ _id: existing._id }, { $set: { mustSetPassword: true } })
    await sessions().deleteMany({ userId: existing._id }) // the old password may be known to someone else
    await startSession(res, existing._id)
    return { purpose: l.purpose, me: await me((await sessionFor(existing._id))!) }
  }

  if (l.purpose === 'invite') {
    const w = await workspaces().findOne({ _id: l.workspaceId })
    if (!w) throw new HttpError(410, 'This workspace no longer exists.')
    if (existing?.passwordHash) {
      // An existing account answers in the app, signed in as the invited email. The link isn't used up
      // and signs no one in, so a forwarded email can't join anybody to anything.
      const inviter = l.invitedBy ? await users().findOne({ _id: l.invitedBy }) : null
      const already = !!(await memberships().findOne({ userId: existing._id, workspaceId: w._id }))
      return {
        purpose: l.purpose,
        invite: { id: String((l as MagicLink & { _id: ObjectId })._id), email: l.email, workspaceName: w.name, inviterName: inviter?.name ?? null, role: l.role ?? 'agent', already },
      }
    }
    await consumeLink(l)
    const pending = { pendingWorkspaceId: w._id, pendingRole: l.role ?? 'agent', ...(l.invitedBy ? { pendingInvitedBy: l.invitedBy } : {}), emailVerifiedAt: now }
    const id = existing?._id ?? randomUUID()
    if (existing) await users().updateOne({ _id: id }, { $set: pending })
    else await users().insertOne({ _id: id, email: l.email, name: '', createdAt: now, ...pending })
    await startSession(res, id)
    return { purpose: l.purpose, me: await me((await sessionFor(id))!) }
  }

  // signup
  if (existing?.passwordHash) throw new HttpError(409, 'You already have an account. Log in instead.')
  await consumeLink(l)
  const id = existing?._id ?? randomUUID()
  if (existing) await users().updateOne({ _id: id }, { $set: { emailVerifiedAt: now }, $unset: { pendingWorkspaceId: '', pendingInvitedBy: '' } })
  else await users().insertOne({ _id: id, email: l.email, name: '', emailVerifiedAt: now, createdAt: now })
  await startSession(res, id)
  return { purpose: l.purpose, me: await me((await sessionFor(id))!) }
}

/** The in-app account setup after the email is verified: name and password, then a new
 *  workspace (sign-up) or the inviting one (invite). */
async function finishSetup(x: Session, body: Obj) {
  if (x.setup !== 'account') throw new HttpError(400, 'Your account is already set up.')
  const name = text(body.name, 'your name')
  const pw = password(body.password)
  const joining = x.user.pendingWorkspaceId ? await workspaces().findOne({ _id: x.user.pendingWorkspaceId }) : null
  const workspaceName = joining ? null : text(body.workspaceName, 'a workspace name')
  await users().updateOne(
    { _id: x.user._id },
    { $set: { name, passwordHash: await hashPassword(pw) }, $unset: { pendingWorkspaceId: '', pendingInvitedBy: '', pendingRole: '' } },
  )
  if (joining) {
    if (!(await memberships().findOne({ userId: x.user._id, workspaceId: joining._id })))
      await memberships().insertOne({ workspaceId: joining._id, userId: x.user._id, role: x.user.pendingRole ?? 'agent', createdAt: new Date() })
    const inviter = x.user.pendingInvitedBy ? await users().findOne({ _id: x.user.pendingInvitedBy }) : null
    if (inviter) await mail.memberJoined(inviter.email, name, joining.name)
  } else await createWorkspace(x.user._id, workspaceName!)
  const after = (await sessionFor(x.user._id, joining?._id))!
  await mail.welcome(x.user.email, name, after.workspace?.name ?? '')
  return me(after)
}

const TITLES: Titles = {
  400: 'Check your details',
  502: 'Email not sent',
  401: 'Not logged in',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Already exists',
  410: 'Link expired',
  415: 'Unsupported request',
  429: 'Too many attempts',
}

/** Handles /api/auth/*, /api/account* and /api/workspace*. Returns false for other paths. */
export async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!/^\/api\/(auth|account|workspace)(\/|$)/.test(u.pathname)) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Accounts need the database. Set MONGODB_URI in .env and restart the server.' } }, () => route(req, res, u))
}
