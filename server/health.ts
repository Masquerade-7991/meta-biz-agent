// WhatsApp number health: quality rating, display-name review and the business's daily messaging
// limit, checked hourly and whenever Meta sends a quality or template webhook. A drop in quality or a
// paused/rejected template raises an owner alert (alerts.ts); recovery clears it.
import type http from 'node:http'
import { HttpError, type Obj, type Titles, arr, obj, serveJson, str } from './http.ts'
import { col, db, dbOffReason, ownsMetaAssets, withWorkspace, ws } from './db.ts'
import { env, metaJson, upstream } from './upstream.ts'
import { appUrl } from './mail.ts'
import { defineJob, enqueue } from './jobs.ts'
import { clearAlert, raiseAlert } from './alerts.ts'
import { trace } from './trace.ts'
import type { Actor } from './inbox.ts'
import { can } from '../src/app/lib/permissions.ts'
import { queueNumbersSync, syncNumbers } from './numbers.ts'

const health = () => col('number_health')
const LIMIT: Record<string, string> = { TIER_50: '50', TIER_250: '250', TIER_2K: '2,000', TIER_10K: '10,000', TIER_100K: '100,000', TIER_UNLIMITED: 'Unlimited' }
export const limitLabel = (t: string | null) => (t ? (LIMIT[t] ?? t) : null)

/** Reads every number of the workspace from Meta, stores it, and alerts on quality changes. */
export async function checkHealth() {
  if (!ownsMetaAssets()) return
  const accounts = await col('whatsapp_accounts').find({ workspaceId: ws() }).toArray()
  for (const a of accounts) {
    // The daily limit belongs to the business portfolio; older setups may not allow reading it.
    const limit = a.businessId
      ? await metaJson('graph', 'GET', `/${String(a.businessId)}?fields=whatsapp_business_manager_messaging_limit`).then(
          (r) => str(r.whatsapp_business_manager_messaging_limit) ?? null,
          () => null,
        )
      : null
    for (const n of (a.phoneNumbers ?? []) as Obj[]) {
      const id = String(n.id)
      const r = await metaJson('graph', 'GET', `/${id}?fields=display_phone_number,verified_name,quality_rating,name_status,status`)
      const now = { quality: str(r.quality_rating) ?? 'UNKNOWN', nameStatus: str(r.name_status) ?? null, status: str(r.status) ?? null, limit, display: str(r.display_phone_number) ?? String(n.display ?? id), name: str(r.verified_name) ?? null }
      const before = await health().findOneAndUpdate({ workspaceId: ws(), phoneNumberId: id }, { $set: { ...now, checkedAt: new Date() } }, { upsert: true, returnDocument: 'before' })
      if (before?.quality !== now.quality) trace('number.quality', { phoneNumberId: id, from: before?.quality ?? null, to: now.quality })
      await qualityAlert(id, now.display, now.quality)
    }
  }
}

async function qualityAlert(id: string, display: string, quality: string) {
  const key = `quality:${id}`
  if (quality === 'GREEN' || quality === 'UNKNOWN' || quality === 'NA') return clearAlert(key)
  await raiseAlert({
    key: `${key}:${quality}`,
    severity: quality === 'RED' ? 'critical' : 'warning',
    title: `${display}: WhatsApp quality is ${quality === 'RED' ? 'low' : 'medium'}`,
    detail:
      quality === 'RED'
        ? 'Many customers blocked or reported your recent messages. WhatsApp may lower your daily limit. Pause marketing broadcasts and check your templates.'
        : 'Some customers blocked or reported your recent messages. Send marketing only to people who asked for it.',
    target: 'whatsapp',
  })
}

defineJob(
  'health.check',
  async () => {
    await checkHealth()
    await syncNumbers().catch(() => {})
    return { again: new Date(Date.now() + 3_600_000) }
  },
  { maxAttempts: 3 },
)
export const queueHealthCheck = () => enqueue('health.check', {}, { key: 'health.check' })
export async function startHealth() {
  if (!db) return
  for (const w of (await col('whatsapp_accounts').distinct('workspaceId')) as string[])
    await withWorkspace(w, async () => {
      if (!(await col('jobs').findOne({ workspaceId: ws(), key: 'health.check', status: { $in: ['queued', 'running'] } }))) await queueHealthCheck()
    })
}

