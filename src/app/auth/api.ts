// Calls to the server's account, workspace and member routes (server/auth.ts).
import { MetaError, parse } from '@/app/api/meta'
import { demoRoleNow, isDummyMode, storageKey } from '@/app/api/dummy'

import { can, canSetRole, isRole, type Role } from '@/app/lib/permissions'
export type { Role }
export interface Me {
  user: { id: string; name: string; email: string }
  workspace: { id: string; name: string } | null
  role: Role | null
  /** 'account': email verified, name/password/workspace still to set. 'password': opened a reset link. */
  setup: 'complete' | 'account' | 'password'
  /** Invited and still setting up: the workspace they'll join. */
  joining: { workspaceName: string; inviterName: string | null } | null
  /** Every workspace this person belongs to, with their role in each. */
  workspaces: { id: string; name: string; role: Role }[]
  /** Invites to further workspaces, answered in the app (Accept / Decline). */
  invites: PendingInvite[]
  /** A new login email waiting for its confirmation link. */
  pendingEmail?: string | null
}
export interface PendingInvite {
  id: string
  workspaceName: string
  inviterName: string | null
  role: Role
  expiresAt: string
}
export type LinkPurpose = 'signup' | 'invite' | 'reset' | 'email_change'
export interface Verified {
  purpose: LinkPurpose
  /** Signed in after verifying (all but email change). */
  me?: Me
  /** The new address, for an email change. */
  email?: string
  /** An invite to someone who already has an account: they accept it in the app, signed in as `email`. */
  invite?: { id: string; email: string; workspaceName: string; inviterName: string | null; role: Role; already: boolean }
}
export interface Member {
  userId: string
  name: string
  email: string
  role: Role
  joinedAt: string
}
/** An API token as listed: never the token itself, which is shown once when created. */
export interface ApiToken {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  /** The workspace-wide list only. */
  userId?: string
  ownerName?: string
  ownerEmail?: string
}
export interface Invite {
  id: string
  email: string
  role: Role
  invitedAt: string
  expiresAt: string
  /** When the email last went out (a resend moves it). */
  sentAt?: string
  /** Past its 7 days: the link no longer works, but it can be resent. */
  expired?: boolean
}
/** Someone who opened their invite and is still setting up their account. */
export interface Joining {
  userId?: string
  email: string
  role?: Role
  verifiedAt: string
}
export interface WorkspaceInfo {
  id: string
  name: string
  createdAt: string
  ownerId: string | null
}
/** Which emails this person gets from this workspace (the bell always shows everything). */
export interface NotificationPrefs {
  escalations: boolean
  assigned: boolean
  slaBreach: boolean
  budget: boolean
  digest: boolean
}
export interface SessionRow {
  id: string
  userAgent: string | null
  ip: string | null
  lastSeenAt: string | null
  createdAt: string
  current: boolean
}

