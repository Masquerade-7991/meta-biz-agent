// What WhatsApp messaging costs this workspace, from Meta's own numbers: the WABA's pricing_analytics
// (per day, country, pricing category and type) is copied into spend_daily every 6 hours. Estimates
// use the rates this workspace actually paid over the last 30 days, per country and category, so
// nothing here is a hand-kept rate card. A monthly budget alerts owners at 80% and 100%.
import type http from 'node:http'
import { HttpError, type Titles, arr, obj, readJson, serveJson, str } from './http.ts'
import { col, db, dbOffReason, ownsMetaAssets, withWorkspace, ws } from './db.ts'
import { metaJson } from './upstream.ts'
import { defineJob, enqueue } from './jobs.ts'
import { raiseAlert } from './alerts.ts'
import { trace } from './trace.ts'
import { countryOf } from './dialCodes.ts'
import type { Actor } from './inbox.ts'

const DAY = 86_400_000
const spend = () => col('spend_daily')
const settings = () => col('billing')
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const month = (d = new Date()) => d.toISOString().slice(0, 7)

// ---- sync ----
export async function syncSpend() {
  if (!ownsMetaAssets()) return
  const end = Math.floor(Date.now() / 1000)
  const start = end - 35 * 86_400
  try {
    const r = await metaJson(
      'graph',
      'GET',
      `/WABA_ID?fields=currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE,COUNTRY)`,
    )
    const currency = str(r.currency) ?? null
    const points = arr(obj(arr(obj(r.pricing_analytics).data)[0]).data_points).map(obj)
    for (const p of points) {
      const day = isoDay(new Date(Number(p.start) * 1000))
      const key = { workspaceId: ws(), day, country: String(p.country ?? '??'), category: String(p.pricing_category ?? 'UNKNOWN'), type: String(p.pricing_type ?? 'REGULAR') }
      await spend().updateOne(key, { $set: { ...key, volume: Number(p.volume) || 0, cost: Number(p.cost) || 0, currency, syncedAt: new Date() } }, { upsert: true })
    }
    await settings().updateOne({ workspaceId: ws() }, { $set: { currency, lastSyncAt: new Date(), lastSyncError: null } }, { upsert: true })
    trace('billing.synced', { points: points.length })
    await checkBudget()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await settings().updateOne({ workspaceId: ws() }, { $set: { lastSyncError: message.slice(0, 300), lastSyncTriedAt: new Date() } }, { upsert: true })
    throw err
  }
}

defineJob(
  'billing.sync',
  async () => {
    await syncSpend()
    return { again: new Date(Date.now() + 6 * 3_600_000) }
  },
  { maxAttempts: 3 },
)

/** Every workspace with a WhatsApp account gets its 6-hourly sync (once; the job re-queues itself). */
export async function startBilling() {
  if (!db) return
  for (const w of (await col('whatsapp_accounts').distinct('workspaceId')) as string[]) await withWorkspace(w, ensureSync)
}
async function ensureSync() {
  if (!(await col('jobs').findOne({ workspaceId: ws(), key: 'billing.sync', status: { $in: ['queued', 'running'] } }))) await enqueue('billing.sync', {}, { key: 'billing.sync' })
}

// ---- budget ----
async function monthToDate() {
  const rows = await spend()
    .aggregate([{ $match: { workspaceId: ws(), day: { $gte: `${month()}-01` } } }, { $group: { _id: '$category', cost: { $sum: '$cost' }, volume: { $sum: '$volume' } } }])
    .toArray()
  return { total: rows.reduce((n, r) => n + r.cost, 0), byCategory: rows.map((r) => ({ category: String(r._id), cost: r.cost, volume: r.volume })).sort((a, z) => z.cost - a.cost) }
}

export async function checkBudget() {
  const s = await settings().findOne({ workspaceId: ws() })
  const budget = Number(s?.budget) || 0
  if (!budget) return
  const { total } = await monthToDate()
  const money = (n: number) => `${n.toFixed(2)} ${s?.currency ?? ''}`.trim()
  for (const [pct, severity] of [[100, 'critical'], [80, 'warning']] as const) {
    if (total < (budget * pct) / 100) continue
    await raiseAlert({
      key: `budget:${month()}:${pct}`,
      severity,
      title: pct === 100 ? 'WhatsApp spend reached this month’s budget' : 'WhatsApp spend passed 80% of this month’s budget',
      detail: `This month so far: ${money(total)} of your ${money(budget)} budget. Messages keep sending; the budget only alerts you.`,
      target: 'billing',
    })
    break
  }
}