// ---- webhooks (called from inbox.ts processChange) ----
const TEMPLATE_BAD: Record<string, string> = {
  PAUSED: 'was paused by WhatsApp because customers reported it. Broadcasts with it stop until it’s fixed.',
  DISABLED: 'was disabled by WhatsApp after repeated pauses. Create a new template instead.',
  REJECTED: 'was rejected. Check the reason in WhatsApp Manager, edit it and submit again.',
  FLAGGED: 'was flagged for low quality and may be paused soon.',
}
export async function onAccountWebhook(field: string, value: Obj) {
  // A display-name review finished: re-read the numbers so the new name (or refusal) shows.
  if (field === 'phone_number_name_update') {
    trace('number.name_reviewed', { decision: str(value.decision) ?? null, name: str(value.requested_verified_name) ?? null }, { entity: 'number', id: String(value.phone_number_id ?? value.display_phone_number ?? '') })
    await queueNumbersSync()
    return true
  }
  if (field === 'phone_number_quality_update') {
    trace('number.limit_update', { event: str(value.event) ?? null, limit: str(value.current_limit) ?? str(value.max_daily_conversations_per_business) ?? null })
    await queueHealthCheck()
    return true
  }
  if (field === 'message_template_status_update') {
    const event = String(value.event ?? '')
    const name = String(value.message_template_name ?? '')
    const lang = String(value.message_template_language ?? '')
    trace('template.status', { name, language: lang, event, reason: str(value.reason) ?? null })
    const key = `template:${name}:${lang}`
    if (TEMPLATE_BAD[event])
      await raiseAlert({
        key: `${key}:${event}`,
        severity: event === 'FLAGGED' ? 'warning' : 'critical',
        title: `Template “${name}” ${event.toLowerCase()}`,
        detail: `${name} (${lang}) ${TEMPLATE_BAD[event]}${str(value.reason) && value.reason !== 'NONE' ? ` Reason: ${String(value.reason)}.` : ''}`,
        target: 'broadcasts',
      })
    else if (event === 'APPROVED' || event === 'REINSTATED' || event === 'UNARCHIVED')
      for (const bad of Object.keys(TEMPLATE_BAD)) await clearAlert(`${key}:${bad}`)
    return true
  }
  // Template quality and category changes: kept as events (and in the raw archive).
  if (field === 'message_template_quality_update' || field === 'template_category_update') {
    trace(field === 'template_category_update' ? 'template.category' : 'template.quality', {
      name: str(value.message_template_name) ?? null,
      language: str(value.message_template_language) ?? null,
      from: str(value.previous_quality_score) ?? str(value.previous_category) ?? null,
      to: str(value.new_quality_score) ?? str(value.new_category) ?? null,
    })
    return true
  }
  // Meta's notices about the account itself: restrictions, bans, reviews, capability changes.
  if (field === 'account_alerts' || field === 'account_update' || field === 'business_capability_update') {
    const info = obj(value.alert_info)
    const event = str(value.event) ?? str(info.alert_type) ?? field
    trace('account.notice', { field, event, detail: str(info.alert_description) ?? str(obj(value.violation_info).violation_type) ?? null })
    const serious = /BAN|RESTRICT|DISABLE|VIOLATION|FLAG/i.test(event) || str(info.alert_severity) === 'CRITICAL'
    if (field !== 'business_capability_update' && (serious || field === 'account_alerts'))
      await raiseAlert({
        key: `account:${event}`,
        severity: serious ? 'critical' : 'warning',
        title: `WhatsApp account: ${event.replace(/_/g, ' ').toLowerCase()}`,
        detail: str(info.alert_description) ?? 'Meta sent a notice about your WhatsApp account. Check WhatsApp Manager for details.',
        target: 'whatsapp',
      })
    return true
  }
  return false
}

// ---- route ----
async function overview() {
  const rows = await health().find({ workspaceId: ws() }).sort({ display: 1 }).toArray()
  return rows.map((r) => ({ phoneNumberId: String(r.phoneNumberId), display: r.display, name: r.name, quality: r.quality, nameStatus: r.nameStatus, status: r.status, limit: r.limit, limitLabel: limitLabel(r.limit), checkedAt: r.checkedAt }))
}
const TITLES: Titles = { 403: 'Not allowed', 404: 'Not found', 502: 'WhatsApp didn’t answer' }
const DAY_MS = 86_400_000
type App = { id: string | null; name: string | null }

/** The apps Meta sends this account's events to (read-only GET subscribed_apps); null when unavailable. */
const subscribedApps = (): Promise<App[] | null> =>
  ownsMetaAssets()
    ? metaJson('graph', 'GET', '/WABA_ID/subscribed_apps').then(
        (r) => arr(r.data).map((x) => ({ id: str(obj(obj(x).whatsapp_business_api_data).id) ?? null, name: str(obj(obj(x).whatsapp_business_api_data).name) ?? null })),
        () => null,
      )
    : Promise.resolve(null)

