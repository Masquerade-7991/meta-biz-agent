// Real calls to the Meta Business Agent API, via server/index.ts (npm run dev:server).
// PHONE_NUMBER_ID in a path is filled in server-side from .env, so the browser never holds IDs or tokens.
// Field names and paths follow developers.facebook.com/documentation/meta-business-agent/reference.
import type {
  ActionValue,
  Connection,
  ConnectionAction,
  ConnectionStatus,
  CustomSkill,
  DocumentFile,
  FaqRow,
  RichReply,
  RichReplyType,
  SliceKey,
  WebsiteSource,
  WebsiteStatus,
  WizardState,
} from '../wizard/types'
import { compileConfig } from '../wizard/compiler'
import type { EvalConversationResult, EvalScenario, TranscriptLine } from '../wizard/steps/evalData'

const AGENT = '/PHONE_NUMBER_ID'

/** Meta's StandardError shape, which the server also uses when the upstream is unreachable. */
export class MetaError extends Error {
  status: number
  constructor(status: number, title: string, detail: string) {
    super(detail ? `${title}: ${detail}` : title)
    this.status = status
  }
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { detail: text.slice(0, 300) }
  }
  if (!res.ok) {
    const e = (json ?? {}) as { title?: string; detail?: string; error?: { message?: string } }
    throw new MetaError(res.status, e.title ?? `HTTP ${res.status}`, e.detail ?? e.error?.message ?? '')
  }
  return json as T
}

export async function metaFetch<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/meta${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return parse<T>(res)
}

/** multipart/form-data upload; the browser sets the boundary, the server passes it through. */
async function metaUpload<T>(path: string, form: FormData): Promise<T> {
  return parse<T>(await fetch(`/api/meta${path}`, { method: 'POST', body: form }))
}

const q = (params: Record<string, string | number | boolean | undefined>) =>
  '?' +
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Meta sends several fields as JSON-encoded strings; parse them without trusting the shape. */
function jsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

/** Every item of a cursor-paginated list (ui-skills, conversation turns). */
async function listAllPages<T>(path: string): Promise<T[]> {
  const out: T[] = []
  let after: string | undefined
  for (let page = 0; page < 50; page++) {
    const r = await metaFetch<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      path + (path.includes('?') ? '&' : '?') + q({ after, limit: 100 }).slice(1),
    )
    out.push(...(r.data ?? []))
    after = r.paging?.cursors?.after
    if (!r.paging?.next || !after) break
  }
  return out
}

// ---- Server health (which WABA / number the local server is pointed at) ----
export interface ServerHealth {
  ok: boolean
  upstream: string
  hasToken: boolean
  businessName: string
  wabaId: string
  phoneNumberId: string
}
export async function getServerHealth(): Promise<ServerHealth | null> {
  try {
    const res = await fetch('/api/health')
    return res.ok ? ((await res.json()) as ServerHealth) : null
  } catch {
    return null
  }
}

// ---- Onboard / delete ----
export const checkEligibility = () => metaFetch<{ is_eligible: boolean }>(`${AGENT}/agent_eligibility`)
export const onboardAgent = () => metaFetch<{ agent_id: string }>(`${AGENT}/agent_onboarding`, 'POST', {})
export const deleteAgent = () => metaFetch<{ deleted_agent_id: string | null }>(`${AGENT}/delete_agent`, 'DELETE')

// ---- Test (not billed; 500 req/hour per number) ----
export interface AgentTestReply {
  message_id: string
  agent_response: string
  conversation_id: string
  timestamp?: number
  handoff_reason?: string
  no_response_reason?: string
  quick_replies?: string[]
}
export const sendTestMessage = (user_msg: string, conversation_id?: string) =>
  metaFetch<AgentTestReply>(`${AGENT}/agent_test`, 'POST', { user_msg, conversation_id })

// ---- Settings (partial update: only the fields sent change) ----
export function settingsBody(state: WizardState) {
  const { guardrails, replies } = state
  const s = compileConfig(state).settings
  const handoffSel = guardrails.handoffMessageSource ?? (guardrails.handoffMessageEnabled ? 'custom' : 'default')
  const followupCustom = (replies.followUpMessageSource ?? 'custom') === 'custom'
  return {
    rollout: s.rollout,
    // Handoff itself is automatic on Meta's side; only the message source is configurable.
    handoff: {
      enabled: true,
      message_selection: handoffSel.toUpperCase(),
      ...(handoffSel === 'custom' ? { message: guardrails.handoffMessage } : {}),
    },
    followup:
      replies.followUpEnabled && replies.followUpInterval > 0
        ? {
            enabled: true,
            followup_interval_in_seconds: replies.followUpInterval,
            ...(followupCustom ? { message: replies.followUpMessage } : {}),
          }
        : { enabled: false },
    ai_audience: s.ai_audience,
    never_say_phrases: s.never_say_phrases,
  }
}
export const saveSettings = (state: WizardState) => metaFetch(`${AGENT}/agent_config/settings`, 'PUT', settingsBody(state))