// Dummy mode has no server: members and invites live in this tab, with the same role rules.
let demoMembers: Member[] = [
  { userId: 'demo', name: 'Demo User', email: 'demo@helo.ai', role: 'owner', joinedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
  { userId: 'demo-2', name: 'Riya Mehta', email: 'riya@example.com', role: 'supervisor', joinedAt: new Date(Date.now() - 12 * 86_400_000).toISOString() },
  { userId: 'demo-3', name: 'Arjun Das', email: 'arjun@example.com', role: 'agent', joinedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
]
const DAY = 86_400_000
let demoInvites: Invite[] = [
  { id: 'inv-demo-old', email: 'kabir@example.com', role: 'agent', invitedAt: new Date(Date.now() - 9 * DAY).toISOString(), sentAt: new Date(Date.now() - 9 * DAY).toISOString(), expiresAt: new Date(Date.now() - 2 * DAY).toISOString(), expired: true },
]
let demoJoining: Joining[] = [{ userId: 'demo-joining', email: 'meera@example.com', role: 'agent', verifiedAt: new Date(Date.now() - 3_600_000).toISOString() }]
/** The demo workspace's people, for other dummy areas (teams, routing). */
export const demoMemberList = () => demoMembers

// The demo person's own workspaces and invites, kept in this browser so a switch survives the reload.
const DEMO_KEY = storageKey('helo-demo-account')
const DEMO_START: Me = {
  user: { id: 'demo', name: 'Demo User', email: 'demo@helo.ai' },
  workspace: { id: 'demo', name: 'Helo Demo Store' },
  role: 'owner',
  setup: 'complete',
  joining: null,
  workspaces: [
    { id: 'demo', name: 'Helo Demo Store', role: 'owner' },
    { id: 'demo-agency', name: 'Brightside Agency', role: 'agent' },
  ],
  invites: [{ id: 'demo-invite', workspaceName: 'Northwind Retail', inviterName: 'Kabir Shah', role: 'supervisor', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }],
}
export function demoMe(): Me {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null') as Me | null
    if (saved?.workspaces) return saved
  } catch {
    // fall through to the starting state
  }
  return DEMO_START
}
function saveDemo(me: Me) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(me))
  } catch {
    // storage blocked: the change lasts until the next reload
  }
  return me
}
function dummyAccount(method: string, path: string, body: Record<string, unknown>): Me {
  const me = demoMe()
  const enter = (id: string): Me => {
    const w = me.workspaces.find((x) => x.id === id)
    if (!w) throw new MetaError(404, 'Not found', 'You’re not a member of that workspace.')
    return { ...me, workspace: { id: w.id, name: w.name }, role: w.role }
  }
  if (path === '/api/account/workspace') return saveDemo(enter(String(body.workspaceId)))
  const ans = path.match(/^\/api\/account\/invites\/([^/]+)\/(accept|decline)$/)
  if (ans) {
    const inv = me.invites.find((i) => i.id === ans[1])
    if (!inv) throw new MetaError(410, 'Link expired', 'This invite was revoked, has expired or was already answered.')
    const rest = { ...me, invites: me.invites.filter((i) => i.id !== inv.id) }
    if (ans[2] === 'decline') return saveDemo(rest)
    const id = `demo-${inv.id}`
    const joined = { ...rest, workspaces: [...rest.workspaces, { id, name: inv.workspaceName, role: inv.role }] }
    return saveDemo({ ...joined, workspace: { id, name: inv.workspaceName }, role: inv.role })
  }
  if (path === '/api/workspace' && method === 'POST') {
    const name = String(body.name ?? '').trim()
    if (!name) throw new MetaError(400, 'Check your details', 'Enter a workspace name.')
    const id = `demo-ws${Date.now()}`
    return saveDemo({ ...me, workspaces: [...me.workspaces, { id, name, role: 'owner' }], workspace: { id, name }, role: 'owner' })
  }
  if (path === '/api/workspace/leave') {
    if (me.role === 'owner' && me.workspace?.id === 'demo') throw new MetaError(400, 'Check your details', 'You’re the only owner. Make someone else an owner before you leave.')
    const left = me.workspaces.filter((w) => w.id !== me.workspace?.id)
    const next = left.at(-1)
    return saveDemo({ ...me, workspaces: left, workspace: next ? { id: next.id, name: next.name } : null, role: next?.role ?? null })
  }
  return me
}