/** Whether Meta's webhooks reach this app, what arrived, and which apps receive the account's events.
 *  The first list of apps seen is kept as a baseline, so the owner can check the business's own apps
 *  are all still there next to the listening one. Only a real Meta answer ever becomes a baseline
 *  (never a local test double), and only an owner's request records it. */
async function webhookStatus() {
  const since = new Date(Date.now() - DAY_MS)
  const [last, byField, inbox, apps] = await Promise.all([
    col('whatsapp_webhooks').findOne({ workspaceId: ws() }, { sort: { at: -1 }, projection: { at: 1 } }),
    col('whatsapp_webhooks')
      .aggregate<{ _id: string; n: number }>([
        { $match: { workspaceId: ws(), at: { $gte: since } } },
        { $unwind: '$payload.entry' },
        { $unwind: '$payload.entry.changes' },
        { $group: { _id: '$payload.entry.changes.field', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ])
      .toArray(),
    Promise.all([
      col('webhook_inbox').countDocuments({ processedAt: null }),
      col('webhook_inbox').countDocuments({ error: { $exists: true }, processedAt: null }),
      col('webhook_inbox').countDocuments({ unrouted: { $gt: 0 }, receivedAt: { $gte: new Date(Date.now() - 7 * DAY_MS) } }),
    ]),
    subscribedApps(),
  ])
  let baseline = await col('webhook_baseline').findOne({ workspaceId: ws() })
  if (!baseline && apps && !/localhost|127\.0\.0\.1/.test(upstream)) {
    baseline = { workspaceId: ws(), apps, at: new Date() } as never
    await col('webhook_baseline').updateOne({ workspaceId: ws() }, { $setOnInsert: baseline as never }, { upsert: true })
  }
  const secrets = env('WEBHOOK_APP_SECRETS').split(',').filter((x) => x.trim()).length
  return {
    lastAt: last?.at ?? null,
    callbackUrl: `${appUrl}/api/webhooks/whatsapp`,
    verifyTokenSet: !!env('WEBHOOK_VERIFY_TOKEN'),
    signatureChecked: secrets > 0,
    appsAccepted: secrets,
    /** The console's own listening app (APP_ID), to point it out in the list. */
    listenerAppId: env('APP_ID') || null,
    last24h: byField.map((f) => ({ field: f._id, count: f.n })),
    pending: inbox[0],
    failed: inbox[1],
    unknownNumbers: inbox[2],
    subscribedApps: apps,
    baseline: baseline ? { apps: baseline.apps, at: baseline.at } : null,
  }
}

/** "Mark current list as expected": after an intended change (an app added or removed on purpose). */
async function resetBaseline() {
  const apps = await subscribedApps()
  if (!apps) throw new HttpError(502, 'Couldn’t read the list from Meta right now. Try again.')
  await col('webhook_baseline').updateOne({ workspaceId: ws() }, { $set: { apps, at: new Date() } }, { upsert: true })
  trace('webhook.baseline_reset', { apps: apps.length })
  return webhookStatus()
}

const OWNER_ONLY = 'Only workspace owners can see or change webhook details.'

export async function handleHealth(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  // Webhook details (apps, ids, delivery) are the owner's: everyone else is refused here, not just hidden.
  if (path === '/api/whatsapp/webhook-status' || path === '/api/whatsapp/webhook-status/baseline') {
    const baseline = path.endsWith('/baseline')
    if ((baseline ? req.method !== 'POST' : req.method !== 'GET')) return false
    return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Webhook status needs the database.' } }, () => {
      if (!can(me.role, 'whatsapp.manage')) throw new HttpError(403, OWNER_ONLY)
      return baseline ? resetBaseline() : webhookStatus()
    })
  }
  if (path !== '/api/whatsapp/health') return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Number health needs the database.' } }, async () => {
    if (req.method === 'POST') {
      if (!ownsMetaAssets()) throw new HttpError(403, 'Connect a WhatsApp account first.')
      await checkHealth()
    } else if (req.method !== 'GET') throw new HttpError(404, 'Not found.')
    // First look: check now rather than show nothing.
    else if (ownsMetaAssets() && !(await health().findOne({ workspaceId: ws() }))) await checkHealth().catch(() => {})
    return overview()
  })
}
