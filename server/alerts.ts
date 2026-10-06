// Workspace alerts for owners: things about the account (budget reached, number quality dropped,
// template paused) rather than one chat. Each alert has a key, so the same condition raises it once
// (until `cleared`). Owners see it in the bell and get one email; anyone can dismiss it for themselves.
import { col, ws } from './db.ts'
import { mail } from './mail.ts'
import { trace } from './trace.ts'

/** Where the bell takes you: a Settings tab or a page. */
export type AlertTarget = 'billing' | 'whatsapp' | 'broadcasts'
export interface Alert {
  key: string
  severity: 'warning' | 'critical'
  title: string
  detail: string
  target: AlertTarget
}
const alerts = () => col('alerts')
const PATH: Record<AlertTarget, string> = { billing: '/settings/billing', whatsapp: '/whatsapp', broadcasts: '/broadcasts' }

/** Raises an alert once per key. Returns true when it was new (and owners were emailed). */
export async function raiseAlert(a: Alert): Promise<boolean> {
  const r = await alerts().updateOne(
    { workspaceId: ws(), key: a.key },
    { $setOnInsert: { workspaceId: ws(), ...a, createdAt: new Date(), dismissedBy: [] } },
    { upsert: true },
  )
  if (!r.upsertedCount) return false
  trace('alert.raised', { key: a.key, severity: a.severity, target: a.target })
  const owners = await col('memberships').find({ workspaceId: ws(), role: { $in: ['owner', 'admin'] } }, { projection: { userId: 1 } }).toArray()
  const people = await col('users').find({ _id: { $in: owners.map((o) => o.userId) } }, { projection: { email: 1 } }).toArray()
  for (const p of people) await mail.alert(String(p.email), a.title, a.detail, { label: 'Open Helo.ai', path: PATH[a.target] }).catch(() => {})
  return true
}

/** The condition is over: the next time it happens it alerts again. */
export const clearAlert = (key: string) => alerts().deleteOne({ workspaceId: ws(), key })

/** Alerts this person hasn't dismissed, newest first (owners only: these are about the account). */
export async function openAlerts(userId: string) {
  return alerts().find({ workspaceId: ws(), dismissedBy: { $ne: userId } }).sort({ createdAt: -1 }).limit(20).toArray()
}
export const dismissAlert = (key: string, userId: string) => alerts().updateOne({ workspaceId: ws(), key }, { $addToSet: { dismissedBy: userId } })