/** Publish / Stop / Resume: only rollout + audience. */
export const setRollout = (enabled: boolean, audienceMode: WizardState['publish']['audienceMode']) =>
  metaFetch(`${AGENT}/agent_config/settings`, 'PUT', {
    rollout: { enabled },
    ai_audience: audienceMode === 'allowlisted' ? 'ALLOWLISTED_ONLY' : 'EVERYONE',
  })

interface MetaSettings {
  rollout?: { enabled?: boolean }
  handoff?: { enabled?: boolean; message?: string; message_selection?: string }
  followup?: { enabled?: boolean; followup_interval_in_seconds?: number; message?: string }
  ai_audience?: 'ALLOWLISTED_ONLY' | 'EVERYONE'
  never_say_phrases?: string[]
}

// ---- Business info (full replace) ----
export const saveBusinessInfo = (state: WizardState) =>
  metaFetch(`${AGENT}/agent_config/business_info`, 'PUT', compileConfig(state).business_info)

// ---- Skills ----
interface MetaSkill {
  id: string
  title: string
  description?: string
  skill: string
  status?: 'active' | 'pending_review' | 'blocked'
}

/** Meta requires skill titles to be lowercase letters, numbers and hyphens, max 64. */
export const skillTitle = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'skill'

export const listSkills = () => metaFetch<MetaSkill[]>(`${AGENT}/agent_config/skills`)

/** The Layer-1 skills compiled from Identity / Personality / Safety, upserted by title. Custom
 *  (Layer-2) skills are saved one by one from the Skills tab instead. */
export async function syncSkills(state: WizardState) {
  const existing = await listSkills()
  const byTitle = new Map(existing.map((s) => [s.title, s.id]))
  for (const s of compileConfig(state).skills.filter((k) => k.managed)) {
    const body = { title: skillTitle(s.title), description: s.description.slice(0, 1024), skill: s.skill.slice(0, 20000) }
    const id = byTitle.get(body.title)
    await (id ? metaFetch(`${AGENT}/agent_config/skills/${id}`, 'PUT', body) : metaFetch(`${AGENT}/agent_config/skills`, 'POST', body))
  }
}

const customSkillBody = (s: CustomSkill) => ({
  title: skillTitle(s.title || s.name),
  description: (s.description?.trim() || `Custom skill: ${s.name}.`).slice(0, 1024),
  skill: s.instruction.slice(0, 20000),
})
/** Create or update one custom skill; returns Meta's id and review status. */
export async function saveCustomSkill(s: CustomSkill): Promise<Pick<CustomSkill, 'metaId' | 'reviewStatus'>> {
  const r = s.metaId
    ? await metaFetch<MetaSkill>(`${AGENT}/agent_config/skills/${s.metaId}`, 'PUT', customSkillBody(s))
    : await metaFetch<MetaSkill>(`${AGENT}/agent_config/skills`, 'POST', customSkillBody(s))
  return { metaId: r.id, reviewStatus: r.status ?? 'pending_review' }
}
export const deleteSkill = (metaId: string) => metaFetch(`${AGENT}/agent_config/skills/${metaId}`, 'DELETE')

// ---- Allowlist (max 20 numbers) ----
export const addAllowlistNumber = (n: string) => metaFetch(`${AGENT}/agent_config/allowlist`, 'POST', { consumer_phone_number: n })

/** Removes by phone number, looking up Meta's entry id first. */
export async function removeAllowlistNumber(n: string) {
  const existing = await metaFetch<{ id: string; consumer_phone_number?: string }[]>(`${AGENT}/agent_config/allowlist`)
  const entry = existing.find((e) => e.consumer_phone_number === n)
  if (entry) await metaFetch(`${AGENT}/agent_config/allowlist/${entry.id}`, 'DELETE')
}

// ---- FAQs ----
interface MetaFaq {
  id: string
  question: string
  answer: string
  created_at?: number
}
export const createFaq = (question: string, answer: string) => metaFetch<MetaFaq>(`${AGENT}/agent_config/faq`, 'POST', { question, answer })
export const updateFaq = (id: string, question: string, answer: string) =>
  metaFetch<MetaFaq>(`${AGENT}/agent_config/faq/${id}`, 'PUT', { question, answer })
export const deleteFaq = (id: string) => metaFetch(`${AGENT}/agent_config/faq/${id}`, 'DELETE')

// ---- Files (≤100 MB; .pdf .doc .docx .png .jpg .jpeg .csv .xlsx) ----
export async function uploadFile(file: File): Promise<{ id: string; file_name: string }> {
  const form = new FormData()
  form.append('file_name', file.name)
  form.append('file', file, file.name)
  try {
    return await metaUpload(`${AGENT}/agent_config/files`, form)
  } catch (err) {
    // PRD 5.3.5(c) wording for the two statuses Meta documents.
    if (err instanceof MetaError && err.status === 409)
      throw new MetaError(409, `A file named ${file.name} already exists. Delete it first, or upload with a different name.`, '')
    if (err instanceof MetaError && err.status === 503)
      throw new MetaError(503, 'Upload service is temporarily unavailable. Please try again in a few minutes.', '')
    throw err
  }
}
export const deleteFile = (id: string) => metaFetch(`${AGENT}/agent_config/files/${id}`, 'DELETE')

