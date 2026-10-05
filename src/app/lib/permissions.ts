// Who may do what in a workspace. Shared: the server enforces it on every route, the browser hides
// what someone can't do. Four roles, from most to least access.

export type Role = 'owner' | 'admin' | 'supervisor' | 'agent'
export const ROLES: { id: Role; label: string; description: string }[] = [
  { id: 'owner', label: 'Owner', description: 'Everything, including WhatsApp accounts, billing and other owners.' },
  { id: 'admin', label: 'Admin', description: 'Runs the workspace: people, AI agents, settings and broadcasts. Can’t change owners.' },
  { id: 'supervisor', label: 'Supervisor', description: 'Leads the team: sees every chat, reassigns tickets, sends broadcasts and reads reports.' },
  { id: 'agent', label: 'Agent', description: 'Answers customers: chats, tickets and contacts.' },
]
const RANK: Record<Role, number> = { owner: 3, admin: 2, supervisor: 1, agent: 0 }
export const roleLabel = (r: Role | null | undefined) => ROLES.find((x) => x.id === r)?.label ?? 'Member'
export const isRole = (v: unknown): v is Role => typeof v === 'string' && v in RANK

const AT_LEAST = (r: Role) => (Object.keys(RANK) as Role[]).filter((x) => RANK[x] >= RANK[r])
const MATRIX = {
  /** Connect or disconnect WhatsApp numbers, set the spending budget. */
  'whatsapp.manage': AT_LEAST('owner'),
  'billing.manage': AT_LEAST('owner'),
  /** Invite people, change roles, remove members (admins: not owners). */
  'members.manage': AT_LEAST('admin'),
  /** Support rules, contact fields, shared canned responses, automation, the AI agent's setup. */
  'settings.manage': AT_LEAST('admin'),
  'automation.manage': AT_LEAST('admin'),
  'agent.edit': AT_LEAST('admin'),
  'templates.delete': AT_LEAST('admin'),
  'billing.view': AT_LEAST('admin'),
  /** WhatsApp numbers: see their pages; change profiles, names, ice breakers and the block list. */
  'numbers.edit': AT_LEAST('admin'),
  'alerts.receive': AT_LEAST('admin'),
  'traces.read': AT_LEAST('admin'),
  /** Broadcasts and templates, contact import/delete and segments. */
  'broadcasts.send': AT_LEAST('supervisor'),
  'templates.create': AT_LEAST('supervisor'),
  'contacts.manage': AT_LEAST('supervisor'),
  /** Every chat and ticket regardless of the workspace's agent restriction; reassign others' work. */
  'chats.all': AT_LEAST('supervisor'),
  'tickets.reassign': AT_LEAST('supervisor'),
  'reports.view': AT_LEAST('supervisor'),
  'numbers.view': AT_LEAST('supervisor'),
} satisfies Record<string, Role[]>
export type Action = keyof typeof MATRIX

export const can = (role: Role | null | undefined, action: Action) => !!role && (MATRIX[action] as Role[]).includes(role)

/** Roles `actor` may give or take away: owners any; admins up to admin, never touching owners. */
export function canSetRole(actor: Role | null | undefined, from: Role, to: Role) {
  if (actor === 'owner') return true
  if (actor !== 'admin') return false
  return from !== 'owner' && to !== 'owner'
}
export const assignableRoles = (actor: Role | null | undefined) => ROLES.filter((r) => canSetRole(actor, 'agent', r.id))

/** Whether `me` may move work from `from` to `to` (user ids; null = nobody). Agents take unassigned
 *  work or let their own go; moving anyone else's needs tickets.reassign. */
export function mayAssign(role: Role | null | undefined, me: string, to: string | null, from: string | null | undefined) {
  if (can(role, 'tickets.reassign')) return true
  return (!from || from === me) && (to === null || to === me)
}
