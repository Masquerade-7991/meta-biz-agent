// WhatsApp number health: quality rating, display-name review and the business's daily messaging
// limit, checked hourly and whenever Meta sends a quality or template webhook. A drop in quality or a
// paused/rejected template raises an owner alert (alerts.ts); recovery clears it.
import type http from 'node:http'
import { HttpError, type Obj, type Titles, serveJson, str } from './http.ts'
import { col, db, dbOffReason, ownsMetaAssets, withWorkspace, ws } from './db.ts'
import { env, metaJson } from './upstream.ts'
import { appUrl } from './mail.ts'
import { defineJob, enqueue } from './jobs.ts'
import { clearAlert, raiseAlert } from './alerts.ts'
import { trace } from './trace.ts'
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
  return false
}

// ---- route ----
async function overview() {
  const rows = await health().find({ workspaceId: ws() }).sort({ display: 1 }).toArray()
  return rows.map((r) => ({ phoneNumberId: String(r.phoneNumberId), display: r.display, name: r.name, quality: r.quality, nameStatus: r.nameStatus, status: r.status, limit: r.limit, limitLabel: limitLabel(r.limit), checkedAt: r.checkedAt }))
}
const TITLES: Titles = { 403: 'Not allowed', 404: 'Not found', 502: 'WhatsApp didn’t answer' }
/** Whether Meta's webhooks reach this app: the inbox only gets customers' words and media through them. */
async function webhookStatus() {
  const last = await col('whatsapp_webhooks').findOne({ workspaceId: ws() }, { sort: { at: -1 }, projection: { at: 1 } })
  return { lastAt: last?.at ?? null, callbackUrl: `${appUrl}/api/webhooks/whatsapp`, verifyTokenSet: !!env('WEBHOOK_VERIFY_TOKEN'), signatureChecked: !!env('APP_SECRET') }
}

export async function handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  if (path === '/api/whatsapp/webhook-status' && req.method === 'GET')
    return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Webhook status needs the database.' } }, webhookStatus)
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