// ---- Websites ----
interface MetaWebsite {
  id: string
  url: string
  crawl_status?: 'not_started' | 'pending' | 'in_progress' | 'completed' | 'completed_no_data' | 'failed'
  crawl_error?: string
  pages_crawled?: number
  last_crawled_at?: number
  created_at?: number
}
const CRAWL_STATUS: Record<NonNullable<MetaWebsite['crawl_status']>, WebsiteStatus> = {
  not_started: 'not_started',
  pending: 'waiting',
  in_progress: 'reading',
  completed: 'done',
  completed_no_data: 'done_no_data',
  failed: 'failed',
}
/** Meta timestamps may be seconds or ms. */
const toMs = (t?: number) => (t ? (t < 1e12 ? t * 1000 : t) : undefined)
export const websiteFields = (w: MetaWebsite): Partial<WebsiteSource> => ({
  metaId: w.id,
  url: w.url,
  status: CRAWL_STATUS[w.crawl_status ?? 'pending'],
  pagesRead: w.pages_crawled ?? 0,
  crawlError: w.crawl_error || undefined,
  lastCrawledAt: toMs(w.last_crawled_at),
  updatedAt: toMs(w.last_crawled_at) ?? Date.now(),
})
export const isCrawlDone = (s: WebsiteStatus) => s === 'done' || s === 'done_no_data' || s === 'failed'

export const addWebsite = (url: string) => metaFetch<MetaWebsite>(`${AGENT}/agent_config/websites`, 'POST', { url })
/** Also how a re-crawl is triggered: PUT the (same or new) URL. */
export const updateWebsite = (id: string, url: string) => metaFetch<MetaWebsite>(`${AGENT}/agent_config/websites/${id}`, 'PUT', { url })
export const deleteWebsite = (id: string) => metaFetch(`${AGENT}/agent_config/websites/${id}`, 'DELETE')

/** Polls one website until its crawl finishes, reporting every change. Gives up quietly after
 *  ~30 min (the row keeps its last known status; a page reload re-polls via hydrate). */
export async function pollWebsite(id: string, onUpdate: (fields: Partial<WebsiteSource>) => void, intervalMs = 5000) {
  for (let i = 0; i < 360; i++) {
    await sleep(intervalMs)
    let w: MetaWebsite
    try {
      w = await metaFetch<MetaWebsite>(`${AGENT}/agent_config/websites/${id}`)
    } catch (err) {
      if (err instanceof MetaError && err.status === 404) return // deleted meanwhile
      continue
    }
    const fields = websiteFields(w)
    onUpdate(fields)
    if (isCrawlDone(fields.status!)) return
  }
}

/** One poll per website across the whole app, patched straight into the knowledge slice, so
 *  leaving and re-opening the tab never starts a duplicate. */
const crawlsInFlight = new Set<string>()
export function trackCrawl(
  metaId: string,
  patchKnowledge: (fn: (prev: WizardState['knowledge']) => Partial<WizardState['knowledge']>) => void,
) {
  if (crawlsInFlight.has(metaId)) return
  crawlsInFlight.add(metaId)
  void pollWebsite(metaId, (fields) =>
    patchKnowledge((prev) => ({ websites: prev.websites.map((w) => (w.metaId === metaId ? { ...w, ...fields } : w)) })),
  ).finally(() => crawlsInFlight.delete(metaId))
}

// ---- Rich replies = Meta "UI skills" ----
interface MetaUiSkill {
  id: string
  title: string
  component_type: RichReplyType
  status: 'enabled' | 'disabled'
  instruction: string
  created_at?: number
}
export const createUiSkill = (r: RichReply) =>
  metaFetch<MetaUiSkill>(`${AGENT}/agent-ui-skills`, 'POST', {
    title: r.name,
    component_type: r.type,
    status: r.enabled ? 'enabled' : 'disabled',
    instruction: r.instructionSentence,
  })
/** Type can't change after creation (Meta and PRD V-c3); only title, status, instruction. */
export const updateUiSkill = (id: string, patch: { title?: string; status?: 'enabled' | 'disabled'; instruction?: string }) =>
  metaFetch<MetaUiSkill>(`${AGENT}/agent-ui-skills/${id}`, 'PUT', patch)
export const deleteUiSkill = (id: string) => metaFetch(`${AGENT}/agent-ui-skills/${id}`, 'DELETE')

// ---- Connectors + tools ----
type MetaConnStatus = 'PENDING_OAUTH' | 'ACTIVE' | 'EXPIRED' | 'ERROR'
interface MetaConnector {
  id: string
  name: string
  description: string
  base_url: string
  auth_type: string
  connector_protocol?: 'HTTP' | 'MCP'
  connection_status?: { status: MetaConnStatus; error_message?: string }
  mcp_tool_sync?: { status: 'PENDING' | 'READY' | 'ERROR'; tool_count?: number } | null
}
const CONN_STATUS: Record<MetaConnStatus, ConnectionStatus> = {
  ACTIVE: 'working',
  PENDING_OAUTH: 'waiting_signin',
  EXPIRED: 'key_rejected',
  ERROR: 'having_problems',
}
export const connectorFields = (c: MetaConnector): Partial<Connection> => ({
  metaId: c.id,
  name: c.name,
  description: c.description,
  baseUrl: c.base_url,
  protocol: c.connector_protocol === 'MCP' ? 'mcp' : 'http',
  demoStatus: c.connection_status ? CONN_STATUS[c.connection_status.status] : 'not_tested',
  mcpSync: c.mcp_tool_sync ? { status: c.mcp_tool_sync.status, toolCount: c.mcp_tool_sync.tool_count ?? 0 } : undefined,
})