// ---- estimates ----
/** Rate per message actually paid in the last 30 days, per country and category (billable messages only). */
async function rates() {
  const rows = await spend()
    .aggregate([
      { $match: { workspaceId: ws(), type: 'REGULAR', day: { $gte: isoDay(new Date(Date.now() - 30 * DAY)) }, volume: { $gt: 0 } } },
      { $group: { _id: { country: '$country', category: '$category' }, cost: { $sum: '$cost' }, volume: { $sum: '$volume' } } },
    ])
    .toArray()
  return new Map(rows.map((r) => [`${r._id.country}|${r._id.category}`, r.cost / r.volume]))
}

export interface Estimate {
  currency: string | null
  /** Estimated total for the people we have a rate for. */
  total: number
  /** People whose country we have no recent rate for (not in `total`). */
  unpriced: number
  countries: { country: string; people: number; rate: number | null }[]
}

/** Estimated cost of one `category` message to each customer key, from this workspace's recent rates. */
export async function estimate(keys: string[], category: string): Promise<Estimate> {
  const [r, s] = await Promise.all([rates(), settings().findOne({ workspaceId: ws() })])
  const by = new Map<string, number>()
  for (const k of keys) {
    const c = countryOf(k) ?? '??'
    by.set(c, (by.get(c) ?? 0) + 1)
  }
  const countries = [...by].map(([country, people]) => ({ country, people, rate: r.get(`${country}|${category.toUpperCase()}`) ?? null })).sort((a, z) => z.people - a.people)
  return {
    currency: (s?.currency as string | undefined) ?? null,
    total: countries.reduce((n, c) => n + (c.rate ?? 0) * c.people, 0),
    unpriced: countries.filter((c) => c.rate === null).reduce((n, c) => n + c.people, 0),
    countries,
  }
}

// ---- routes ----
async function overview() {
  await ensureSync()
  const s = await settings().findOne({ workspaceId: ws() })
  const days = await spend()
    .aggregate([{ $match: { workspaceId: ws(), day: { $gte: isoDay(new Date(Date.now() - 30 * DAY)) } } }, { $group: { _id: '$day', cost: { $sum: '$cost' }, volume: { $sum: '$volume' } } }, { $sort: { _id: 1 } }])
    .toArray()
  return {
    currency: s?.currency ?? null,
    budget: s?.budget ?? null,
    lastSyncAt: s?.lastSyncAt ?? null,
    lastSyncError: s?.lastSyncError ?? null,
    month: await monthToDate(),
    days: days.map((d) => ({ day: String(d._id), cost: d.cost, volume: d.volume })),
  }
}

async function route(req: http.IncomingMessage, path: string, me: Actor) {
  const m = req.method ?? 'GET'
  if (path === '/api/billing' && m === 'GET') return overview()
  if (path === '/api/billing' && m === 'PUT') {
    if (me.role !== 'owner') throw new HttpError(403, 'Only owners can set the budget.')
    const b = obj(await readJson(req))
    const budget = b.budget === null || b.budget === '' ? null : Number(b.budget)
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) throw new HttpError(400, 'The budget must be a positive amount, or empty for none.')
    await settings().updateOne({ workspaceId: ws() }, { $set: { budget } }, { upsert: true })
    trace('settings.updated', { area: 'billing', budget: budget !== null })
    await checkBudget()
    return overview()
  }
  if (path === '/api/billing/sync' && m === 'POST') {
    if (!ownsMetaAssets()) throw new HttpError(403, 'Connect a WhatsApp account first.')
    await syncSpend()
    return overview()
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 502: 'WhatsApp didn’t answer' }
export async function handleBilling(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  if (!path.startsWith('/api/billing')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Billing needs the database.' } }, () => route(req, path, me))
}
