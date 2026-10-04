// Write-through recording of relayed Meta traffic. Called after the upstream answered and the
// response was sent; never throws (errors are logged) and the relay never awaits it.
import { createHash } from 'node:crypto'
import { col, db, ws } from './db.ts'
import { isConfigCollection, mirror, mirrorCollection } from './mirror.ts'
import { stripSecrets } from './store.ts'
import { obj, str } from './http.ts'
import { parseJson, type CallLog, type Kind } from './upstream.ts'


/** Meta timestamps come as seconds or ms. */
export const toDate = (t: unknown) => (typeof t === 'number' && t > 0 ? new Date(t < 1e12 ? t * 1000 : t) : new Date())

/** `/123/agent_config/faq` or `/business/whatsapp/phone_numbers/123/thread_control` → phone + rest. */
export function splitPhone(pathname: string): { phone: string | null; rest: string } {
  const m = pathname.match(/^\/(?:business\/whatsapp\/phone_numbers\/)?(\d+)\/(.*)$/)
  return m ? { phone: m[1], rest: m[2] } : { phone: null, rest: pathname.replace(/^\//, '') }
}

/** 'agent_connectors/42/tools/77/run' → resource 'agent_connectors/tools', id '77'. Id segments contain a digit. */
export function resourceOf(rest: string): { resource: string; resourceId: string | null } {
  const segs = rest.split('/').filter((s) => s && s !== 'agent_config')
  const names = segs.filter((s) => !/\d/.test(s))
  if (segs.at(-1) === 'run' && /\d/.test(segs.at(-2) ?? '')) names.pop()
  return { resource: names.join('/'), resourceId: segs.filter((s) => /\d/.test(s)).at(-1) ?? null }
}

// Only these request-body fields reach the audit log; everything else (keys, secrets, message text,
// customer numbers, file bytes) is dropped. Values must be primitives, so nothing nested slips in.
const SUMMARY_KEYS = [
  'title', 'name', 'question', 'url', 'component_type', 'status', 'method', 'path', 'description', 'base_url',
  'auth_type', 'connector_protocol', 'ai_audience', 'action', 'file_name', 'channel',
  'rollout.enabled', 'handoff.message_selection', 'followup.enabled', 'followup.followup_interval_in_seconds',
  'request_definition.method', 'request_definition.path', 'event.type', 'user_auth_required',
]
export function summarize(body: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const k of SUMMARY_KEYS) {
    const v = k.split('.').reduce<unknown>((o, p) => obj(o)[p], body)
    if (typeof v === 'string') out[k] = v.slice(0, 200)
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

function actionOf(method: string, rest: string): string {
  if (rest === 'agent_test') return 'test'
  if (/(^|\/)run$/.test(rest) || rest.startsWith('agent-eval/run')) return 'run'
  return method === 'DELETE' ? 'delete' : method === 'PUT' || method === 'PATCH' ? 'update' : 'create'
}

/** Parses the request body for recording: JSON, or just the file name of a multipart upload. */
function bodyOf(raw: Buffer | undefined, contentType: string): unknown {
  if (!raw?.length) return {}
  if (contentType.includes('json')) return parseJson(raw.toString()) ?? {}
  const fileName = raw.toString('latin1').match(/name="file_name"\r\n\r\n([^\r]*)/)?.[1]
  return fileName ? { file_name: fileName } : {}
}

/** All string leaves of a value (eval_ids_by_score's shape isn't documented). */
const stringLeaves = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(stringLeaves) : v && typeof v === 'object' ? Object.values(v).flatMap(stringLeaves) : []

export interface Exchange {
  kind: Kind
  method: string
  path: string // resolved, with query
  reqBody?: Buffer
  contentType: string
  status: number
  resText: string
}

/** api_calls: one document per call to Meta. Never throws; a failed write is only logged. */
export function logApiCall(c: CallLog): void {
  if (!db) return
  const u = new URL(c.url)
  const { phone } = c.kind === 'meta' ? splitPhone(u.pathname) : { phone: null }
  col('api_calls')
    .insertOne({ workspaceId: ws(), phoneNumberId: phone, ...c, host: u.host, ...resourceOf(splitPhone(u.pathname).rest), ok: c.status >= 200 && c.status < 300 })
    .catch((err) => console.log(`api_calls write failed: ${err instanceof Error ? err.message : err}`))
}

export function record(x: Exchange): void {
  if (!db) return
  recordAsync(x).catch((err) => console.log(`record ${x.method} ${x.path} failed: ${err instanceof Error ? err.message : err}`))
}

async function recordAsync(x: Exchange) {
  if (x.status < 200 || x.status >= 300) return
  const u = new URL(x.path, 'http://x')
  const { phone, rest } = x.kind === 'meta' ? splitPhone(u.pathname) : { phone: null, rest: u.pathname.slice(1) }
  const at = new Date()
  const json = parseJson(x.resText)
  const res = obj(json)
  const body = x.method === 'GET' ? {} : bodyOf(x.reqBody, x.contentType)
  const b = obj(body)
  const base = { workspaceId: ws(), phoneNumberId: phone }
  const jobs: Promise<unknown>[] = []

  if (x.method !== 'GET') {
    const r = resourceOf(rest)
    // A create has no id in its path; Meta returns the new item's id in the response.
    const resourceId = r.resourceId ?? (str(res.id) ? String(res.id) : null)
    // Configuration changes keep their full contents (secrets blanked), so the log shows what changed to what.
    const data = x.kind === 'meta' && isConfigCollection(mirrorCollection(rest)) ? stripSecrets(body, true) : undefined
    jobs.push(
      col('audit_log').insertOne({ ...base, at, action: actionOf(x.method, rest), ...r, resourceId, status: x.status, summary: summarize(body), ...(data ? { data } : {}) }),
    )
  }
  if (x.kind === 'meta' && phone) jobs.push(mirror(phone, x.method, rest, u.searchParams, body, json))
  if (x.kind === 'meta' && phone) {
    if (x.method === 'POST' && rest === 'agent_test' && str(res.conversation_id)) {
      jobs.push(
        col('test_conversations').updateOne(
          { conversationId: res.conversation_id },
          {
            $setOnInsert: { ...base, createdAt: at },
            $set: { updatedAt: at },
            $push: {
              messages: {
                $each: [
                  { from: 'user', text: String(b.user_msg ?? ''), at },
                  {
                    from: 'agent',
                    text: String(res.agent_response ?? ''),
                    at: res.timestamp ? toDate(res.timestamp) : at,
                    messageId: str(res.message_id),
                    quickReplies: Array.isArray(res.quick_replies) ? res.quick_replies : undefined,
                    handoffReason: str(res.handoff_reason),
                    noResponseReason: str(res.no_response_reason),
                  },
                ],
              },
            } as never,
          },
          { upsert: true, ignoreUndefined: true },
        ),
      )
    } else if (x.method === 'POST' && rest === 'agent_event' && str(res.agent_event_id)) {
      const ev = obj(b.event)
      jobs.push(
        col('agent_events').updateOne(
          { agentEventId: res.agent_event_id },
          {
            $setOnInsert: {
              ...base,
              to: str(b.to),
              type: str(ev.type),
              description: str(ev.description),
              payload: str(ev.payload),
              status: str(res.status) ?? 'request_received',
              statusHistory: [{ status: str(res.status) ?? 'request_received', at }],
              createdAt: at,
              updatedAt: at,
            },
          },
          { upsert: true, ignoreUndefined: true },
        ),
      )
    } else if (x.method === 'GET' && rest.startsWith('agent_event/') && str(res.status)) {
      const agentEventId = rest.slice('agent_event/'.length)
      // Pushes history only when the status changed (the UI polls the same status repeatedly).
      jobs.push(
        col('agent_events').updateOne(
          { agentEventId, status: { $ne: res.status } },
          {
            $set: { status: res.status, errorMessage: str(res.error_message), skippedReason: str(res.skipped_reason), updatedAt: at },
            $push: { statusHistory: { status: res.status, at } } as never, // driver's $push typing rejects untyped docs
          },
          { ignoreUndefined: true },
        ),
      )
    } else if (rest === 'agent-eval/run' && x.method === 'POST' && str(res.job_id)) {
      const caseIds = (u.searchParams.get('eval_case_ids') ?? '').split(',').filter(Boolean)
      jobs.push(
        col('eval_runs').updateOne(
          { jobId: res.job_id },
          { $setOnInsert: { ...base, caseId: caseIds[0] ?? null, caseIds, status: 'QUEUED', startedAt: at } },
          { upsert: true },
        ),
      )
    } else if (rest === 'agent-eval/run' && x.method === 'GET' && (res.status === 'COMPLETED' || res.status === 'FAILED')) {
      const result = obj(res.result)
      const evalIds = stringLeaves(typeof result.eval_ids_by_score === 'string' ? parseJson(result.eval_ids_by_score) : result.eval_ids_by_score)
      jobs.push(
        col('eval_runs').updateOne(
          { jobId: u.searchParams.get('job_id') },
          {
            $setOnInsert: { ...base, caseId: null, startedAt: at },
            $set: { status: res.status, result: res.result ?? null, error: res.error ?? null, evalIds, completedAt: at },
          },
          { upsert: true },
        ),
      )
    } else if (rest === 'agent-eval/details' && x.method === 'GET' && Array.isArray(res.evaluations)) {
      const evalIds = (u.searchParams.get('eval_ids') ?? '').split(',').filter(Boolean)
      if (evalIds.length)
        jobs.push(col('eval_runs').updateMany({ phoneNumberId: phone, evalIds: { $in: evalIds } }, { $set: { evaluations: res.evaluations } }))
    } else if (rest === 'insights/conversations/turns' && x.method === 'GET') {
      const consumer = u.searchParams.get('user_phone_number') ?? ''
      jobs.push(saveTurns(phone, consumer, res.data))
    } else if (rest === 'agent_onboarding' && x.method === 'POST') {
      jobs.push(
        col('agents').updateOne({ _id: phone as never }, { $set: { workspaceId: ws(), onboardedAt: at }, $unset: { deletedAt: '' } }, { upsert: true }),
      )
    } else if (rest === 'delete_agent' && x.method === 'DELETE') {
      jobs.push(col('agents').updateOne({ _id: phone as never }, { $set: { deletedAt: at } }))
    } else if (
      rest === 'agent_config/settings' &&
      x.method === 'GET' &&
      // Meta answers 200 with an empty list for a number with no agent; only an agent_id means one exists.
      obj(Array.isArray(json) ? json[0] : json).agent_id
    ) {
      // A number whose settings carry an agent_id has an agent: make it known to the collectors.
      jobs.push(col('agents').updateOne({ _id: phone as never }, { $setOnInsert: { workspaceId: ws(), createdAt: at } }, { upsert: true }))
    }
  }
  await Promise.all(jobs)
}

/** Upserts Meta turns by turn_id. Shared with the traces collector. */
export async function saveTurns(phone: string, consumer: string, data: unknown) {
  if (!Array.isArray(data) || !/^\d+$/.test(consumer)) return
  const ops = data
    .map(obj)
    .filter((t) => str(t.turn_id))
    .map((t) => ({
      updateOne: {
        filter: { turnId: t.turn_id },
        update: {
          $set: {
            workspaceId: ws(),
            phoneNumberId: phone,
            consumer,
            conversationId: str(t.conversation_id) ?? null,
            ts: toDate(t.timestamp),
            e2eLatencyMs: typeof t.e2e_latency_ms === 'number' ? t.e2e_latency_ms : null,
            steps: Array.isArray(t.steps) ? t.steps : [],
          },
        },
        upsert: true,
      },
    }))
  if (ops.length) await col('conversation_traces').bulkWrite(ops, { ordered: false })
}

export const hash = (...parts: unknown[]) => createHash('sha1').update(parts.map(String).join('|')).digest('hex')