function apiKeyConfig(c: Connection) {
  const keys = (c.apiKeys ?? []).filter((k) => k.value)
  const entry = (k: (typeof keys)[number]) => ({ field_name: k.fieldName, value: k.value, ...(k.prefix ? { prefix: k.prefix } : {}) })
  const headers = keys.filter((k) => k.location === 'header').map(entry)
  const query_params = keys.filter((k) => k.location === 'query').map(entry)
  return { ...(headers.length ? { headers } : {}), ...(query_params.length ? { query_params } : {}) }
}
function oauthConfig(c: Connection) {
  return {
    token_url: c.tokenUrl ?? '',
    scopes_to_request: c.scopes ?? [],
    token_request_content_type: c.tokenContentType === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
    client_id: c.clientId ?? '',
    client_secret: c.clientSecret ?? '',
  }
}
function connectorBody(c: Connection) {
  const auth_type = c.authMethod === 'api_key' ? 'API_KEY' : c.authMethod === 'client_credentials' ? 'OAUTH2_CLIENT_CREDENTIALS' : 'NONE'
  return {
    name: c.name,
    description: c.description || c.name,
    base_url: c.baseUrl,
    connector_protocol: c.protocol === 'mcp' ? 'MCP' : 'HTTP',
    auth_type,
    ...(auth_type === 'API_KEY' ? { auth_config: { api_key: apiKeyConfig(c) } } : {}),
    ...(auth_type === 'OAUTH2_CLIENT_CREDENTIALS' ? { auth_config: { oauth2_client_credentials: oauthConfig(c) } } : {}),
  }
}
/** Create or update; returns the Meta-derived fields to merge onto the local connection. */
export async function saveConnector(c: Connection): Promise<Partial<Connection>> {
  try {
    const r = c.metaId
      ? await metaFetch<MetaConnector>(`${AGENT}/agent_connectors/${c.metaId}`, 'PUT', connectorBody(c))
      : await metaFetch<MetaConnector>(`${AGENT}/agent_connectors`, 'POST', connectorBody(c))
    return connectorFields(r)
  } catch (err) {
    if (err instanceof MetaError && err.status === 409) throw new MetaError(409, `A connection named "${c.name}" already exists.`, '')
    throw err
  }
}
export const deleteConnector = (id: string) => metaFetch(`${AGENT}/agent_connectors/${id}`, 'DELETE')
/** Rotate key / connect: push the credentials already set on the connection. */
export async function upsertCredentials(c: Connection): Promise<Partial<Connection>> {
  const r =
    c.authMethod === 'client_credentials'
      ? await metaFetch<MetaConnector>(`${AGENT}/agent_connectors/${c.metaId}/upsertOAuth`, 'POST', { oauth_config: oauthConfig(c) })
      : await metaFetch<MetaConnector>(`${AGENT}/agent_connectors/${c.metaId}/upsertApiKey`, 'POST', { api_key_config: apiKeyConfig(c) })
  return connectorFields(r)
}
export const refreshMcpTools = async (id: string) =>
  connectorFields(await metaFetch<MetaConnector>(`${AGENT}/agent_connectors/${id}/refreshMCPTools`, 'POST', {}))

export interface ConnectorLogs {
  data: { event_time?: string; failure_code_name?: string; error_message?: string; tool_name?: string; occurrences?: number }[]
  stats?: { start_count: number; success_count: number; success_rate: number; avg_latency_s: number }
}
/** Last 7 days, the platform's own retention (PRD V-a5). */
export const connectorLogs = (id: string) =>
  metaFetch<ConnectorLogs>(
    `${AGENT}/agent_connectors/${id}/logs` +
      q({ start_time: Math.floor(Date.now() / 1000) - 7 * 86400 + 60, include_stats: true, limit: 1000 }),
  )

interface ParamNode {
  type: 'string' | 'integer' | 'number' | 'boolean'
  description?: string
  required?: boolean
  binding?: { kind: 'default' | 'macro'; value?: string; macro?: string }
}
interface MetaTool {
  id: string
  name: string
  description: string
  request_definition: {
    method: ConnectionAction['method']
    path: string
    path_parameters?: Record<string, ParamNode>
    query_parameters?: Record<string, ParamNode>
    headers?: Record<string, ParamNode>
    body?: { content_type: 'application/json'; params: Record<string, ParamNode>; required?: string[] } | null
  }
}

