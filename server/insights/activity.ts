// The activity log: who did what in the workspace, read from `events` (trace.ts). The whole
// workspace's log is for owners and admins; one ticket's, the AI agent's or a number's history is
// readable wherever that item is. Sentences come from src/app/activity/activityText.ts.
import type http from 'node:http'
import { ObjectId } from 'mongodb'
import { HttpError, type Obj, type Titles, sendError, serveJson } from '../platform/http.ts'
import { col, db, dbOffReason, ws } from '../platform/db.ts'
import { currentAssets } from '../platform/context.ts'
import { can } from '../../src/app/lib/permissions.ts'
import { AREAS, QUIET_ACTIONS, activityText, isArea, type ActivityEvent, type Area } from '../../src/app/activity/activityText.ts'
import { tableCsv } from '../../src/app/reports/catalog.ts'
import { getSettings, needInScope } from '../support/index.ts'
import { addDays } from './collectors.ts'
import { dayStart } from './analytics.ts'
import type { Actor } from '../messaging/index.ts'

const PAGE = 50
const CSV_MAX = 10_000
/** Items whose history any member may read where the item is shown. */
const OPEN_ENTITIES = ['ticket', 'agent', 'number']

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const kindsOf = (areas: Area[]) => new RegExp(`^(${areas.flatMap((a) => AREAS[a].kinds).map(esc).join('|')})`)

/** The Mongo query for a request's filters. Throws 403 when the reader may not see it. */
async function queryOf(u: URL, me: Actor): Promise<Obj> {
  const p = u.searchParams
  const entity = p.get('entity')
  // The agent's number may come as the PHONE_NUMBER_ID placeholder, like every client path.
  const entityId = p.get('entityId') === 'PHONE_NUMBER_ID' ? (currentAssets()?.phoneNumberId ?? null) : p.get('entityId')
  const ref = (p.get('ref') ?? '').trim().toLowerCase()
  const q: Obj = { workspaceId: ws() }
  if (entity && entityId && OPEN_ENTITIES.includes(entity)) {
    if (entity === 'ticket') {
      const t = await col('tickets').findOne({ workspaceId: ws(), number: Number(entityId) }, { projection: { assigneeId: 1 } })
      if (!t) throw new HttpError(404, 'That ticket no longer exists.')
      await needInScope(me, t.assigneeId)
    }
    if (entity === 'number' && !can(me.role, 'numbers.view')) throw new HttpError(403, 'Supervisors and up see a number’s history.')
    q.entity = entity
    q.entityId = entityId
  } else {
    if (!can(me.role, 'traces.read')) throw new HttpError(403, 'Only owners and admins see the workspace’s activity.')
    if (entity && entityId) Object.assign(q, { entity, entityId })
  }
  // An error reference shows everything behind that error, plumbing included.
  if (/^[0-9a-f-]{8,36}$/.test(ref)) q.traceId = { $regex: `^${ref}` }
  else {
    const area = p.get('area')
    q.kind = { $regex: kindsOf(isArea(area) ? [area] : (Object.keys(AREAS) as Area[])) }
    q['data.action'] = { $nin: QUIET_ACTIONS }
  }
  const userId = p.get('userId')
  if (userId) q.userId = userId === 'system' ? null : userId
  const from = p.get('from')
  const to = p.get('to')
  const at: Obj = {}
  // A bare date is a whole day in the workspace's time zone (its support hours' zone); a full time is taken as is.
  const DAY = /^\d{4}-\d{2}-\d{2}$/
  const tz = (from && DAY.test(from)) || (to && DAY.test(to)) ? (await getSettings()).hours.timezone : 'UTC'
  if (from && !Number.isNaN(Date.parse(from))) at.$gte = DAY.test(from) ? dayStart(from, tz) : new Date(from)
  if (to && !Number.isNaN(Date.parse(to))) at.$lt = DAY.test(to) ? dayStart(addDays(to, 1), tz) : new Date(to)
  if (Object.keys(at).length) q.at = at
  const before = p.get('before')
  if (before && ObjectId.isValid(before)) q._id = { $lt: new ObjectId(before) }
  return q
}