function dummyWorkspace(method: string, path: string, body: Record<string, unknown>): unknown {
  const actor = demoRoleNow() as Role
  const deny = (detail: string): never => {
    throw new MetaError(403, 'Not allowed', detail)
  }
  if (path === '/api/workspace/members') {
    const now = Date.now()
    return { members: demoMembers, invites: demoInvites.map((i) => ({ ...i, expired: Date.parse(i.expiresAt) < now })), joining: demoJoining }
  }
  if (!can(actor, 'members.manage')) deny('Only owners and admins manage members.')
  if (path === '/api/workspace/invites') {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MetaError(400, 'Check your details', 'Enter a valid email address.')
    if (!isRole(body.role)) throw new MetaError(400, 'Check your details', 'Pick a role.')
    if (!canSetRole(actor, 'agent', body.role)) deny('Only owners can invite owners.')
    if (demoInvites.some((i) => i.email === email && Date.parse(i.expiresAt) > Date.now()) || demoMembers.some((m) => m.email === email)) throw new MetaError(409, 'Already exists', 'This person is already invited or in the workspace.')
    const now = new Date().toISOString()
    demoInvites = [{ id: `inv${Date.now()}`, email, role: body.role, invitedAt: now, sentAt: now, expiresAt: new Date(Date.now() + 7 * DAY).toISOString() }, ...demoInvites.filter((i) => i.email !== email)]
    return { ok: true }
  }
  const inv = path.match(/^\/api\/workspace\/invites\/([^/]+)(\/resend)?$/)
  if (inv) {
    const i = demoInvites.find((x) => x.id === inv[1])
    if (!i) throw new MetaError(404, 'Not found', 'That invite was already answered or revoked.')
    if (!canSetRole(actor, i.role, i.role)) deny('Only owners can change an invite to be an owner.')
    if (method === 'DELETE') demoInvites = demoInvites.filter((x) => x.id !== i.id)
    else {
      const now = new Date().toISOString()
      demoInvites = demoInvites.map((x) => (x.id === i.id ? { ...x, sentAt: now, expiresAt: new Date(Date.now() + 7 * DAY).toISOString(), expired: false } : x))
    }
    return { ok: true }
  }
  const join = path.match(/^\/api\/workspace\/joining\/([^/]+)$/)
  if (join && method === 'DELETE') {
    demoJoining = demoJoining.filter((j) => j.userId !== join[1])
    return { ok: true }
  }
  const mem = path.match(/^\/api\/workspace\/members\/([^/]+)$/)
  const target = mem && demoMembers.find((m) => m.userId === mem[1])
  if (mem && !target) throw new MetaError(404, 'Not found', 'That person isn’t in this workspace.')
  if (mem && target && method === 'DELETE') {
    if (!canSetRole(actor, target.role, 'agent')) deny('Only owners can remove owners.')
    demoMembers = demoMembers.filter((m) => m.userId !== mem[1])
  }
  if (mem && target && method === 'PUT') {
    if (!isRole(body.role)) throw new MetaError(400, 'Check your details', 'That isn’t a role.')
    if (!canSetRole(actor, target.role, body.role)) deny('Only owners can change owners.')
    if (target.role === 'owner' && body.role !== 'owner' && demoMembers.filter((m) => m.role === 'owner').length === 1) throw new MetaError(400, 'Check your details', 'A workspace needs at least one owner.')
    demoMembers = demoMembers.map((m) => (m.userId === mem[1] ? { ...m, role: body.role as Role } : m))
  }
  return { ok: true }
}