function paramNode(v: ActionValue): ParamNode {
  const binding: ParamNode['binding'] =
    v.source === 'fixed'
      ? { kind: 'default', value: v.fixedValue ?? '' }
      : v.source === 'whatsapp_number'
        ? { kind: 'macro', macro: 'WHATSAPP_PHONE_NUMBER' }
        : undefined // 'conversation' (and, pending review, 'conversation_memory'): the agent fills it in
  return {
    type: v.type === 'text' ? 'string' : v.type,
    ...(v.description ? { description: v.description } : {}),
    required: v.required,
    ...(binding ? { binding } : {}),
  }
}
function toolBody(a: ConnectionAction) {
  const at = (loc: ActionValue['location']) =>
    Object.fromEntries(a.values.filter((v) => v.location === loc && v.name).map((v) => [v.name, paramNode(v)]))
  const bodyValues = a.values.filter((v) => v.location === 'body' && v.name)
  return {
    name: a.name,
    description: a.description,
    user_auth_required: false,
    request_definition: {
      method: a.method,
      path: a.path,
      path_parameters: at('path'),
      query_parameters: at('query'),
      headers: at('header'),
      body: bodyValues.length
        ? { content_type: 'application/json', params: at('body'), required: bodyValues.filter((v) => v.required).map((v) => v.name) }
        : null,
    },
  }
}
export async function saveTool(connectorMetaId: string, a: ConnectionAction): Promise<string> {
  const base = `${AGENT}/agent_connectors/${connectorMetaId}/tools`
  const r = a.metaId ? await metaFetch<MetaTool>(`${base}/${a.metaId}`, 'PUT', toolBody(a)) : await metaFetch<MetaTool>(base, 'POST', toolBody(a))
  return r.id
}
export const deleteTool = (connectorMetaId: string, toolId: string) =>
  metaFetch(`${AGENT}/agent_connectors/${connectorMetaId}/tools/${toolId}`, 'DELETE')
/** Runs the tool live with the connector's stored credentials; output is the raw result. */
export const runTool = (connectorMetaId: string, toolId: string, input: Record<string, unknown> = {}) =>
  metaFetch<{ output: string; status: 'success' | 'error' }>(`${AGENT}/agent_connectors/${connectorMetaId}/tools/${toolId}/run`, 'POST', {
    input: JSON.stringify(input),
  })

/** A Meta tool as a local action (used for MCP-discovered tools and tools created elsewhere). */
export function toolToAction(t: MetaTool, connectionId: string, fromMcp: boolean): ConnectionAction {
  const values: ActionValue[] = []
  const add = (loc: ActionValue['location'], map?: Record<string, ParamNode>) =>
    Object.entries(map ?? {}).forEach(([name, n]) =>
      values.push({
        id: `${t.id}-${loc}-${name}`,
        name,
        type: n.type === 'string' ? 'text' : n.type,
        required: !!n.required,
        location: loc,
        source: n.binding?.kind === 'default' ? 'fixed' : n.binding?.macro === 'WHATSAPP_PHONE_NUMBER' ? 'whatsapp_number' : 'conversation',
        fixedValue: n.binding?.value,
        description: n.description ?? '',
      }),
    )
  const rd = t.request_definition ?? { method: 'GET', path: '' }
  add('path', rd.path_parameters)
  add('query', rd.query_parameters)
  add('header', rd.headers)
  add('body', rd.body?.params)
  return {
    id: `tool-${t.id}`,
    metaId: t.id,
    connectionId,
    name: t.name,
    description: t.description,
    method: rd.method,
    path: rd.path,
    values,
    createdAt: Date.now(),
    fromMcp,
  }
}
export const listTools = (connectorMetaId: string) => metaFetch<MetaTool[]>(`${AGENT}/agent_connectors/${connectorMetaId}/tools`)

// ---- Agent Eval ----
interface MetaEvalCase {
  id: string
  scenario: string
  categories?: string[]
  max_turns?: number
  success_criteria?: string[]
}
export async function listEvalCases(): Promise<EvalScenario[]> {
  const r = await metaFetch<{ eval_cases: MetaEvalCase[] }>(`${AGENT}/agent-eval/cases`)
  return (r.eval_cases ?? []).map((c) => ({
    id: c.id,
    title: c.scenario.length > 70 ? `${c.scenario.slice(0, 67)}...` : c.scenario,
    category: c.categories?.[0] ?? 'General',
    maxTurns: c.max_turns ?? 0,
    whatHappens: c.scenario,
    successCriteria: c.success_criteria ?? [],
  }))
}

export type EvalStage = 'simulation' | 'evaluation' | 'insights' | 'done'
interface MetaEvalJob {
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  progress?: { current_stage?: EvalStage }
  result?: {
    summary_id?: string
    avg_conversation_score?: number
    avg_turn_score?: number
    summary?: string
    highlights?: string
    top_failure_categories?: string
    eval_ids_by_score?: string
  }
  error?: { code?: string; message?: string }
}

/** All string leaves of a JSON value: eval_ids_by_score's exact shape isn't documented. */
const stringLeaves = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(stringLeaves) : v && typeof v === 'object' ? Object.values(v).flatMap(stringLeaves) : []
const textLines = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).description ?? (x as Record<string, unknown>).category ?? JSON.stringify(x)) : String(x)))
    .filter(Boolean)

