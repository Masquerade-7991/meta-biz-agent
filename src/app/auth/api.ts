// Calls to the server's account, workspace and member routes (server/auth.ts).
import { parse } from '@/app/api/meta'

export type Role = 'owner' | 'member'
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
  invitedAt: string
  expiresAt: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  invite: (email: string) => call<{ ok: true }>('POST', '/api/workspace/invites', { email }),
  resendInvite: (id: string) => call<{ ok: true }>('POST', `/api/workspace/invites/${id}/resend`),
  revokeInvite: (id: string) => call<{ ok: true }>('DELETE', `/api/workspace/invites/${id}`),
  setRole: (userId: string, role: Role) => call<{ ok: true }>('PUT', `/api/workspace/members/${userId}`, { role }),
  removeMember: (userId: string) => call<{ ok: true }>('DELETE', `/api/workspace/members/${userId}`),
}
