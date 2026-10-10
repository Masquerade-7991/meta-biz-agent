// Reports for business review: any report as CSV (it opens in Excel), and schedules that email
// chosen reports daily, weekly or monthly with the headline numbers in the email and the full
// tables attached. The tables are built the same way as the print view (src/app/reports/catalog.ts).
import type http from 'node:http'
import { randomUUID } from 'node:crypto'
import { HttpError, type Obj, type Titles, obj, readJson, sendError, serveJson } from './http.ts'
import { col, db, dbOffReason, ws } from './db.ts'
import { currentAssets } from './context.ts'
import { defineJob, enqueue } from './jobs.ts'
import { mail } from './mail.ts'
import { trace } from './trace.ts'
import { getSettings } from './tickets.ts'
import { dayStart, logPage, overview, parseFilter } from './analytics.ts'
import { can } from '../src/app/lib/permissions.ts'
import { isoDay, type AnalyticsFilter, type LogPage } from '../src/app/analytics/types.ts'
import {
  isLogReport,
  isReport,
  nextRunDay,
  REPORTS,
  reportFile,
  reportTable,
  scheduleRange,
  tableCsv,
  type Cadence,
  type ReportId,
  type ReportSchedule,
} from '../src/app/reports/catalog.ts'
import type { Actor } from './inbox.ts'

const schedules = () => col('report_schedules')
const MAX_LOG_ROWS = 50_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** One report's CSV for a filter. Logs are read in pages up to 50,000 rows. */
export async function reportCsv(id: ReportId, f: AnalyticsFilter) {
  if (isLogReport(id)) {
    const first: LogPage = await logPage(id, f, 0, 1000)
    const rows = [...first.rows]
    for (let skip = 1000; skip < Math.min(first.total, MAX_LOG_ROWS); skip += 1000) rows.push(...(await logPage(id, f, skip, 1000)).rows)
    return tableCsv(reportTable(id, null, { ...first, rows }))
  }
  return tableCsv(reportTable(id, await overview(f), null))
}

// ---- schedules ----
const out = (s: Obj): ReportSchedule => ({
  id: String(s._id),
  name: String(s.name),
  reports: (s.reports as ReportId[]) ?? [],
  cadence: s.cadence as Cadence,
  hour: Number(s.hour),
  numbers: (s.numbers as string[]) ?? [],
  team: (s.team as string | null) ?? null,
  userIds: (s.userIds as string[]) ?? [],
  emails: (s.emails as string[]) ?? [],
  enabled: s.enabled !== false,
  lastSentAt: s.lastSentAt ? (s.lastSentAt as Date).toISOString() : null,
  nextRunAt: s.nextRunAt ? (s.nextRunAt as Date).toISOString() : null,
})

