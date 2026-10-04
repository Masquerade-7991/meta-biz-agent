// Customer identity across phone numbers and business-scoped user IDs (src/app/lib/customer.ts).
// A webhook may name a customer by phone, by BSUID, or both. We store each customer under one key
// and remember the other ID on the contact, so a later webhook with only one of them still finds
// the same chat. When a BSUID-only customer later shows their number, their records move to it.
import { col, ws } from './db.ts'
import { arr, obj, str, type Obj } from './http.ts'
import { trace } from './trace.ts'
import { customerKey, isBsuid } from '../src/app/lib/customer.ts'

export interface WebhookContact {
  phone: string
  bsuid: string
  username?: string
  name?: string
}

/** contacts[] of a webhook value: wa_id (may be absent), user_id (the BSUID), username, profile name. */
export function webhookContacts(value: Obj): WebhookContact[] {
  return arr(value.contacts).map((c) => {
    const o = obj(c)
    return { phone: customerKey(o.wa_id), bsuid: str(o.user_id) ?? '', username: str(o.username), name: str(obj(o.profile).name) }
  })
}

/** Finds the webhook contact for a message's sender (by phone or BSUID). */
export const contactFor = (list: WebhookContact[], phone: string, bsuid: string) =>
  list.find((c) => (phone && c.phone === phone) || (bsuid && c.bsuid === bsuid))

/**
 * The key to store this customer under ('' when the event names nobody usable), and what to save on
 * their contact once the chat exists (`link`: the BSUID and username). Moves a BSUID-only history
 * onto the phone number the first time both arrive together.
 */
export async function resolveCustomer(phoneIn: unknown, bsuidIn: unknown, extra: { username?: string } = {}): Promise<{ key: string; link: Obj }> {
  const phone = customerKey(phoneIn)
  const bsuid = isBsuid(String(bsuidIn ?? '')) ? String(bsuidIn) : ''
  const link = { ...(bsuid && { bsuid }), ...(extra.username && { username: extra.username }) }
  if (phone) {
    if (bsuid && (await col('conversations').findOne({ workspaceId: ws(), phone: bsuid }))) await moveCustomer(bsuid, phone)
    return { key: phone, link }
  }
  if (!bsuid) return { key: '', link }
  // Number hidden: a contact that already links this BSUID to a number keeps the chat on that number.
  const known = await col('contacts').findOne({ workspaceId: ws(), bsuid, phone: { $ne: bsuid } }, { projection: { phone: 1 } })
  return { key: known ? String(known.phone) : bsuid, link }
}

/** Moves everything stored under `from` (a BSUID) to `to` (the phone number), merging when both exist. */
export async function moveCustomer(from: string, to: string) {
  const q = { workspaceId: ws(), phone: from }
  for (const name of ['messages', 'tickets', 'broadcast_recipients', 'presence']) await col(name).updateMany(q, { $set: { phone: to } })

  const [a, b] = await Promise.all([col('conversations').findOne(q), col('conversations').findOne({ workspaceId: ws(), phone: to })])
  if (a && b) {
    const latest = (k: string) => [a[k], b[k]].filter(Boolean).sort((x, y) => +y - +x)[0] ?? null
    await col('conversations').updateOne({ _id: b._id }, { $set: { lastMessageAt: latest('lastMessageAt'), lastInboundAt: latest('lastInboundAt'), unread: (a.unread ?? 0) + (b.unread ?? 0), assigneeId: b.assigneeId ?? a.assigneeId ?? null } })
    await col('conversations').deleteOne({ _id: a._id })
  } else if (a) await col('conversations').updateOne({ _id: a._id }, { $set: { phone: to } })

  const [ca, cb] = await Promise.all([col('contacts').findOne(q), col('contacts').findOne({ workspaceId: ws(), phone: to })])
  if (ca && cb) {
    await col('contacts').updateOne(
      { _id: cb._id },
      {
        $set: { name: cb.name ?? ca.name, username: ca.username ?? cb.username, bsuid: from, fields: { ...obj(ca.fields), ...obj(cb.fields) }, optedOut: !!(ca.optedOut || cb.optedOut) },
        $addToSet: { tags: { $each: arr(ca.tags) } },
      },
      { ignoreUndefined: true },
    )
    await col('contacts').deleteOne({ _id: ca._id })
  } else if (ca) await col('contacts').updateOne({ _id: ca._id }, { $set: { phone: to, bsuid: from } })
  trace('customer.linked', { merged: !!(a && b) }, { entity: 'conversation', id: to })
}