// The demo workspace's own details, and the demo person's profile, notifications and devices.
const demoWorkspaceCreated = new Date(Date.now() - 40 * DAY).toISOString()
let demoNotify: NotificationPrefs = { escalations: true, assigned: true, slaBreach: true, budget: true, digest: false }
let demoSessions: SessionRow[] = [
  { id: 'sess-this', userAgent: navigator.userAgent, ip: '203.0.113.10', lastSeenAt: new Date().toISOString(), createdAt: new Date(Date.now() - 2 * DAY).toISOString(), current: true },
  { id: 'sess-phone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', ip: '198.51.100.24', lastSeenAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), createdAt: new Date(Date.now() - 9 * DAY).toISOString(), current: false },
  { id: 'sess-laptop', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36', ip: '192.0.2.77', lastSeenAt: new Date(Date.now() - 6 * DAY).toISOString(), createdAt: new Date(Date.now() - 30 * DAY).toISOString(), current: false },
]
const DEMO_PASSWORD = 'demo-password'
const checkPassword = (p: unknown) => {
  if (String(p ?? '') !== DEMO_PASSWORD) throw new MetaError(400, 'Check your details', `That password isn’t right. (Demo: the password is “${DEMO_PASSWORD}”.)`)
}
function dummyWorkspaceInfo(method: string, path: string, body: Record<string, unknown>): unknown {
  const me = demoMe()
  const owner = demoMembers.find((m) => m.role === 'owner')?.userId ?? null
  const info = (): WorkspaceInfo => ({ id: me.workspace?.id ?? 'demo', name: demoMe().workspace?.name ?? '', createdAt: demoWorkspaceCreated, ownerId: owner })
  if (method === 'GET') return info()
  if (demoRoleNow() !== 'owner') throw new MetaError(403, 'Not allowed', 'Only owners can do this.')
  if (path === '/api/workspace' && method === 'PUT') {
    const name = String(body.name ?? '').trim()
    if (!name) throw new MetaError(400, 'Check your details', 'Enter a workspace name.')
    if (name.length > 80) throw new MetaError(400, 'Check your details', 'Keep the name to 80 characters.')
    const id = me.workspace?.id
    return saveDemo({ ...me, workspace: me.workspace && { ...me.workspace, name }, workspaces: me.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) })
  }
  if (path === '/api/workspace/transfer') {
    checkPassword(body.password)
    const to = demoMembers.find((m) => m.userId === body.userId)
    if (!to || to.userId === me.user.id) throw new MetaError(400, 'Check your details', 'Pick someone else in the workspace.')
    const stepDown = body.stepDown === true
    demoMembers = demoMembers.map((m) => (m.userId === to.userId ? { ...m, role: 'owner' } : m.userId === me.user.id && stepDown ? { ...m, role: 'admin' } : m))
    if (!stepDown) return me
    const id = me.workspace?.id
    return saveDemo({ ...me, role: 'admin', workspaces: me.workspaces.map((w) => (w.id === id ? { ...w, role: 'admin' } : w)) })
  }
  return info()
}
function dummyProfile(method: string, path: string, body: Record<string, unknown>): unknown {
  const me = demoMe()
  if (path === '/api/account' && method === 'PUT') {
    const name = String(body.name ?? '').trim()
    if (!name) throw new MetaError(400, 'Check your details', 'Enter your name.')
    demoMembers = demoMembers.map((m) => (m.userId === me.user.id ? { ...m, name } : m))
    return saveDemo({ ...me, user: { ...me.user, name } })
  }
  if (path === '/api/account/password') {
    checkPassword(body.currentPassword)
    if (String(body.newPassword ?? '').length < 8) throw new MetaError(400, 'Check your details', 'Use at least 8 characters.')
    demoSessions = demoSessions.filter((x) => x.current)
    const tokensRevoked = demoTokens.length
    demoTokens = []
    return { ok: true, tokensRevoked }
  }
  if (path === '/api/account/email') {
    checkPassword(body.password)
    const email = String(body.newEmail ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MetaError(400, 'Check your details', 'Enter a valid email address.')
    if (email === me.user.email) throw new MetaError(400, 'Check your details', 'That’s already your email.')
    saveDemo({ ...me, pendingEmail: email })
    return { ok: true }
  }
  if (path === '/api/account/email/cancel') {
    saveDemo({ ...me, pendingEmail: null })
    return { ok: true }
  }
  if (path === '/api/account/notifications') {
    if (method === 'PUT') demoNotify = { ...demoNotify, ...Object.fromEntries(Object.entries(body).filter(([k, v]) => Object.hasOwn(demoNotify, k) && typeof v === 'boolean')) }
    return demoNotify
  }
  if (path === '/api/account/sessions/revoke-others') {
    demoSessions = demoSessions.filter((x) => x.current)
    return { ok: true }
  }
  const one = path.match(/^\/api\/account\/sessions\/([^/]+)$/)
  if (one && method === 'DELETE') {
    if (demoSessions.find((x) => x.id === one[1])?.current) throw new MetaError(400, 'Check your details', 'To sign out here, use Log out.')
    demoSessions = demoSessions.filter((x) => x.id !== one[1])
    return { ok: true }
  }
  if (path === '/api/account/sessions') return { sessions: demoSessions }
  throw new MetaError(404, 'Not found', path)
}

// Dummy mode: tokens live in this tab and never work anywhere.
let demoTokens: ApiToken[] = []
function dummyTokens(method: string, path: string, body: Record<string, unknown>): unknown {
  const id = path.match(/\/tokens\/([^/]+)$/)?.[1]
  if (id && method === 'DELETE') {
    demoTokens = demoTokens.filter((t) => t.id !== id)
    return { ok: true }
  }
  if (method === 'POST') {
    const name = String(body.name ?? '').trim()
    if (!name) throw new MetaError(400, 'Check your details', 'Enter a name for the token.')
    const days = Number(body.expiresInDays ?? 90)
    const token = `hk_demo${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    const t: ApiToken = { id: `tok${Date.now()}`, name, prefix: token.slice(0, 10), createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null }
    demoTokens = [t, ...demoTokens]
    return { ...t, token }
  }
  const all = path.startsWith('/api/workspace/')
  return { tokens: demoTokens.map((t) => (all ? { ...t, userId: 'demo', ownerName: 'Demo User', ownerEmail: 'demo@helo.ai' } : t)) }
}

/** Dummy mode answers every account and workspace route in this browser, with the server's rules. */
function dummyAnswer(method: string, path: string, body: Record<string, unknown>): unknown {
  if (/^\/api\/(account|workspace)\/tokens(\/|$)/.test(path)) return dummyTokens(method, path, body)
  if (/^\/api\/account\/(workspace|invites\/)/.test(path) || (path === '/api/workspace' && method === 'POST') || path === '/api/workspace/leave') return dummyAccount(method, path, body)
  if (path === '/api/workspace' || path === '/api/workspace/transfer') return dummyWorkspaceInfo(method, path, body)
  if (path === '/api/account' || path.startsWith('/api/account/')) return dummyProfile(method, path, body)
  if (path === '/api/auth/me') return demoMe()
  if (path === '/api/auth/logout') return { ok: true }
  if (path.startsWith('/api/workspace/')) return dummyWorkspace(method, path, body)
  return undefined
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isDummyMode()) {
    const answer = dummyAnswer(method, path, (body ?? {}) as Record<string, unknown>)
    if (answer !== undefined) return answer as T
  }
  return parse<T>(
    await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

export const authApi = {
  me: () => call<Me>('GET', '/api/auth/me'),
  login: (email: string, password: string) => call<Me>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  signup: (email: string) => call<{ ok: true }>('POST', '/api/auth/signup', { email }),
  forgot: (email: string) => call<{ ok: true }>('POST', '/api/auth/forgot', { email }),
  verify: (token: string) => call<Verified>('POST', '/api/auth/verify', { token }),
  finishSetup: (body: { name: string; password: string; workspaceName?: string }) => call<Me>('POST', '/api/account/setup', body),
  newPassword: (password: string) => call<Me>('POST', '/api/account/new-password', { password }),
  createWorkspace: (name: string) => call<Me>('POST', '/api/workspace', { name }),
  switchWorkspace: (workspaceId: string) => call<Me>('POST', '/api/account/workspace', { workspaceId }),
  acceptInvite: (id: string) => call<Me>('POST', `/api/account/invites/${id}/accept`),
  declineInvite: (id: string) => call<Me>('POST', `/api/account/invites/${id}/decline`),
  leaveWorkspace: () => call<Me>('POST', '/api/workspace/leave'),
  updateName: (name: string) => call<Me>('PUT', '/api/account', { name }),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ ok: true; tokensRevoked?: number }>('POST', '/api/account/password', { currentPassword, newPassword }),
  changeEmail: (newEmail: string, password: string) => call<{ ok: true }>('POST', '/api/account/email', { newEmail, password }),
  cancelEmailChange: () => call<{ ok: true }>('POST', '/api/account/email/cancel'),
  notifications: () => call<NotificationPrefs>('GET', '/api/account/notifications'),
  saveNotifications: (p: Partial<NotificationPrefs>) => call<NotificationPrefs>('PUT', '/api/account/notifications', p),
  sessions: () => call<{ sessions: SessionRow[] }>('GET', '/api/account/sessions'),
  revokeSession: (id: string) => call<{ ok: true; current?: boolean }>('DELETE', `/api/account/sessions/${encodeURIComponent(id)}`),
  revokeOtherSessions: () => call<{ ok: true }>('POST', '/api/account/sessions/revoke-others'),
  workspace: () => call<WorkspaceInfo>('GET', '/api/workspace'),
  renameWorkspace: (name: string) => call<Me>('PUT', '/api/workspace', { name }),
  transferOwnership: (userId: string, password: string, stepDown: boolean) => call<Me>('POST', '/api/workspace/transfer', { userId, password, stepDown }),
  members: () => call<{ members: Member[]; invites: Invite[]; joining: Joining[] }>('GET', '/api/workspace/members'),
  cancelJoining: (userId: string) => call<{ ok: true }>('DELETE', `/api/workspace/joining/${encodeURIComponent(userId)}`),
  invite: (email: string, role: Role) => call<{ ok: true }>('POST', '/api/workspace/invites', { email, role }),
  resendInvite: (id: string) => call<{ ok: true }>('POST', `/api/workspace/invites/${id}/resend`),
  revokeInvite: (id: string) => call<{ ok: true }>('DELETE', `/api/workspace/invites/${id}`),
  setRole: (userId: string, role: Role) => call<{ ok: true }>('PUT', `/api/workspace/members/${userId}`, { role }),
  removeMember: (userId: string) => call<{ ok: true }>('DELETE', `/api/workspace/members/${userId}`),
  tokens: () => call<{ tokens: ApiToken[] }>('GET', '/api/account/tokens'),
  createToken: (name: string, expiresInDays: number) => call<ApiToken & { token: string }>('POST', '/api/account/tokens', { name, expiresInDays }),
  revokeToken: (id: string) => call<{ ok: true }>('DELETE', `/api/account/tokens/${id}`),
  workspaceTokens: () => call<{ tokens: ApiToken[] }>('GET', '/api/workspace/tokens'),
  revokeWorkspaceToken: (id: string) => call<{ ok: true }>('DELETE', `/api/workspace/tokens/${id}`),
}