function transcriptLines(raw: unknown): TranscriptLine[] {
  const t = jsonField<{ transcript_turns?: unknown[] } | unknown[]>(raw, [])
  const turns = Array.isArray(t) ? t : (t.transcript_turns ?? [])
  return turns.flatMap((turn): TranscriptLine[] => {
    if (!turn || typeof turn !== 'object') return []
    const o = turn as Record<string, unknown>
    // A turn may be one message ({role, content}) or a pair ({user, agent}).
    if ('user' in o || 'agent' in o || 'assistant' in o) {
      return [
        ...(o.user ? [{ from: 'customer' as const, text: String(o.user) }] : []),
        ...(o.agent || o.assistant ? [{ from: 'agent' as const, text: String(o.agent ?? o.assistant) }] : []),
      ]
    }
    const role = String(o.role ?? o.speaker ?? o.from ?? '').toLowerCase()
    const text = String(o.content ?? o.text ?? o.message ?? '')
    return text ? [{ from: /user|customer|consumer|human/.test(role) ? 'customer' : 'agent', text }] : []
  })
}

/** Runs one eval case end to end: submit, poll every 3 s (reporting stage), fetch details.
 *  `isCurrent` lets a newer run for the same card cancel this one. */
export async function runEvalCase(
  caseId: string,
  onStage: (stage: EvalStage) => void,
  isCurrent: () => boolean,
): Promise<EvalConversationResult | null> {
  const { job_id } = await metaFetch<{ job_id: string }>(`${AGENT}/agent-eval/run` + q({ eval_case_ids: caseId }), 'POST', {})
  for (let i = 0; i < 400; i++) {
    await sleep(3000)
    if (!isCurrent()) return null
    const job = await metaFetch<MetaEvalJob>(`${AGENT}/agent-eval/run` + q({ job_id }))
    if (job.progress?.current_stage) onStage(job.progress.current_stage)
    if (job.status === 'FAILED') throw new Error(job.error?.message || 'Could not complete the simulation.')
    if (job.status !== 'COMPLETED') continue
    const res = job.result ?? {}
    const ids = stringLeaves(jsonField(res.eval_ids_by_score, []))
    const details = ids.length
      ? (
          await metaFetch<{
            evaluations: { id: string; eval_case_id?: string; score?: number; reasons?: string; transcript?: string }[]
          }>(`${AGENT}/agent-eval/details` + q({ eval_ids: ids.join(',') }))
        ).evaluations ?? []
      : []
    const d = details.find((e) => e.eval_case_id === caseId) ?? details[0]
    const reasons = jsonField<{ category?: string; score?: number; description?: string; recommended_actions?: unknown }[]>(d?.reasons, [])
    return {
      scenarioId: caseId,
      // PRD AC11 / V9: whole number only.
      score: Math.round(res.avg_conversation_score ?? d?.score ?? 0),
      summary: res.summary ?? '',
      transcript: transcriptLines(d?.transcript),
      reasons: (Array.isArray(reasons) ? reasons : []).map((r) => ({
        category: r.category ?? 'General',
        score: Math.round(r.score ?? 0),
        description: r.description ?? '',
        recommendedAction: textLines(r.recommended_actions)[0],
      })),
      highlights: textLines(jsonField(res.highlights, [])),
      topFailures: textLines(jsonField(res.top_failure_categories, [])),
      avgTurnScore: res.avg_turn_score,
    }
  }
  throw new Error('Evaluation timed out.')
}

// ---- Agent events ----
export type MetaAgentEventStatus = 'request_received' | 'processing' | 'sent' | 'failed' | 'skipped' | 'success'
export const sendAgentEvent = (to: string, event: { type: string; description: string; payload: string }) =>
  metaFetch<{ status: string; agent_event_id?: string }>(`${AGENT}/agent_event`, 'POST', { to, event })
export const getAgentEvent = (id: string) =>
  metaFetch<{ status: MetaAgentEventStatus; event_type: string; error_message?: string; skipped_reason?: string; updated_at: string }>(
    `${AGENT}/agent_event/${id}`,
  )

// ---- Insights ----
export interface MetaTurn {
  turn_id: string
  timestamp?: number
  e2e_latency_ms?: number
  conversation_id: string
  steps: { type: 'LLM_CALL' | 'TOOL_CALL'; status?: 'SUCCESS' | 'ERROR' | 'TIMEOUT'; tool_name?: string }[]
}
/** Most recent conversation only. Phone must be digits with country code, no '+'. */
export const conversationTurns = (phone: string) =>
  listAllPages<MetaTurn>(`${AGENT}/insights/conversations/turns` + q({ user_phone_number: phone.replace(/\D/g, '') }))

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const lastDays = (n: number) => ({ start_date: isoDay(new Date(Date.now() - (n - 1) * 86400000)), end_date: isoDay(new Date()) })