async function parseSchedule(b: Obj, me: Actor) {
  const name = String(b.name ?? '').trim().slice(0, 80)
  if (!name) throw new HttpError(400, 'Give the schedule a name.')
  const reports = (Array.isArray(b.reports) ? b.reports : []).filter(isReport)
  if (!reports.length) throw new HttpError(400, 'Pick at least one report.')
  const cadence = (['daily', 'weekly', 'monthly'] as const).find((c) => c === b.cadence)
  if (!cadence) throw new HttpError(400, 'Cadence must be daily, weekly or monthly.')
  const hour = Math.round(Number(b.hour))
  if (!(hour >= 0 && hour <= 23)) throw new HttpError(400, 'Pick an hour between 0 and 23.')
  const members = new Set((await col('memberships').find({ workspaceId: ws() }).toArray()).map((m) => String(m.userId)))
  const userIds = (Array.isArray(b.userIds) ? b.userIds : []).map(String).filter((id) => members.has(id))
  const emails = [...new Set((Array.isArray(b.emails) ? b.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
  const badEmail = emails.find((e) => !EMAIL_RE.test(e))
  if (badEmail) throw new HttpError(400, `${badEmail} isn’t an email address.`)
  if (emails.length && !can(me.role, 'settings.manage')) throw new HttpError(403, 'Only owners and admins send reports outside the workspace.')
  if (!userIds.length && !emails.length) throw new HttpError(400, 'Add at least one person to send it to.')
  if (userIds.length + emails.length > 25) throw new HttpError(400, 'Send it to 25 people at most.')
  const numbers = (Array.isArray(b.numbers) ? b.numbers : []).map(String).filter((id) => currentAssets()?.ids.has(id))
  return { name, reports, cadence, hour, numbers, team: b.team ? String(b.team) : null, userIds, emails, enabled: b.enabled !== false }
}

/** When a schedule next goes out: its hour on the next day its cadence allows, in the support time zone. */
async function nextRun(cadence: Cadence, hour: number, after = new Date()) {
  const tz = (await getSettings()).hours.timezone
  const today = isoDay(after, tz)
  for (const ranToday of [false, true]) {
    const day = nextRunDay(cadence, today, ranToday)
    const at = new Date(+dayStart(day, tz) + hour * 3_600_000)
    if (+at > +after) return at
  }
  return new Date(+after + 86_400_000)
}

async function plan(id: string, cadence: Cadence, hour: number) {
  const at = await nextRun(cadence, hour)
  await schedules().updateOne({ _id: id as never }, { $set: { nextRunAt: at } })
  await enqueue('report.send', { id }, { runAt: at, key: `report:${id}` })
  return at
}

/** Builds and emails one schedule now. Returns how many people it went to. */
async function sendSchedule(s: ReportSchedule) {
  const settings = await getSettings()
  const tz = settings.hours.timezone
  const range = scheduleRange(s.cadence, isoDay(new Date(), tz))
  const f: AnalyticsFilter = { ...range, numbers: s.numbers, team: s.team, person: null }
  const o = await overview(f)
  const files = []
  for (const id of s.reports) files.push({ filename: reportFile(id, range.from, range.to), content: await reportCsv(id, f) })
  const k = o.kpis
  const p = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`)
  const n = (v: number | null) => (v == null ? '–' : new Intl.NumberFormat('en').format(Math.round(v)))
  const m = (v: number | null) => (v == null ? '–' : `${Math.round(v)} min`)
  const table = {
    head: ['', 'This period', 'Before'],
    rows: [
      ['Conversations', n(k.conversations.value), n(k.conversations.prev)],
      ['Handled by AI alone', p(k.containment.value), p(k.containment.prev)],
      ['Satisfaction', p(k.csat.value), p(k.csat.prev)],
      ['Tickets resolved', n(k.ticketsResolved.value), n(k.ticketsResolved.prev)],
      ['Median first reply', m(k.medianFirstReplyMin.value), m(k.medianFirstReplyMin.prev)],
      ['Resolved on time', p(k.slaMet.value), p(k.slaMet.prev)],
      ['Escalations', n(k.escalations.value), n(k.escalations.prev)],
      [`Spend${o.currency ? ` (${o.currency})` : ''}`, n(k.spend.value), n(k.spend.prev)],
    ],
  }
  const users = await col('users').find({ _id: { $in: s.userIds } as never }).toArray()
  const to = [...new Set([...users.map((u) => String(u.email)), ...s.emails])]
  const workspace = String((await col('workspaces').findOne({ _id: ws() as never }))?.name ?? 'Your workspace')
  const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const period = range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`
  const q = new URLSearchParams({ from: range.from, to: range.to })
  if (s.numbers.length) q.set('agents', s.numbers.join(','))
  if (s.team) q.set('team', s.team)
  const path = `/analytics?${q}`
  for (const email of to) await mail.report(email, { name: s.name, workspace, period, table, path }, files)
  trace('report.sent', { reports: s.reports.length, recipients: to.length, cadence: s.cadence })
  return to.length
}

defineJob(
  'report.send',
  async (payload) => {
    const doc = await schedules().findOne({ _id: String(payload.id) as never, workspaceId: ws() })
    if (!doc || doc.enabled === false) return
    const s = out(doc)
    // Edited to a later time since this job was queued: wait for it.
    if (doc.nextRunAt && +(doc.nextRunAt as Date) - Date.now() > 60_000) return { again: doc.nextRunAt as Date }
    await sendSchedule(s)
    const at = await nextRun(s.cadence, s.hour, new Date(Date.now() + 60_000))
    await schedules().updateOne({ _id: doc._id }, { $set: { lastSentAt: new Date(), nextRunAt: at } })
    return { again: at }
  },
  { maxAttempts: 3 },
)

// ---- routes ----
async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  if (!can(me.role, 'reports.view')) throw new HttpError(403, 'Reports are for supervisors, admins and owners.')
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null

  if (path === '/api/reports' && m === 'GET') return REPORTS
  if (path === '/api/reports/schedules' && m === 'GET') return (await schedules().find({ workspaceId: ws() }).sort({ createdAt: 1 }).toArray()).map(out)
  if (path === '/api/reports/schedules' && m === 'POST') {
    const b = await parseSchedule(obj(await readJson(req)), me)
    if ((await schedules().countDocuments({ workspaceId: ws() })) >= 20) throw new HttpError(400, 'A workspace can have 20 schedules at most.')
    const id = randomUUID()
    await schedules().insertOne({ _id: id as never, workspaceId: ws(), ...b, createdBy: me._id, createdAt: new Date() })
    if (b.enabled) await plan(id, b.cadence, b.hour)
    trace('report.scheduled', { cadence: b.cadence, reports: b.reports.length })
    return out((await schedules().findOne({ _id: id as never }))!)
  }
  if ((seg = path.match(/^\/api\/reports\/schedules\/([0-9a-f-]{36})(\/send)?$/))) {
    const where = { _id: seg[1] as never, workspaceId: ws() }
    const doc = await schedules().findOne(where)
    if (!doc) throw new HttpError(404, 'That schedule no longer exists.')
    if (seg[2] && m === 'POST') return { sent: await sendSchedule(out(doc)) }
    if (m === 'PUT') {
      const b = await parseSchedule(obj(await readJson(req)), me)
      await schedules().updateOne(where, { $set: { ...b, updatedAt: new Date() } })
      if (b.enabled) await plan(seg[1], b.cadence, b.hour)
      else await schedules().updateOne(where, { $set: { nextRunAt: null } })
      return out((await schedules().findOne(where))!)
    }
    if (m === 'DELETE') {
      await schedules().deleteOne(where)
      await col('jobs').deleteMany({ workspaceId: ws(), key: `report:${seg[1]}`, status: 'queued' })
      return { ok: true }
    }
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 502: 'Email not sent' }
/** /api/reports, /api/reports/{id}.csv and /api/reports/schedules*. */
export async function handleReports(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (u.pathname !== '/api/reports' && !u.pathname.startsWith('/api/reports/')) return false
  const csv = u.pathname.match(/^\/api\/reports\/([a-z_]+)\.csv$/)
  if (csv && (req.method ?? 'GET') === 'GET') return downloadCsv(res, u, me, csv[1])
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Reports need the database.' } }, () => route(req, u, me))
}

/** GET /api/reports/{id}.csv: a file, not JSON, so it answers outside serveJson. */
async function downloadCsv(res: http.ServerResponse, u: URL, me: Actor, id: string): Promise<true> {
  try {
    if (!db) throw new HttpError(503, 'Reports need the database.')
    if (!can(me.role, 'reports.view')) throw new HttpError(403, 'Reports are for supervisors, admins and owners.')
    if (!isReport(id)) throw new HttpError(404, `No report called ${id}.`)
    const f = parseFilter(u, (await getSettings()).hours.timezone)
    const body = await reportCsv(id, f)
    trace('report.downloaded', { report: id })
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${reportFile(id, f.from, f.to)}"`, 'cache-control': 'no-store' }).end(body)
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(500, 'The report couldn’t be built. Please try again.')
    if (!(err instanceof HttpError)) console.log(`report ${id} failed: ${err instanceof Error ? err.message : err}`)
    sendError(res, e.status, TITLES[e.status] ?? (e.status === 503 ? dbOffReason : 'Something went wrong'), e.message)
  }
  return true
}

