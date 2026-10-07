// Plumbing: health, Meta's webhook, Vercel cron, live events, traces, these docs, and the Shopify bridge.
import { area, d, o } from './helpers.ts'

export const infra = area('Server', {
  '/api/health': {
    get: {
      id: 'health',
      summary: 'Is the server up',
      description:
        'Used by the browser before login and by Render’s health check. For a signed-in member whose workspace has a WhatsApp account it also names that account (labels only, never ids of other workspaces or tokens).',
      who: 'public',
      ok: o({
        'ok*': 'boolean',
        'database*': d('string', '`ok`, or why MongoDB isn’t available.'),
        'upstream*': d('string', 'Where Graph API calls go.'),
        'hasToken*': 'boolean',
        businessName: 'string',
        wabaId: 'string',
        wabaName: 'string',
        phoneNumberId: 'string',
        phoneNumber: 'string',
        phoneName: 'string',
      }),
    },
  },
  '/api/webhooks/whatsapp': {
    get: {
      id: 'verifyWebhook',
      summary: 'Meta’s webhook verification',
      description: 'Meta calls this once when the callback URL is saved. Answers the challenge as plain text when `hub.verify_token` equals WEBHOOK_VERIFY_TOKEN.',
      who: 'public',
      query: { 'hub.mode*': 'subscribe', 'hub.verify_token*': 'string', 'hub.challenge*': 'string' },
      ok: 'string',
      okType: 'text/plain',
      errors: { 403: 'Verification failed.' },
    },
    post: {
      id: 'receiveWebhook',
      summary: 'Meta’s webhook events',
      description:
        'Messages, statuses, echoes, standby, handovers and account events (quality, name, limits). Answers 200 at once and processes afterwards. When APP_SECRET is set the body must carry a valid `X-Hub-Signature-256`, else 401 with no body. Without a database the event is acknowledged and dropped.',
      who: { text: 'Meta (signed with the app secret).', public: true },
      headers: { 'X-Hub-Signature-256': d('string', '`sha256=<HMAC of the raw body with APP_SECRET>`.') },
      body: d('object', 'Meta’s webhook payload ({object, entry[{changes[{field, value}]}]}).'),
      ok: null,
      okDescription: 'Received.',
    },
  },
  '/api/cron': {
    get: {
      id: 'cron',
      summary: 'Daily jobs (Vercel only)',
      description:
        'Called by Vercel Cron (03:00 UTC, see vercel.json): resumes broadcasts, schedules billing and health checks, runs due jobs, and collects Meta’s metrics, handoffs, connector logs and traces. Any method works. Not on the local server.',
      who: { text: 'Vercel Cron: `Authorization: Bearer <CRON_SECRET>`.', public: true },
      ok: o({ 'ok*': 'boolean', 'jobs*': d('integer', 'Jobs run.') }),
      errors: { 401: 'Cron only.', 503: 'MongoDB didn’t answer.' },
    },
  },
  '/api/stream': {
    get: {
      id: 'liveEvents',
      summary: 'Live updates (Server-Sent Events)',
      description:
        'Pushes every change in your workspace as it happens: `data: {kind, entity, entityId, data, at, traceId}`. Starts with `retry: 5000`; a `: ping` comment every 25 seconds keeps proxies from closing it. On Vercel it answers 204 (no long-lived connections) and screens poll instead.',
      ok: d('string', 'An event stream.'),
      okType: 'text/event-stream',
    },
  },
  '/api/trace/{id}': {
    get: {
      id: 'readTrace',
      summary: 'Everything one request touched',
      description:
        'Every response carries an `x-trace-id` header; errors show its first 8 characters as “Reference: …”. This returns that request’s events, Meta calls and configuration changes, oldest first (500 of each at most).',
      who: 'traces.read',
      params: { id: d('string', 'The full trace id, or its first 8+ characters.', { pattern: '^[0-9a-f-]{8,36}$' }) },
      ok: o({ 'traceId*': 'string', 'events*': 'object[]', 'calls*': 'object[]', 'audit*': 'object[]' }),
      errors: { 403: 'Only owners and admins can read traces.' },
    },
  },
  '/api/openapi.json': {
    get: { id: 'openapi', summary: 'This document', description: 'The OpenAPI 3.1 description of this API (also committed as docs/openapi.json).', ok: 'object' },
  },
  '/api/docs': {
    get: {
      id: 'docs',
      summary: 'This page',
      description: 'Interactive documentation for this API. Without a session it sends you to the console to log in.',
      ok: 'string',
      okType: 'text/html',
    },
  },
  '/api/shopify-mcp': {
    post: {
      id: 'shopifyMcp',
      summary: 'Shopify store bridge (MCP)',
      description:
        'A separate Vercel function (api/shopify-mcp.ts). Passes a JSON-RPC (MCP) request to the store’s `https://{store}/api/ucp/mcp`, so a Meta agent connector can reach a Shopify store.',
      who: 'public',
      query: { 'store*': d('string', 'The store’s myshopify.com domain.', { pattern: String.raw`^[a-z0-9-]+\.myshopify\.com$` }) },
      body: o({ jsonrpc: 'string', id: 'any', method: 'string', params: 'object' }),
      ok: o({ jsonrpc: 'string', id: 'any', result: 'any', error: o({ code: 'integer', message: 'string' }) }),
      errors: { 400: 'JSON-RPC error -32602: missing or invalid store.', 502: 'The store didn’t answer.' },
    },
  },
})
