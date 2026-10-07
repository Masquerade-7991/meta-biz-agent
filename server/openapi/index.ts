// The OpenAPI 3.1 description of the console's API, served at /api/openapi.json and shown at
// /api/docs (Swagger UI). Hand-written per area next to this file; server/openapi.test.ts fails when a
// server route is missing from it, and `npm run docs:openapi` refreshes the committed docs/openapi.json.
import { ref } from './helpers.ts'
import { schemas } from './schemas.ts'
import { infra } from './infra.ts'
import { auth } from './auth.ts'
import { inbox } from './inbox.ts'
import { tickets } from './tickets.ts'
import { contacts } from './contacts.ts'
import { broadcasts } from './broadcasts.ts'
import { store } from './store.ts'
import { assist, billing } from './workspace.ts'
import { whatsapp } from './whatsapp.ts'
import { meta } from './meta.ts'

const error = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } })

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Helo.ai Console API',
    version: '1.0.0',
    description: [
      'The API behind the Helo.ai console: accounts and workspace, the support desk (inbox, tickets, contacts, broadcasts), WhatsApp numbers, and the relay to Meta’s Business Agent API.',
      '**Signing in.** Every route except the public ones needs the session cookie `sid` from `POST /api/auth/login` (or an emailed link). In this page, “Try it out” uses your current session. Routes also need finished setup and a workspace.',
      '**Roles.** Owner › Admin › Supervisor › Agent. Each route says the lowest role that may call it (from src/app/lib/permissions.ts).',
      '**Errors.** `{title, detail, status}`. Every response has an `x-trace-id` header; owners and admins can look up what a request did with `GET /api/trace/{id}`.',
      '**Same origin only.** No CORS; the console and the API share a host (Vite proxies `/api` in development, Vercel rewrites it in production).',
    ].join('\n\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  security: [{ session: [] }],
  tags: [
    { name: 'Server', description: 'Health, Meta’s webhook, scheduled jobs, live updates, traces and these docs.' },
    { name: 'Accounts & workspace', description: 'Sign-up, login, your account, and the workspace’s people.' },
    { name: 'Inbox', description: 'Customer chats: reading, replying, assigning, taking over from the AI agent, canned responses.' },
    { name: 'Tickets & support', description: 'Tickets, response targets, business hours, routing and team analytics.' },
    { name: 'Contacts', description: 'Contacts, custom fields, tags, segments and CSV import.' },
    { name: 'Broadcasts & templates', description: 'WhatsApp message templates and template broadcasts.' },
    { name: 'WhatsApp', description: 'Connected accounts (Embedded Signup), numbers, profiles and health.' },
    { name: 'Billing', description: 'WhatsApp spend and the budget alert.' },
    { name: 'AI help', description: 'Writing help for the agent’s setup, and questions it couldn’t answer.' },
    { name: 'AI agents (console store)', description: 'What the console keeps about each agent that Meta doesn’t, and agent analytics.' },
    {
      name: 'Meta Business Agent (via relay)',
      description:
        'The relay, and the Meta endpoints the console calls through it, with what we learned using them. Meta’s reference is the source of truth for these.',
      externalDocs: { description: 'Meta Business Agent reference', url: 'https://developers.facebook.com/documentation/meta-business-agent' },
    },
  ],
  paths: { ...infra, ...auth, ...inbox, ...tickets, ...contacts, ...broadcasts, ...whatsapp, ...billing, ...assist, ...store, ...meta },
  components: {
    securitySchemes: {
      session: { type: 'apiKey', in: 'cookie', name: 'sid', description: 'Set by POST /api/auth/login. HttpOnly, so the browser sends it for you.' },
    },
    responses: {
      NotLoggedIn: error('Not logged in: no session, or it expired.'),
      Forbidden: error('Not allowed: setup not finished, no workspace, or your role can’t do this (the detail says which).'),
      DatabaseUnavailable: error('The database isn’t available (title: “Database not configured” or “Database unavailable”).'),
    },
    schemas,
  },
}

/** GET /api/docs: Swagger UI from jsDelivr, reading the spec above with the visitor's own session. */
export const docsPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helo.ai API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<style>
  body { margin: 0; background: #fafafa; font-family: Inter, system-ui, sans-serif; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e5e5e5; }
  .bar b { font-size: 15px; }
  .bar a { color: #1d5fb4; font-size: 14px; text-decoration: none; }
  .bar a:hover { text-decoration: underline; }
  .swagger-ui .topbar { display: none; }
</style>
</head>
<body>
<div class="bar"><b>Helo.ai API</b><span><a href="/api/openapi.json" download="helo-openapi.json">Download spec</a> &nbsp;·&nbsp; <a href="/">Back to the console</a></span></div>
<div id="ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
<script>
  window.ui = SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#ui',
    deepLinking: true,
    docExpansion: 'none',
    filter: true,
    displayRequestDuration: true,
    withCredentials: true,
  })
</script>
</body>
</html>`
