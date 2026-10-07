// server/store.ts: what the console keeps about each AI agent (its list entry, unsaved setup draft,
// test chats, traces, change log, eval runs), and the agent analytics built from Meta's insights.
import { area, d, o } from './helpers.ts'

const PHONE = d('string', 'The agent’s WhatsApp phone number id, or the literal PHONE_NUMBER_ID for the workspace’s default number.', { pattern: String.raw`^(PHONE_NUMBER_ID|\d{1,20})$` })
const PHONE_Q = { 'phone*': PHONE }
const PHONE_ERRORS = { 400: 'phone must be digits.', 403: 'That number isn’t connected to this workspace (or no WhatsApp account is connected).' }

export const store = area('AI agents (console store)', {
  '/api/store/agents': {
    get: { id: 'listStoredAgents', summary: 'Agents this workspace has set up', ok: 'StoredAgent[]' },
    put: {
      id: 'replaceStoredAgents',
      summary: 'Save the agents list',
      body: { type: 'array', items: { $ref: '#/components/schemas/StoredAgent' } },
      ok: 'StoredAgent[]',
      errors: { 400: 'Expected a list of agents.' },
    },
  },
  '/api/store/agents/{phone}': {
    get: { id: 'getStoredAgent', summary: 'One agent’s list entry', params: { phone: PHONE }, ok: 'StoredAgent', errors: { ...PHONE_ERRORS, 404: 'No stored agent for 1234567890.' } },
    put: {
      id: 'saveStoredAgent',
      summary: 'Update one agent’s list entry',
      params: { phone: PHONE },
      body: o({ displayName: d('string', 'Up to 200 characters.'), everLive: 'boolean', wabaId: 'string', createdAt: d('string', 'ISO time or milliseconds.'), lastOpenedAt: 'string' }),
      ok: 'StoredAgent',
      errors: PHONE_ERRORS,
    },
  },
  '/api/store/drafts/{phone}': {
    get: {
      id: 'getDraft',
      summary: 'The agent’s saved setup draft',
      description: 'The studio’s working copy (what Meta doesn’t store, e.g. rich reply form fields). Meta stays the source of truth on open.',
      params: { phone: PHONE },
      ok: o({ 'state*': 'object?', 'updatedAt*': 'date-time?' }),
      errors: PHONE_ERRORS,
    },
    put: {
      id: 'saveDraft',
      summary: 'Save the setup draft',
      description: 'Secrets (connector keys) are blanked before saving.',
      params: { phone: PHONE },
      body: o({ 'state*': 'object' }),
      ok: o({ 'ok*': 'boolean', 'updatedAt*': 'date-time' }),
      errors: { ...PHONE_ERRORS, 400: 'Expected {state: {...}}.' },
    },
  },
  '/api/store/test-conversations': {
    get: {
      id: 'listTestChats',
      summary: 'Test chats (Test & Eval, Try it)',
      description: '100 at most, newest first.',
      query: PHONE_Q,
      ok: { type: 'array', items: o({ id: 'string', startedAt: 'integer', messages: { type: 'array', items: o({ from: 'customer|agent|system', text: 'string', at: 'integer', quickReplies: 'string[]' }) } }) },
      errors: PHONE_ERRORS,
    },
  },
  '/api/store/traces': {
    get: {
      id: 'listTraces',
      summary: 'Conversation traces',
      description: 'Each turn’s steps (model calls, tool calls) and latency, collected from Meta’s conversation turns. 200 at most.',
      query: { ...PHONE_Q, consumer: d('string', 'Only this customer.'), from: d('string', 'ISO time or milliseconds.'), to: 'string' },
      ok: 'StoredTrace[]',
      errors: { ...PHONE_ERRORS, 400: 'Invalid date.' },
    },
  },
  '/api/store/audit': {
    get: {
      id: 'listAudit',
      summary: 'Change log',
      description: 'Every change made to the agent on Meta through the console, newest first.',
      query: { ...PHONE_Q, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
      ok: 'AuditRow[]',
      errors: PHONE_ERRORS,
    },
  },
  '/api/store/eval-runs': {
    get: {
      id: 'listEvalRuns',
      summary: 'Standard check results',
      query: PHONE_Q,
      ok: {
        type: 'array',
        items: o({ caseId: 'string', jobId: 'string', status: 'COMPLETED|FAILED', startedAt: 'string', completedAt: 'string', result: 'object?', error: 'object?', evaluations: 'object[]' }),
      },
      errors: PHONE_ERRORS,
    },
  },
  '/api/store/agent-events': {
    get: { id: 'listAgentEvents', summary: 'Agent events', description: 'Meta’s agent events (handoffs, errors…), 200 at most.', query: PHONE_Q, ok: 'object[]', errors: PHONE_ERRORS },
  },
  '/api/analytics/trend': {
    get: {
      id: 'agentTrend',
      summary: 'Conversations the AI handled, per day',
      description: 'Closed days come from the database; today is asked of Meta live. `partial`: today, still counting.',
      query: { ...PHONE_Q, days: { type: 'integer', enum: [7, 14, 30] } },
      ok: { type: 'array', items: o({ 'date*': 'string', 'aiThreads*': 'integer?', 'partial*': 'boolean' }) },
      errors: { ...PHONE_ERRORS, 400: 'days must be 7, 14 or 30.', 502: 'Meta didn’t answer for any day.' },
    },
  },
  '/api/analytics/handoffs': {
    get: {
      id: 'agentHandoffs',
      summary: 'Handoffs to people over time',
      query: { ...PHONE_Q, days: { type: 'integer', minimum: 1, maximum: 90 } },
      ok: { type: 'array', items: o({ 'ts*': 'integer', 'count*': 'integer' }) },
      errors: PHONE_ERRORS,
    },
  },
})
