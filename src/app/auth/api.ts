// Calls to the server's account, workspace and member routes (server/auth.ts).
import { MetaError, parse } from '@/app/api/meta'
import { isDummyMode } from '@/app/api/dummy'

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
}
export type LinkPurpose = 'signup' | 'invite' | 'reset' | 'email_change'
export interface Verified {
  purpose: LinkPurpose
  /** Signed in after verifying (all but email change). */
  me?: Me
  /** The new address, for an email change. */
  email?: string
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
