// Typed client for the server's MongoDB-backed /api/store and /api/analytics routes.
// Every call returns null when the database isn't configured (503), the server can't be reached,
// or the route fails, so callers fall back to what they did before (localStorage, live Meta calls).
import { isDummyMode } from './dummy'
import { getActivePhoneNumberId, q, UNAUTHORIZED_EVENT } from './meta'
import type { AgentEventRow, AgentEventStatus, WizardState } from '../wizard/types'
import type { EvalConversationResult, TranscriptLine } from '../wizard/steps/evalData'

/** The store sends ISO strings; ms values are accepted too. */
export type Stamp = number | string
export const ms = (t: Stamp | undefined | null): number => (typeof t === 'number' ? t : t ? Date.parse(t) || 0 : 0)

async function storeFetch<T>(path: string, method = 'GET', body?: unknown): Promise<T | null> {
  if (isDummyMode()) return null // keep demo data out of the database
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    if (!res.ok) return null
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    return null
  }
}

const phone = () => getActivePhoneNumberId() ?? 'PHONE_NUMBER_ID'
const enc = encodeURIComponent

// ---- Agents list (deleted agents are excluded by the server) ----
export interface StoredAgent {
  phoneNumberId: string
  wabaId?: string
  displayName?: string
  createdAt?: Stamp
  everLive?: boolean
  lastOpenedAt?: Stamp
  onboardedAt?: Stamp
}
export const listStoredAgents = () => storeFetch<StoredAgent[]>('/api/store/agents')
/** Bulk upsert; used once to move the old localStorage entries into the store. */
export const putStoredAgents = (rows: StoredAgent[]) => storeFetch('/api/store/agents', 'PUT', rows)
export const putStoredAgent = (
  phoneNumberId: string,
  fields: Partial<Pick<StoredAgent, 'displayName' | 'everLive' | 'wabaId' | 'createdAt' | 'lastOpenedAt'>>,
) => storeFetch(`/api/store/agents/${enc(phoneNumberId)}`, 'PUT', fields)

// ---- Drafts ----
// Draft sync is enabled only once the studio has loaded the stored draft for this number, so the
// reset-then-open sequence on the agents list can never overwrite a stored draft with an empty one.
let draftSyncPhone: string | null = null
export const setDraftSyncPhone = (id: string | null) => void (draftSyncPhone = id)
export const getDraftSyncPhone = () => draftSyncPhone

/** Credentials never leave the browser; the server blanks the same fields again. */
export function stripSecrets(state: WizardState): WizardState {
  return {
    ...state,
    connectors: { ...state.connectors, apiKey: '', clientSecret: '' },
    connections: {
      ...state.connections,
      connections: state.connections.connections.map((c) => ({
        ...c,
        ...(c.apiKeys ? { apiKeys: c.apiKeys.map((k) => ({ ...k, value: '' })) } : {}),
        ...(c.clientSecret !== undefined ? { clientSecret: '' } : {}),
      })),
    },
    agentEvents: { ...state.agentEvents, secretKey: '' },
  }
}

const SECRET_KEYS = new Set(['clientSecret', 'token', 'password', 'apiKey', 'secretKey', 'value'])
/** `stored` with every blanked secret put back from `local` (arrays matched by `id`, else index). */
export function keepLocalSecrets<T>(stored: T, local: unknown): T {
  if (Array.isArray(stored)) {
    const l = Array.isArray(local) ? local : []
    return stored.map((item, i) => {
      const id = (item as { id?: unknown } | null)?.id
      const match = id !== undefined ? l.find((x) => (x as { id?: unknown } | null)?.id === id) : l[i]
      return keepLocalSecrets(item, match)
    }) as T
  }
  if (!stored || typeof stored !== 'object' || !local || typeof local !== 'object') return stored
  const l = local as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(stored).map(([k, v]) => [
      k,
      SECRET_KEYS.has(k) && v === '' && typeof l[k] === 'string' && l[k] ? l[k] : keepLocalSecrets(v, l[k]),
    ]),
  ) as T
}

export const getDraft = (phoneNumberId: string) =>
  storeFetch<{ state: Partial<WizardState> | null; updatedAt: Stamp | null }>(`/api/store/drafts/${enc(phoneNumberId)}`)
export const putDraft = (phoneNumberId: string, state: WizardState) =>
  storeFetch(`/api/store/drafts/${enc(phoneNumberId)}`, 'PUT', { state: stripSecrets(state) })

// ---- Test conversations (recorded by the server on every agent_test call) ----
interface StoredTestMessage {
  from: 'user' | 'agent'
  text: string
  at: Stamp
  quickReplies?: string[]
  handoffReason?: string
  noResponseReason?: string
}
export interface TestHistoryEntry {
  id: string
  startedAt: number
  messages: { from: 'customer' | 'agent' | 'system'; text: string; at: number; quickReplies?: string[] }[]
}
/** Past test chats in the Test tab's shape: handoffs and non-replies become the same system lines. */
export async function listTestConversations(): Promise<TestHistoryEntry[] | null> {
  const list = await storeFetch<{ conversationId: string; createdAt: Stamp; messages: StoredTestMessage[] }[]>(
    '/api/store/test-conversations' + q({ phone: phone() }),
  )
  return (
    list?.map((c) => ({
      id: c.conversationId,
      startedAt: ms(c.createdAt),
      messages: c.messages.flatMap((m): TestHistoryEntry['messages'] => {
        const at = ms(m.at)
        if (m.from === 'user') return [{ from: 'customer' as const, text: m.text, at }]
        return [
          ...(m.text ? [{ from: 'agent' as const, text: m.text, at, quickReplies: m.quickReplies }] : []),
          ...(m.handoffReason ? [{ from: 'system' as const, text: 'This message would hand off to a human agent here.', at }] : []),
          ...(!m.text && !m.handoffReason && m.noResponseReason
            ? [{ from: 'system' as const, text: `The agent did not reply: ${m.noResponseReason}`, at }]
            : []),
        ]
      }),
    })) ?? null
  )
}

