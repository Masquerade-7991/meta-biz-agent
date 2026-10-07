// The relay to Meta (server/app.ts forward, upstream.ts) and the Meta Business Agent endpoints the
// console calls through it (src/app/api/meta.ts), with what we learned the hard way (CLAUDE.md).
// These document Meta's API as we use it; Meta's reference is the source of truth.
import { area, d, o, type Op } from './helpers.ts'

const P = '/api/meta/PHONE_NUMBER_ID'
const read = (op: Omit<Op, 'meta' | 'who'>): Op => ({ ...op, meta: true })
const write = (op: Omit<Op, 'meta' | 'who'>): Op => ({ ...op, meta: true, who: 'agent.edit' })
const SKILL_TITLE =
  'Titles allow only lowercase letters, numbers and hyphens, with no hyphen at either end, 64 at most (Meta answers 400 otherwise). The console keeps the readable name and sends a slug (src/app/wizard/skillTitle.ts).'

const relay = (kind: 'meta' | 'graph'): Op => ({
  id: kind === 'meta' ? 'metaRelay' : 'graphRelay',
  summary: kind === 'meta' ? 'Any Meta Business Agent call' : 'Any Graph API call',
  description: [
    kind === 'meta'
      ? 'Forwards to Meta’s Business Agent API with the workspace’s token and `X-API-Version: 2.0.0` (`1.0.0` for thread control). Timeout 20 s (90 s for agent_test).'
      : 'Forwards to the Graph API with the workspace’s token. Timeout 20 s.',
    '`{path}` is the rest of Meta’s path and may contain slashes; the query string passes through. In it, the segments `PHONE_NUMBER_ID`, `WABA_ID` and `BUSINESS_ID` are replaced with the workspace’s own ids, so the browser never needs real ids. Any other 10+ digit id must belong to the workspace.',
    'Meta’s status and body come back unchanged. GET answers are cached briefly (Graph 10 min; agent settings 60 s; insight date ranges 5 min); identical reads already on their way share one Meta call; a Meta 429 on a read is retried once after Retry-After (max 10 s). Writes are never repeated.',
    'Local safety limit per number per rolling hour: 1000 calls per resource, 500 agent_test.',
  ].join('\n\n'),
  who: { text: 'Reads: any member. Writes (POST, PUT, PATCH, DELETE): Admin or above (`agent.edit`).' },
  params: { path: d('string', 'Meta’s path, e.g. PHONE_NUMBER_ID/agent_config/faq.') },
  ok: 'any',
  okDescription: 'Meta’s answer, passed through.',
  errors: {
    403: 'Not your WhatsApp account (an id that isn’t the workspace’s). / Only owners and admins change the AI agent. / No WhatsApp account connected.',
    429: 'Local safety limit reached (…). Or Meta’s own 429 (shared across everything using the same app and token).',
    502: 'Upstream unreachable: Meta didn’t answer in time.',
  },
})