/** AI threads over the last 30 days, plus the live count of handed-off conversations. */
export async function conversationInsights() {
  const r = await metaFetch<{ data: { ai_threads?: { count: number }; ai_handoffs?: { count: number } }[] }>(
    `${AGENT}/insights/conversations` + q(lastDays(30)),
  )
  return { aiThreads: r.data?.[0]?.ai_threads?.count ?? 0, aiHandoffs: r.data?.[0]?.ai_handoffs?.count ?? 0 }
}
export const toolCallInsights = () =>
  metaFetch<{ data: { tool_name: string; thread_count: number; success_rate?: number | null; avg_latency_ms?: number | null }[] }>(
    `${AGENT}/insights/tool_calls` + q(lastDays(30)),
  )

// ---- Thread control (human takeover; X-API-Version 1.0.0 is set by the server) ----
export const threadControl = (action: 'take' | 'release', to: string) =>
  metaFetch(`/business/whatsapp/phone_numbers/PHONE_NUMBER_ID/thread_control`, 'POST', {
    messaging_product: 'whatsapp',
    action,
    to: to.replace(/[^\d]/g, ''),
  })

// ---- Save-on-Next sections ----
/** What a section's Save pushes to Meta. Sections not listed save through their own per-row calls. */
export function pushSlice(slice: SliceKey, state: WizardState): Promise<unknown> {
  switch (slice) {
    case 'identity':
    case 'personalization':
      return syncSkills(state)
    case 'business':
      return saveBusinessInfo(state)
    case 'guardrails':
    case 'replies':
      // Grounding + system replies live in skills; handoff, follow-up and never-say live in settings.
      return Promise.all([saveSettings(state), syncSkills(state)])
    default:
      return Promise.resolve()
  }
}

// ---- Load everything from Meta when an agent opens ----
/** Merge Meta's list into the local one by metaId: matched rows take Meta's fields and keep
 *  local-only extras; Meta-only rows are added; local rows Meta no longer has are dropped; rows
 *  never sent to Meta (no metaId) are kept. */
export function reconcile<L extends { metaId?: string }, R extends { id: string }>(
  local: L[],
  remote: R[],
  fields: (r: R) => Partial<L>,
  create: (r: R) => L,
): L[] {
  const remoteById = new Map(remote.map((r) => [r.id, r]))
  const kept = local
    .filter((l) => !l.metaId || remoteById.has(l.metaId))
    .map((l) => (l.metaId ? { ...l, ...fields(remoteById.get(l.metaId)!) } : l))
  const known = new Set(local.map((l) => l.metaId).filter(Boolean))
  return [...kept, ...remote.filter((r) => !known.has(r.id)).map(create)]
}

type Patch = { [K in SliceKey]?: Partial<WizardState[K]> }

/** Reads every resource Meta holds for this agent and returns slice patches. Each read fails on
 *  its own, so one unreachable resource doesn't block the rest; failures are returned by name. */