// ---- Conversation traces (newest conversation first, turns oldest first) ----
export interface StoredTrace {
  conversationId: string
  consumer: string
  startedAt: Stamp
  endedAt: Stamp
  turns: {
    turnId: string
    ts: Stamp
    e2eLatencyMs: number | null
    steps: { type: 'LLM_CALL' | 'TOOL_CALL'; status?: 'SUCCESS' | 'ERROR' | 'TIMEOUT'; tool_name?: string; latency_ms?: number }[]
  }[]
}
export const listTraces = (consumer: string) =>
  storeFetch<StoredTrace[]>('/api/store/traces' + q({ phone: phone(), consumer: consumer.replace(/\D/g, '') }))

// ---- Audit log (newest first) ----
export interface AuditRow {
  at: Stamp
  action: 'create' | 'update' | 'delete' | 'test' | 'run'
  resource: string
  resourceId: string | null
  status: number | string
  summary: Record<string, string | number | boolean>
}
export const listAudit = (limit = 50) => storeFetch<AuditRow[]>('/api/store/audit' + q({ phone: phone(), limit }))

// ---- Eval runs (latest per case, raw Meta shapes) ----
interface RawEvalResult {
  avg_conversation_score?: number
  avg_turn_score?: number
  summary?: string
  highlights?: string
  top_failure_categories?: string
}
interface RawEvaluation {
  eval_case_id?: string
  score?: number
  reasons?: string
  transcript?: string
}
export interface StoredEvalRun {
  caseId: string
  jobId: string
  status: 'COMPLETED' | 'FAILED'
  startedAt: Stamp
  completedAt: Stamp
  result: RawEvalResult | null
  error: { message?: string } | null
  evaluations: RawEvaluation[] | null
}
export const listEvalRuns = () => storeFetch<StoredEvalRun[]>('/api/store/eval-runs' + q({ phone: phone() }))

const parseJson = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return (v as T) ?? fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}
const lines = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map((x) => (typeof x === 'string' ? x : String((x as Record<string, unknown>)?.description ?? (x as Record<string, unknown>)?.category ?? JSON.stringify(x))))
    .filter(Boolean)

/** A stored run in the shape runEvalCase returns (a leaner copy of its mapping in meta.ts). */
export function evalResultFromRun(run: StoredEvalRun): EvalConversationResult | null {
  if (run.status !== 'COMPLETED' || !run.result) return null
  const res = run.result
  const d = run.evaluations?.find((e) => e.eval_case_id === run.caseId) ?? run.evaluations?.[0]
  const reasons = parseJson<{ category?: string; score?: number; description?: string; recommended_actions?: unknown }[]>(d?.reasons, [])
  const t = parseJson<{ transcript_turns?: unknown[] } | unknown[]>(d?.transcript, [])
  const transcript = (Array.isArray(t) ? t : (t.transcript_turns ?? [])).flatMap((turn): TranscriptLine[] => {
    const o = (turn ?? {}) as Record<string, unknown>
    if ('user' in o || 'agent' in o || 'assistant' in o)
      return [
        ...(o.user ? [{ from: 'customer' as const, text: String(o.user) }] : []),
        ...(o.agent || o.assistant ? [{ from: 'agent' as const, text: String(o.agent ?? o.assistant) }] : []),
      ]
    const text = String(o.content ?? o.text ?? o.message ?? '')
    const role = String(o.role ?? o.speaker ?? o.from ?? '').toLowerCase()
    return text ? [{ from: /user|customer|consumer|human/.test(role) ? 'customer' : 'agent', text }] : []
  })
  return {
    scenarioId: run.caseId,
    score: Math.round(res.avg_conversation_score ?? d?.score ?? 0),
    summary: res.summary ?? '',
    transcript,
    reasons: (Array.isArray(reasons) ? reasons : []).map((r) => ({
      category: r.category ?? 'General',
      score: Math.round(r.score ?? 0),
      description: r.description ?? '',
      recommendedAction: lines(r.recommended_actions)[0],
    })),
    highlights: lines(parseJson(res.highlights, [])),
    topFailures: lines(parseJson(res.top_failure_categories, [])),
    avgTurnScore: res.avg_turn_score,
  }
}

// ---- Agent events ----
export async function listAgentEvents(): Promise<AgentEventRow[] | null> {
  const rows = await storeFetch<
    { agentEventId: string; to: string; type: string; description: string; payload: string; status: AgentEventStatus; errorMessage?: string; skippedReason?: string; createdAt: Stamp; updatedAt: Stamp }[]
  >('/api/store/agent-events' + q({ phone: phone() }))
  return (
    rows?.map(({ type, createdAt, updatedAt, ...r }) => ({
      ...r,
      id: r.agentEventId,
      eventType: type,
      createdAt: ms(createdAt),
      updatedAt: ms(updatedAt),
    })) ?? null
  )
}

// ---- Analytics ----
export const getTrend = (days: number) =>
  storeFetch<{ date: string; aiThreads: number | null; partial: boolean }[]>('/api/analytics/trend' + q({ phone: phone(), days }))
/** Open-handoff snapshots, oldest first. */
export const getHandoffs = (days: number) =>
  storeFetch<{ ts: Stamp; count: number }[]>('/api/analytics/handoffs' + q({ phone: phone(), days }))