export const meta = area('Meta Business Agent (via relay)', {
  '/api/meta/{path}': { get: relay('meta'), post: { ...relay('meta'), id: 'metaRelayWrite' } },
  '/api/graph/{path}': { get: relay('graph') },

  // ---- Agent lifecycle ----
  [`${P}/agent_eligibility`]: { get: read({ id: 'metaEligibility', summary: 'Can this number have an agent', ok: o({ is_eligible: 'boolean' }) }) },
  [`${P}/agent_onboarding`]: { post: write({ id: 'metaOnboard', summary: 'Create the agent on this number', body: o({}), ok: o({ agent_id: 'string' }) }) },
  [`${P}/delete_agent`]: { delete: write({ id: 'metaDeleteAgent', summary: 'Delete the agent', ok: o({ deleted_agent_id: 'string?' }) }) },
  [`${P}/agent_test`]: {
    post: write({
      id: 'metaAgentTest',
      summary: 'Chat with the agent as a test customer',
      description:
        'Not billed. Meta allows about 500 an hour per number. The reply doesn’t list tool calls; the conversation’s turns do, about a second later (insights/conversations/turns with user_phone_number=<conversation_id>). Meta sometimes answers 500 after ~30 s; just send again.',
      body: o({ 'user_msg*': 'string', conversation_id: d('string', 'Continue an earlier test chat.') }),
      ok: o({ conversation_id: 'string', agent_response: 'string', handoff_reason: 'string', quick_replies: 'string[]' }),
    }),
  },

  // ---- Configuration ----
  [`${P}/agent_config/settings`]: {
    get: read({ id: 'metaGetSettings', summary: 'Agent settings', description: 'Meta answers a one-item list (its docs show a plain object); read both.', ok: 'any' }),
    put: write({
      id: 'metaPutSettings',
      summary: 'Change agent settings (partial)',
      description:
        'Only the fields sent change. Safety & handoff sends handoff, followup and never_say_phrases only; Publish sends rollout and ai_audience (setRollout). Sending `rollout.enabled: true` for EVERYONE without a payment method in Meta’s Billing Hub makes Meta refuse the whole request (400 “A payment method is required to enable Meta Business Agent”).',
      body: o({
        rollout: o({ enabled: 'boolean' }),
        ai_audience: 'ALLOWLISTED_ONLY|EVERYONE',
        handoff: o({ enabled: 'boolean', message_selection: 'DEFAULT|AGENT|CUSTOM', message: d('string', 'Only with CUSTOM.') }),
        followup: o({ enabled: 'boolean', followup_interval_in_seconds: { type: 'integer', enum: [0, 300, 900, 1800, 3600, 7200, 28800, 86400] }, message: 'string' }),
        never_say_phrases: 'string[]',
      }),
      ok: 'any',
    }),
  },
  [`${P}/agent_config/business_info`]: {
    get: read({ id: 'metaGetBusinessInfo', summary: 'Business details the agent knows', ok: 'any' }),
    put: write({
      id: 'metaPutBusinessInfo',
      summary: 'Replace business details (full replace)',
      description: 'Send every field; missing ones are cleared.',
      body: o({
        payment_method: 'string',
        return_policy: 'string',
        purchase_info: 'string',
        delivery_and_shipping: 'string',
        business_description: 'string',
        contact_info: o({ email: 'string', hours_of_operation: 'string', address: 'string' }),
      }),
      ok: 'any',
    }),
  },
  [`${P}/agent_config/skills`]: {
    get: read({ id: 'metaListSkills', summary: 'Skills', ok: { type: 'array', items: o({ id: 'string', title: 'string', description: 'string', skill: 'string', status: 'active|pending_review|blocked' }) } }),
    post: write({
      id: 'metaCreateSkill',
      summary: 'Add a skill',
      description: `${SKILL_TITLE} Custom skills go through Meta’s review (status pending_review → active or blocked). The console also keeps its own managed skills (identity, style, grounding…) in sync by title.`,
      body: o({ 'title*': 'string', 'description*': d('string', 'Up to 1024 characters.'), 'skill*': d('string', 'The instruction, up to 20,000 characters.') }),
      ok: 'any',
    }),
  },
  [`${P}/agent_config/skills/{skillId}`]: {
    put: write({ id: 'metaUpdateSkill', summary: 'Change a skill', description: SKILL_TITLE, body: o({ title: 'string', description: 'string', skill: 'string' }), ok: 'any' }),
    delete: write({ id: 'metaDeleteSkill', summary: 'Delete a skill', ok: 'any' }),
  },
  [`${P}/agent-ui-skills`]: {
    get: read({ id: 'metaListUiSkills', summary: 'Rich replies (UI skills)', description: 'Cursor-paginated: `{data, paging}`; pass `after` and `limit`. Note the hyphenated path.', ok: 'any' }),
    post: write({
      id: 'metaCreateUiSkill',
      summary: 'Add a rich reply',
      description: `${SKILL_TITLE} Meta stores only title, type, status and a plain-language instruction; the console builds the instruction from its form (src/app/wizard/richReplies.ts) and keeps the form itself in its draft. The type can’t change later.`,
      body: o({
        'title*': 'string',
        'component_type*': 'cta_url|image|interactive_list|interactive_reply_buttons|carousel_url|carousel_quick_reply|location|location_request|flow',
        'status*': 'enabled|disabled',
        'instruction*': d('string', 'When to send it and every value, e.g. “If a customer asks for the menu, send a list message with the body text … and 3 rows: …”.'),
        flow_id: d('integer', 'Only for `flow`.'),
      }),
      ok: o({ id: 'string', title: 'string', component_type: 'string', status: 'string', instruction: 'string' }),
      okStatus: 201,
    }),
  },
  [`${P}/agent-ui-skills/{uiSkillId}`]: {
    put: write({ id: 'metaUpdateUiSkill', summary: 'Change a rich reply (partial)', description: SKILL_TITLE, body: o({ title: 'string', status: 'enabled|disabled', instruction: 'string' }), ok: 'any' }),
    delete: write({ id: 'metaDeleteUiSkill', summary: 'Delete a rich reply', ok: null, okStatus: 204 }),
  },
  [`${P}/agent_config/faq`]: {
    get: read({ id: 'metaListFaqs', summary: 'FAQs', ok: { type: 'array', items: o({ id: 'string', question: 'string', answer: 'string', created_at: 'integer' }) } }),
    post: write({ id: 'metaCreateFaq', summary: 'Add an FAQ', body: o({ 'question*': 'string', 'answer*': 'string' }), ok: 'any' }),
  },
  [`${P}/agent_config/faq/{faqId}`]: {
    put: write({ id: 'metaUpdateFaq', summary: 'Change an FAQ', body: o({ 'question*': 'string', 'answer*': 'string' }), ok: 'any' }),
    delete: write({ id: 'metaDeleteFaq', summary: 'Delete an FAQ', ok: 'any' }),
  },
  [`${P}/agent_config/files`]: {
    get: read({ id: 'metaListFiles', summary: 'Knowledge documents', ok: 'any' }),
    post: write({
      id: 'metaUploadFile',
      summary: 'Upload a knowledge document',
      description: 'multipart/form-data, passed through by the relay. Up to 100 MB: .pdf .doc .docx .png .jpg .jpeg .csv .xlsx. 409 when a file with that name exists; 503 when Meta’s upload service is down.',
      bodyType: 'multipart/form-data',
      body: o({ 'file_name*': 'string', 'file*': { type: 'string', format: 'binary' } }),
      ok: o({ id: 'string', file_name: 'string' }),
    }),
  },
  [`${P}/agent_config/files/{fileId}`]: { delete: write({ id: 'metaDeleteFile', summary: 'Delete a knowledge document', ok: 'any' }) },
  [`${P}/agent_config/websites`]: {
    get: read({ id: 'metaListWebsites', summary: 'Websites the agent reads', ok: 'any' }),
    post: write({
      id: 'metaAddWebsite',
      summary: 'Add a website',
      description: 'Meta reads it in the background (usually 5–30 minutes). It reports `completed` with pages_crawled 0 even when it did learn from the site, so don’t show 0 pages as fact.',
      body: o({ 'url*': 'string' }),
      ok: 'any',
    }),
  },
  [`${P}/agent_config/websites/{websiteId}`]: {
    get: read({ id: 'metaGetWebsite', summary: 'Website read status', description: 'The console polls this with backoff and stops after three failures in a row.', ok: 'any' }),
    put: write({ id: 'metaRecrawlWebsite', summary: 'Change or re-read a website', description: 'A PUT with the same URL queues a fresh read and stamps last_crawled_at at queue time.', body: o({ 'url*': 'string' }), ok: 'any' }),
    delete: write({ id: 'metaDeleteWebsite', summary: 'Remove a website', ok: 'any' }),
  },
  [`${P}/agent_config/allowlist`]: {
    get: read({ id: 'metaListAllowlist', summary: 'Test numbers', description: 'Who the agent answers while the audience is ALLOWLISTED_ONLY (20 at most).', ok: { type: 'array', items: o({ id: 'string', consumer_phone_number: 'string' }) } }),
    post: write({ id: 'metaAddAllowlist', summary: 'Add a test number', body: o({ 'consumer_phone_number*': 'string' }), ok: 'any' }),
  },
  [`${P}/agent_config/allowlist/{entryId}`]: { delete: write({ id: 'metaRemoveAllowlist', summary: 'Remove a test number', ok: 'any' }) },

  // ---- Connections (connectors and tools) ----
  [`${P}/agent_connectors`]: {
    get: read({ id: 'metaListConnectors', summary: 'Connections', ok: 'any' }),
    post: write({
      id: 'metaCreateConnector',
      summary: 'Add a connection',
      description:
        'Names allow only letters, numbers and underscores (Meta answers a bare 400 otherwise, although its docs show spaces). 409 when the name exists. Keys are never kept in the browser.',
      body: o({
        'name*': 'string',
        description: 'string',
        'base_url*': 'string',
        'connector_protocol*': 'HTTP|MCP',
        'auth_type*': 'NONE|API_KEY|OAUTH2_CLIENT_CREDENTIALS',
        auth_config: d('object', '`{api_key: …}` or `{oauth2_client_credentials: …}`.'),
      }),
      ok: 'any',
    }),
  },
  [`${P}/agent_connectors/{connectorId}`]: {
    put: write({ id: 'metaUpdateConnector', summary: 'Change a connection', description: 'Without `auth_config` the saved keys are kept.', body: o({ name: 'string', description: 'string', base_url: 'string', auth_type: 'string', auth_config: 'object' }), ok: 'any' }),
    delete: write({ id: 'metaDeleteConnector', summary: 'Delete a connection', ok: 'any' }),
  },
  [`${P}/agent_connectors/{connectorId}/upsertApiKey`]: {
    post: write({ id: 'metaUpsertApiKey', summary: 'Replace the API keys', description: 'Replaces all keys.', body: o({ 'api_key_config*': 'object' }), ok: 'any' }),
  },
  [`${P}/agent_connectors/{connectorId}/upsertOAuth`]: {
    post: write({ id: 'metaUpsertOAuth', summary: 'Replace the OAuth client credentials', body: o({ 'oauth_config*': 'object' }), ok: 'any' }),
  },
  [`${P}/agent_connectors/{connectorId}/refreshMCPTools`]: {
    post: write({ id: 'metaRefreshMcpTools', summary: 'Re-read an MCP server’s tools', body: o({}), ok: 'any' }),
  },
  [`${P}/agent_connectors/{connectorId}/logs`]: {
    get: read({
      id: 'metaConnectorLogs',
      summary: 'Connection call logs',
      description: 'Meta keeps 7 days. With include_stats: success rate and latency.',
      query: { start_time: d('integer', 'Unix seconds.'), include_stats: 'boolean', limit: 'integer', summary_only: 'boolean', top_n: 'integer' },
      ok: 'any',
    }),
  },
  [`${P}/agent_connectors/{connectorId}/tools`]: {
    get: read({ id: 'metaListTools', summary: 'A connection’s tools', ok: 'any' }),
    post: write({
      id: 'metaCreateTool',
      summary: 'Add a tool',
      description:
        'Built by src/app/wizard/toolRequest.ts. Tool names: letters, numbers and underscores. Value names may be anything but must be unique across path, query, headers and body together. Body params take no per-param `required` flag; use `body.required`.',
      body: d('object', 'Name, description, method, path and the values the agent fills in.'),
      ok: 'any',
    }),
  },
  [`${P}/agent_connectors/{connectorId}/tools/{toolId}`]: {
    put: write({ id: 'metaUpdateTool', summary: 'Change a tool', body: { type: 'object' }, ok: 'any' }),
    delete: write({ id: 'metaDeleteTool', summary: 'Delete a tool', ok: 'any' }),
  },
  [`${P}/agent_connectors/{connectorId}/tools/{toolId}/run`]: {
    post: write({
      id: 'metaRunTool',
      summary: 'Run a tool now',
      description:
        'Uses the connection’s stored keys. Meta can answer `status: "success"` with the failure inside `output` (`{status: {code}, body}`; code 1 = finished): read it with src/app/wizard/toolRun.ts.',
      body: o({ 'input*': d('string', 'The inputs as a JSON-encoded string.') }),
      ok: o({ output: d('string', 'JSON-encoded result.'), status: 'success|error' }),
    }),
  },

  // ---- Evaluation, events, insights, thread control ----
  [`${P}/agent-eval/cases`]: { get: read({ id: 'metaEvalCases', summary: 'Standard check scenarios', ok: 'any' }) },
  [`${P}/agent-eval/run`]: {
    post: write({ id: 'metaEvalRun', summary: 'Run a check', query: { 'eval_case_ids*': 'string' }, body: o({}), ok: o({ job_id: 'string' }) }),
    get: read({
      id: 'metaEvalJob',
      summary: 'A check’s progress',
      description: 'Poll every few seconds until COMPLETED or FAILED. Several result fields are JSON-encoded strings.',
      query: { 'job_id*': 'string' },
      ok: 'any',
    }),
  },
  [`${P}/agent-eval/details`]: { get: read({ id: 'metaEvalDetails', summary: 'A check’s scores, reasons and transcript', query: { 'eval_ids*': d('string', 'Comma-separated.') }, ok: 'any' }) },
  [`${P}/agent_event`]: {
    post: write({ id: 'metaSendAgentEvent', summary: 'Tell the agent something happened', body: o({ 'to*': 'string', 'event*': o({ type: 'string', description: 'string', payload: 'string' }) }), ok: 'any' }),
  },
  [`${P}/agent_event/{eventId}`]: { get: read({ id: 'metaGetAgentEvent', summary: 'An event’s delivery status', ok: 'any' }) },
  [`${P}/insights/conversations`]: { get: read({ id: 'metaInsightConversations', summary: 'Conversation counts', query: { start_date: 'string', end_date: 'string' }, ok: 'any' }) },
  [`${P}/insights/conversations/turns`]: {
    get: read({
      id: 'metaInsightTurns',
      summary: 'Conversation turns (traces)',
      description: 'Each turn’s steps (model and tool calls) and latency. Cursor-paginated. `user_phone_number=<conversation_id>` finds a test chat’s turns.',
      query: { user_phone_number: 'string', after: 'string', limit: 'integer' },
      ok: 'any',
    }),
  },
  [`${P}/insights/tool_calls`]: { get: read({ id: 'metaInsightToolCalls', summary: 'Tool call success and latency', query: { start_date: 'string', end_date: 'string' }, ok: 'any' }) },
  [`${P}/insights/agent_events`]: { get: read({ id: 'metaInsightAgentEvents', summary: 'Agent events over time', query: { start_date: 'string', end_date: 'string' }, ok: 'any' }) },
  '/api/meta/business/whatsapp/phone_numbers/PHONE_NUMBER_ID/thread_control': {
    post: write({
      id: 'metaThreadControl',
      summary: 'Take a chat from the agent, or hand it back',
      description: 'Its own path, and `X-API-Version: 1.0.0` (the relay sets it).',
      body: o({ 'messaging_product*': 'whatsapp', 'action*': 'take|release', 'to*': d('string', 'Customer number, digits only.') }),
      ok: 'any',
    }),
  },
})