export async function hydrateFromMeta(state: WizardState): Promise<{ patch: Patch; failed: string[] }> {
  const failed: string[] = []
  const get = async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch {
      failed.push(name)
      return null
    }
  }
  const [settings, businessInfo, faqs, files, websites, uiSkills, skills, allowlist, connectors] = await Promise.all([
    get('settings', () => metaFetch<MetaSettings>(`${AGENT}/agent_config/settings`)),
    get('business info', () => metaFetch<Record<string, unknown>>(`${AGENT}/agent_config/business_info`)),
    get('FAQs', () => metaFetch<MetaFaq[]>(`${AGENT}/agent_config/faq`)),
    get('documents', () => metaFetch<{ id: string; file_name: string }[]>(`${AGENT}/agent_config/files`)),
    get('websites', () => metaFetch<MetaWebsite[]>(`${AGENT}/agent_config/websites`)),
    get('rich replies', () => listAllPages<MetaUiSkill>(`${AGENT}/agent-ui-skills`)),
    get('skills', listSkills),
    get('allowlist', () => metaFetch<{ id: string; consumer_phone_number?: string }[]>(`${AGENT}/agent_config/allowlist`)),
    get('connectors', () => metaFetch<MetaConnector[]>(`${AGENT}/agent_connectors`)),
  ])
  const patch: Patch = {}
  const now = Date.now()

  if (settings) {
    const sel = settings.handoff?.message_selection?.toLowerCase() as 'default' | 'agent' | 'custom' | undefined
    patch.guardrails = {
      neverSayPhrases: settings.never_say_phrases ?? state.guardrails.neverSayPhrases,
      ...(sel ? { handoffMessageSource: sel, handoffMessageEnabled: sel === 'custom' } : {}),
      ...(settings.handoff?.message ? { handoffMessage: settings.handoff.message } : {}),
    }
    const f = settings.followup
    if (f) {
      patch.replies = {
        followUpEnabled: !!f.enabled,
        ...(f.followup_interval_in_seconds !== undefined
          ? { followUpInterval: f.followup_interval_in_seconds as WizardState['replies']['followUpInterval'] }
          : {}),
        ...(f.message ? { followUpMessage: f.message, followUpMessageSource: 'custom' as const } : {}),
      }
    }
    const enabled = !!settings.rollout?.enabled
    patch.publish = {
      activated: enabled,
      stopped: !enabled && (state.publish.activated || state.publish.stopped),
      ...(settings.ai_audience ? { audienceMode: settings.ai_audience === 'EVERYONE' ? ('everyone' as const) : ('allowlisted' as const) } : {}),
    }
  }
  if (allowlist) {
    patch.publish = {
      ...patch.publish,
      allowlistNumbers: allowlist.map((e) => e.consumer_phone_number).filter((n): n is string => !!n),
    }
  }
  if (businessInfo) {
    const b = businessInfo as { business_description?: string; return_policy?: string; purchase_info?: string; delivery_and_shipping?: string; contact_info?: { email?: string; address?: string } }
    patch.business = {
      ...(b.business_description !== undefined ? { businessDescription: b.business_description } : {}),
      ...(b.return_policy !== undefined ? { returnPolicy: b.return_policy } : {}),
      ...(b.purchase_info !== undefined ? { purchaseInfo: b.purchase_info } : {}),
      ...(b.delivery_and_shipping !== undefined ? { deliveryAndShipping: b.delivery_and_shipping } : {}),
      ...(b.contact_info?.email !== undefined ? { contactEmail: b.contact_info.email } : {}),
      ...(b.contact_info?.address !== undefined ? { businessAddress: b.contact_info.address } : {}),
    }
  }
  const k = state.knowledge
  patch.knowledge = {
    faqs: faqs
      ? reconcile<FaqRow, MetaFaq>(
          k.faqs,
          faqs,
          (r) => ({ question: r.question, answer: r.answer }),
          (r) => ({ id: `faq-${r.id}`, metaId: r.id, question: r.question, answer: r.answer, createdAt: toMs(r.created_at) ?? now }),
        )
      : k.faqs,
    documents: files
      ? reconcile<DocumentFile, { id: string; file_name: string }>(
          k.documents,
          files,
          (r) => ({ fileName: r.file_name }),
          (r) => ({ id: `doc-${r.id}`, metaId: r.id, fileName: r.file_name, sizeBytes: 0, type: r.file_name.split('.').pop() ?? '', uploadedAt: now }),
        )
      : k.documents,
    websites: websites
      ? reconcile<WebsiteSource, MetaWebsite>(k.websites, websites, websiteFields, (r) => ({
          id: `site-${r.id}`,
          subpages: [],
          ...(websiteFields(r) as Omit<WebsiteSource, 'id' | 'subpages'>),
        }))
      : k.websites,
  }
  if (uiSkills) {
    patch.richReplies = {
      richReplies: reconcile<RichReply, MetaUiSkill>(
        state.richReplies.richReplies,
        uiSkills,
        (r) => ({ name: r.title, enabled: r.status === 'enabled', instructionSentence: r.instruction }),
        (r) =>
          ({
            id: `rr-${r.id}`,
            metaId: r.id,
            name: r.title,
            trigger: '',
            enabled: r.status === 'enabled',
            instructionSentence: r.instruction,
            createdAt: toMs(r.created_at) ?? now,
            type: r.component_type,
            blanks: null, // created elsewhere: shown as raw text with "Rebuild as a form"
          }) as RichReply,
      ),
    }
  }
  if (skills) {
    const managed = new Set(compileConfig(state).skills.filter((s) => s.managed).map((s) => skillTitle(s.title)))
    patch.personalization = {
      customSkills: reconcile<CustomSkill, MetaSkill>(
        state.personalization.customSkills,
        skills.filter((s) => !managed.has(s.title)),
        (r) => ({ reviewStatus: r.status, instruction: r.skill }),
        (r) => ({ id: `skill-${r.id}`, metaId: r.id, name: r.title, title: r.title, instruction: r.skill, createdAt: now, reviewStatus: r.status }),
      ),
    }
  }
  if (connectors) {
    const conns = reconcile<Connection, MetaConnector>(state.connections.connections, connectors, connectorFields, (r) => ({
      id: `conn-${r.id}`,
      authMethod: r.auth_type === 'API_KEY' ? 'api_key' : r.auth_type === 'OAUTH2_CLIENT_CREDENTIALS' ? 'client_credentials' : 'none',
      createdAt: now,
      ...(connectorFields(r) as Omit<Connection, 'id' | 'authMethod' | 'createdAt'>),
    }))
    const toolLists = await Promise.all(
      conns.filter((c) => c.metaId).map(async (c) => ({ c, tools: await get(`tools of ${c.name}`, () => listTools(c.metaId!)) })),
    )
    let actions = state.connections.actions.filter((a) => conns.some((c) => c.id === a.connectionId))
    for (const { c, tools } of toolLists) {
      if (!tools) continue
      const mine = actions.filter((a) => a.connectionId === c.id)
      const merged = reconcile<ConnectionAction, MetaTool>(
        mine,
        tools,
        (t) => ({ name: t.name, description: t.description }),
        (t) => toolToAction(t, c.id, c.protocol === 'mcp'),
      )
      actions = [...actions.filter((a) => a.connectionId !== c.id), ...merged]
    }
    patch.connections = { connections: conns, actions }
  }
  return { patch, failed }
}