/** Events, newest first, with each person's current name. */
async function read(q: Obj, limit: number): Promise<ActivityEvent[]> {
  const rows = await col('events').find(q).sort({ _id: -1 }).limit(limit).toArray()
  const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))]
  const names = new Map((await col('users').find({ _id: { $in: ids } as never }, { projection: { name: 1 } }).toArray()).map((u) => [String(u._id), String(u.name ?? '')]))
  return rows.map((r) => ({
    id: String(r._id),
    at: (r.at as Date).toISOString(),
    kind: String(r.kind),
    userId: (r.userId as string) ?? null,
    actor: r.userId ? names.get(String(r.userId)) || null : null,
    entity: (r.entity as string) ?? null,
    entityId: (r.entityId as string) ?? null,
    data: (r.data as Obj) ?? {},
    ...(r.changes ? { changes: r.changes as ActivityEvent['changes'] } : {}),
    traceId: (r.traceId as string) ?? null,
  }))
}

/** Names for ids that appear inside changes (assignees, team members, teams). */
async function namesFor(events: ActivityEvent[]) {
  const [users, teams] = await Promise.all([
    col('memberships').find({ workspaceId: ws() }, { projection: { userId: 1 } }).toArray().then((ms) => col('users').find({ _id: { $in: ms.map((m) => m.userId) } as never }, { projection: { name: 1 } }).toArray()),
    events.some((e) => e.changes?.teamId) ? col('teams').find({ workspaceId: ws() }, { projection: { name: 1 } }).toArray() : Promise.resolve([]),
  ])
  return Object.fromEntries([...users.map((u) => [String(u._id), String(u.name ?? '')]), ...teams.map((t) => [`team:${t._id}`, String(t.name)])])
}

const TITLES: Titles = { 403: 'Not allowed', 404: 'Not found' }
/** GET /api/activity (JSON, 50 a page; `before` = the last id seen) and /api/activity.csv. */
export async function handleActivity(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (u.pathname !== '/api/activity' && u.pathname !== '/api/activity.csv') return false
  if ((req.method ?? 'GET') !== 'GET') return false
  if (u.pathname === '/api/activity')
    return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'The activity log needs the database.' } }, async () => {
      const events = await read(await queryOf(u, me), PAGE + 1)
      return { events: events.slice(0, PAGE), more: events.length > PAGE, names: await namesFor(events) }
    })
  try {
    if (!db) throw new HttpError(503, 'The activity log needs the database.')
    const q = await queryOf(u, me)
    const events = await read(q, CSV_MAX)
    const names = await namesFor(events)
    // Capped: say so in the file and in a header, so nobody takes a partial log for the whole one.
    const total = events.length === CSV_MAX ? await col('events').countDocuments(q) : events.length
    const truncated = total > CSV_MAX
    const body = tableCsv({ columns: ['When (UTC)', 'Who', 'What', 'Item', 'Reference'], rows: events.map((e) => [e.at.replace('T', ' ').slice(0, 19), e.actor ?? (e.userId ? 'Former member' : 'System'), activityText(e, names), e.entity ? `${e.entity} ${e.entityId}` : '', e.traceId?.slice(0, 8) ?? '']) })
    const tail = truncated ? `${body.endsWith('\n') ? '' : '\r\n'}First ${CSV_MAX} rows of ${total}; narrow the dates\r\n` : ''
    res
      .writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="helo-activity-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
        ...(truncated && { 'x-truncated': String(total), 'access-control-expose-headers': 'x-truncated' }),
      })
      .end(body + tail)
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(500, 'The activity log couldn’t be built. Please try again.')
    sendError(res, e.status, TITLES[e.status] ?? (e.status === 503 ? dbOffReason : 'Something went wrong'), e.message)
  }
  return true
}
