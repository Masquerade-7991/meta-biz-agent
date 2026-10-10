// Calls to the server's account, workspace and member routes (server/auth.ts).
import { MetaError, parse } from '@/app/api/meta'
import { isDummyMode, storageKey } from '@/app/api/dummy'

import type { Role } from '@/app/lib/permissions'
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
export interface Invite {
  id: string
  email: string
  role: Role
  invitedAt: string
  expiresAt: string
}

// Dummy mode has no server: members and invites live in this tab, with the same role rules.
let demoMembers: Member[] = [
  { userId: 'demo', name: 'Demo User', email: 'demo@helo.ai', role: 'owner', joinedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
  { userId: 'demo-2', name: 'Riya Mehta', email: 'riya@example.com', role: 'supervisor', joinedAt: new Date(Date.now() - 12 * 86_400_000).toISOString() },
  { userId: 'demo-3', name: 'Arjun Das', email: 'arjun@example.com', role: 'agent', joinedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
]
let demoInvites: Invite[] = []
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
  if (path === '/api/workspace/members') return { members: demoMembers, invites: demoInvites, joining: [] }
  if (path === '/api/workspace/invites') {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MetaError(400, 'Check your details', 'Enter a valid email address.')
    if (demoInvites.some((i) => i.email === email) || demoMembers.some((m) => m.email === email)) throw new MetaError(409, 'Already exists', 'This person is already invited or in the workspace.')
    demoInvites = [{ id: `inv${Date.now()}`, email, role: (body.role as Role) ?? 'agent', invitedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }, ...demoInvites]
    return { ok: true }
  }
  const inv = path.match(/^\/api\/workspace\/invites\/([^/]+)/)
  if (inv) {
    if (method === 'DELETE') demoInvites = demoInvites.filter((i) => i.id !== inv[1])
    return { ok: true }
  }
  const mem = path.match(/^\/api\/workspace\/members\/([^/]+)$/)
  if (mem && method === 'DELETE') demoMembers = demoMembers.filter((m) => m.userId !== mem[1])
  if (mem && method === 'PUT') {
    const target = demoMembers.find((m) => m.userId === mem[1])
    if (target?.role === 'owner' && body.role !== 'owner' && demoMembers.filter((m) => m.role === 'owner').length === 1) throw new MetaError(400, 'Check your details', 'A workspace needs at least one owner.')
    demoMembers = demoMembers.map((m) => (m.userId === mem[1] ? { ...m, role: body.role as Role } : m))
  }
  return { ok: true }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isDummyMode() && (/^\/api\/account\/(workspace|invites\/)/.test(path) || path === '/api/workspace' || path === '/api/workspace/leave'))
    return dummyAccount(method, path, (body ?? {}) as Record<string, unknown>) as T
  if (isDummyMode() && path.startsWith('/api/workspace/')) return dummyWorkspace(method, path, (body ?? {}) as Record<string, unknown>) as T
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
    call<{ ok: true }>('POST', '/api/account/password', { currentPassword, newPassword }),
  changeEmail: (newEmail: string, password: string) => call<{ ok: true }>('POST', '/api/account/email', { newEmail, password }),
  members: () => call<{ members: Member[]; invites: Invite[]; joining: { email: string; verifiedAt: string }[] }>('GET', '/api/workspace/members'),
  invite: (email: string, role: Role) => call<{ ok: true }>('POST', '/api/workspace/invites', { email, role }),
  resendInvite: (id: string) => call<{ ok: true }>('POST', `/api/workspace/invites/${id}/resend`),
  revokeInvite: (id: string) => call<{ ok: true }>('DELETE', `/api/workspace/invites/${id}`),
  setRole: (userId: string, role: Role) => call<{ ok: true }>('PUT', `/api/workspace/members/${userId}`, { role }),
  removeMember: (userId: string) => call<{ ok: true }>('DELETE', `/api/workspace/members/${userId}`),
}
