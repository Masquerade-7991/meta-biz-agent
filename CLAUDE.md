# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context

- **What this is:** a Helo.ai console that configures Meta's WhatsApp Meta Business Agent through its Platform API. Meta owns the agent; this app is only the configuration UI.
- **Spec:** the PRD is `Meta_Business_Agent_GUI_PRD.pdf` (v0.10), kept outside the repo. Code comments cite its IDs (e.g. "PRD AC-b33"). Where the PRD gives exact user-facing strings, use them.

## Running against Meta

- **Two processes:** `npm run dev` (Vite) and `npm run dev:server` (the API server on :8787). Vite proxies `/api` to the server.
- **Upstream is Helo.ai's server, not Meta:** calls go to `BASE_URL_2`, which holds the Meta credentials.
  - It's VPN-only and started manually each day, so it is often unreachable. That's expected, not a bug.
  - The user has no Meta token, app ID or app secret. Don't ask for them.
  - To test wiring while it's down, use a throwaway local stand-in server as the upstream: `BASE_URL_2=http://localhost:<port> node server/index.ts`.
- **Accounts gate the API (`server/auth.ts`):**
  - Every `/api/*` route except `/api/health` and the account routes needs a signed-in workspace member, and runs inside that member's workspace (`ws()` in `server/db.ts`).
  - A person can belong to several workspaces (memberships unique per workspace + person). Each session works in one (`sessions.workspaceId`), switched with `POST /api/account/workspace`. Someone who already has an account answers an invite in the app, signed in as the invited email (`/api/account/invites/{id}/accept|decline`); the emailed link alone never joins them.
  - Accounts need MongoDB.
  - Emails go through Gmail SMTP (`SMTP_USER` / `SMTP_PASS` App password). Without `SMTP_PASS`, emails, including magic links, print to the relay log.
  - Dummy mode skips login entirely.
- **IDs stay on the server:** client paths use the literal placeholders `PHONE_NUMBER_ID` / `WABA_ID`, and the server fills them in from the workspace's WhatsApp account. Never put real IDs in client code.
- **WhatsApp accounts are per workspace (`server/accounts.ts`, `whatsapp_accounts`):**
  - Each request runs with its workspace's accounts (`server/context.ts`); calls use that account's token. The `.env` number is the first workspace's account (`source: 'env'`, server token).
  - `/api/meta` and `/api/graph` reject real IDs that aren't the workspace's own.
  - New numbers come in through **Embedded Signup v4** (`server/whatsapp.ts`, `src/app/whatsapp/*`), always through `ConnectNumberButton` (Home, the WhatsApp page, Settings › WhatsApp). `GET /api/whatsapp/config` says which mode:
    - **`sdk`**, the full signup: needs `META_ES_CONFIG_ID`, the app id/secret (`META_APP_ID`/`META_APP_SECRET`, else `APP_ID`/`APP_SECRET`) and `TOKEN_ENCRYPTION_KEY`; optionally `WA_CREDIT_LINE_ID` / `WA_CREDIT_CURRENCY` for billing through Helo.ai. `ConnectNumberDialog`: Meta's window via the JS SDK, then `POST /connect` finishes it.
    - **`hosted`**: only `EMBEDDED_SIGNUP_LINK` (Meta's hosted signup page; `src/app/whatsapp/signupLink.ts` makes a new-number and a WhatsApp Business app variant). Connect sends the current tab straight to that link (no dialog); Meta's Cross-Origin-Opener-Policy would cut a pop-up off from the console anyway (no events, no code), and Helo.ai completes the connection on its side.
    - **`none`**: "Talk to Helo.ai". Setting names are never shown to customers; the server logs what's missing once.
    - Dummy mode simulates Meta's window (`SignupWindow`) and connects a demo account. The asset map (`AssetMap`, `assetMap()`) shows how Meta's business, account and number land in Helo.ai.
  - Customer tokens and PINs are stored only sealed (`server/crypto.ts`, AES-256-GCM).
- **Docs site:** `docs-site/` is a separate Fumadocs (Next.js) app: the user guide, developer pages, and an API reference built from `docs/openapi.json`. Own `npm install`/`build`, own Vercel project; root lint ignores it. When a feature changes what customers see, update its page in `docs-site/content/docs`.
- **API docs:** every `/api` route is described in `server/openapi/*` (OpenAPI 3.1), served at `/api/docs` (Swagger UI, members only) and `/api/openapi.json`, and committed as `docs/openapi.json`. A new or changed route goes in the spec: `server/openapi.test.ts` fails otherwise; then run `npm run docs:openapi`.
- **Several instances at once:** nothing that must be shared lives in process memory. The relay cache and the hourly rate guard are in MongoDB (`relay_cache`, `rate_hits`, `server/cache.ts`), throttles and in-flight locks use `tryLock()` (`server/locks.ts`, the `locks` collection), live events reach every instance through a change stream on `events` (`subscribe()` in `server/trace.ts`; needs a replica set, Atlas is one), and a job records the instance that claimed it so SIGTERM puts it straight back in the queue (`releaseLeases`). `/api/ready` answers 503 until the database is connected (the host's readiness check); `/api/health` stays 200. `tests/e2e/multi-instance.e2e.ts` proves it with two servers on one database; `npm run test:load` prints a p95 baseline to compare plumbing changes against.
- **Domains (`server/<domain>/`):** `platform` (db, context, http, jobs, trace, locks, cache, mail, alerts, crypto, protect, roles, stream, env), `identity` (auth), `whatsapp` (accounts, numbers, signup, health, billing, the Meta relay: upstream, record, mirror, store), `messaging` (inbox, media, follow-ups, customers, webhook routing, AI assist), `support` (tickets, teams, routing, escalation, business hours, contacts), `outreach` (broadcasts, templates), `insights` (analytics, reports, collectors, AI usage, activity). The composition root stays at `server/` (`index.ts`, `app.ts`, `vercel.ts`, `openapi/`). A domain imports another only through its `index.ts` (its public surface; add a name there when another domain needs it); `npm run lint:deps` (`scripts/check-deps.mjs`) refuses deeper imports and any new cycle between domains, and `server/ownership.test.ts` refuses a collection being named outside its owning domain (both carry the debt that exists today as lists that may only shrink).
- **Runtime roles (`server/platform/roles.ts`):** one bundle, `ROLE=api|ingress|worker|stream`; unset means all of them in one process (local dev, the e2e harness, Vercel). The ingress only stores and acknowledges Meta's deliveries and queues `webhook.process` for a worker (`WEBHOOK_PROCESS=job` does the same in any role); a role answers 404 for paths that aren't its own (`serves()`); health and readiness are everywhere, and the worker's health reports the queue. `render.yaml` runs the four as separate services from one `Dockerfile`; to split them, add the two rewrites in `vercel.json` (`/api/webhooks/*` → ingress, `/api/stream` → stream) once those services exist. `tests/e2e/roles.e2e.ts` covers the split.
- **Resilience (`server/platform/breaker.ts`, `app.ts`):** every Meta call passes a circuit breaker per kind (5 failures in a row open it for 20 s, shared across instances through `locks`, half-open after) and a bulkhead (8 in flight per process, 64 waiting, then 503); `/api/health` shows `breaker`. A POST/PUT/PATCH/DELETE with an `Idempotency-Key` header is answered from `request_locks` when repeated within 10 minutes. Jobs that gave up are listed at `GET /api/jobs` and retried with `POST /api/jobs/{id}/retry` (owners and admins; Settings › Activity › Operations shows them with a Retry). The webhook retry sweep widens its batch when more than 1,000 deliveries wait, and the worker's health reports `webhooks.pending`.
- **Checks before pushing to `main` (it deploys):** `npm run build` (type-checks `src/` and `server/`), `npm run lint` (0 warnings), `npm run lint:tw`, `npm run lint:deps`, `npm test` (every `*.test.ts`), and `npm run test:e2e` (journeys against a throwaway database and a fake Meta, about 3 min; needs MongoDB). `npm run test:evals` replays the AI-feature cases, `npm run test:ui` checks every page in a browser. A test for a known, unfixed bug is marked `todo` with its QA id (`tests/QA_REPORT.md`); remove the flag when it's fixed. Lint is clean; keep it that way. Context hooks are allowed by name in `.oxlintrc.json`; other shared helpers go in a `.ts` file, not next to a component.

## UI conventions

- **Tokens** live in `src/styles/theme.css` (light on `:root`, dark on `.dark`, switched by `src/app/lib/theme.ts`). Neutral greys, the Helo blue (`primary`) for actions, Helo red (`brand`) only for the logo and progress bars; the active-nav bar is `primary` blue. Text colours meet WCAG AA; keep it that way (status text uses the `-foreground` shades on `/10`–`/15` tints).
- **Type** is classes, not inline styles: `text-title` (page), `text-section`, `text-sm` (body), `text-xs`/`text-meta` (metadata), `text-micro` (counts and chips in dense rows), `text-display` (Home greeting only). Base h1–h4 are 24/20/16/14px. Only the WhatsApp look-alikes (bubbles, previews: `whatsappTheme.ts`) keep fixed inline sizes.
- **Colours** are tokens only: `warning`/`success`/`destructive` (and their `-foreground`) for status, never raw palette classes like `amber-500`. Cards are `rounded-lg`.
- **Page pieces** in `src/app/components/ui/page.tsx` (PageContainer, PageHeader, EmptyState, SaveBar): every page uses them. `sheet.tsx` for side panels and editors, `status.tsx` StatusPill with the words in `src/app/lib/status.ts` (agent: Draft · Testing · Live · Paused), `kpi.tsx` KpiTile (value, change against the period before, sparkline). Settings sections are `SettingsSection` (`stacked` for grids and wide tables).
- **Charts:** `src/app/components/charts/*`. TimeSeriesChart and Donut use Recharts (only load them from lazily loaded pages); Sparkline, BarList, Funnel and Heatmap are plain SVG/divs. Colours come from `--chart-1..5`; rates use `domain={[0, 1]}`.
- **Top bar:** search, the theme toggle (`ThemeToggle`: light/dark; ⌘K keeps Match system), help and the bell, all `HEADER_ICON_BUTTON`. The sidebar top is the workspace switcher; the account menu has no theme.
- **Addresses:** every page has a URL (`src/app/nav.ts` `pathFor`); the studio is `/agents/studio/<section>` (`src/app/wizard/studioPaths.ts`) and follows the wizard's `currentSection` both ways (`StudioUrlSync` in `App.tsx`). Real IDs never go in URLs.
- **Demo controls** render only in dummy mode or dev (`App.tsx`); Demo controls → Loader previews the page loader.
- **Loading a page or panel:** `PageLoader` (`ui/wavy-loader.tsx`) with an area's lines from `lib/loadingLines.ts`; small spinners only inside buttons.
- **Forms with Save:** use `SaveButton` (it also shows the floating unsaved-changes bar); pass `onDiscard` (`useSaveOnNextSection().discard`).
- **Lists:** compact density is `html[data-density=compact]` (`lib/density.ts`); new list rows that should tighten get `data-density-row`.
- **Rich replies** (`steps/RichRepliesSection.tsx`, `steps/richReplies/*`): one side panel with three steps (when, what kind, the message) and a live phone preview; starters in `mockData.ts` `RICH_REPLY_STARTERS`.
- **AI help** (`server/assist.ts`, `src/app/api/assist.ts`): writing help needs `ANTHROPIC_API_KEY`; unanswered questions come from Inbox messages and test chats answered with Meta's fallback or handed off.
- **⌘K palette** (`shell/CommandPalette.tsx`) lists pages, settings, the open agent's sections and quick actions; add new pages there. The studio's **Try it** panel (`steps/TryItPanel.tsx`) is the quick test chat from any section.
- Effects return nothing or a cleanup function: wrap calls like `scrollIntoView` in a block body (newer browsers return a Promise from it, which crashes React).

## Webhooks and the business's own account

- **Listening, not owning:** events arrive through a separate *listening* Meta app subscribed to the business's WABA alongside the business's own app. Meta sends each subscribed app its own copy, so the business's webhook is untouched. Never set `override_callback_uri` / `webhook_configuration`, never call `subscribed_apps` POST/DELETE for it.
- **Protected account (`server/protect.ts`):** the `.env` account (and `PROTECTED_IDS`) can't have its subscriptions, callback, registration, PIN, codes, coexistence sync or credit line changed. `callUpstream` refuses those calls for everything (relay and modules); `server/protect.test.ts` covers it. Connect/Retry/Disconnect/billing refuse it too, and the UI hides those controls.
- **Listen-only:** on the protected number the console never messages customers on its own (no away message, no CSAT); people still send by clicking.
- **Receiver (`server/inbox.ts handleWebhook`):** signatures from any app in `WEBHOOK_APP_SECRETS` (none set → 503 so Meta retries); every delivery is stored as sent in `webhook_inbox` (id = sha256 of the body, retries store once), processed, then answered; failures are retried (`reprocessWebhooks`, after each delivery, every 5 min locally, daily cron). Side effects run once per new message; statuses only move forward; pricing goes to `message_charges`.
- **Kept for good:** `messages`, `conversations`, `conversation_traces`, `test_conversations`, `whatsapp_webhooks`, `webhook_inbox` (old TTLs dropped by `RETIRED_TTL` in `server/db.ts`). Transcript: `GET /api/inbox/conversations/{phone}/transcript[?format=txt]`. The hourly `traces` collector also writes turns into `messages` (`importTurns`).
- **Owner only:** Settings › WhatsApp (accounts, webhook status, apps receiving events) is `whatsapp.manage`: `webhook-status` and its `/baseline` action answer 403 to everyone else, and the tab and ⌘K entry are hidden. The first list of subscribed apps seen is kept as a baseline (never from a local test double); owners can "Mark this list as expected" after an intended change.
- **Agent usage:** `agentUsage` collector reads `GET /{phone}/business_agent_insights?granularity=HOUR&start=&end=` (Unix seconds, **no** `X-API-Version` header). Meta answers 404 "Billable account not found" until the agent has a payment method; that's stored as the state, not an error.

## Support platform (Home, Inbox, Tickets, Contacts, Broadcasts, Analytics)

- **Server modules:** `inbox.ts` (chats, replies, thread control, canned responses and macros, webhook, AI assist), `tickets.ts` (tickets, SLA, CSAT, support settings, notifications), `supportOps.ts` (teams, people's skills/limit/availability, routing rules, escalation matrix and its minute sweep), `analytics.ts` (the Analytics page and its logs), `reports.ts` (CSV downloads, scheduled report emails), `contacts.ts` (contacts, fields, segments, CSV import), `broadcasts.ts` (templates, broadcasts, send worker). All workspace-scoped; sending needs `ownsMetaAssets()`.
- **Routing and escalation:** the decisions are pure and shared (`src/app/support/routing.ts`): first matching rule wins, then the default routing in support settings; only available people under their limit get tickets. Escalation levels fire in order, once each (`escalationLevel` on the ticket), and alert by bell (`escalations[].notify`) and optionally email.
- **Agents in analytics:** messages, conversations and tickets carry `phoneNumberId` (the number a webhook arrived on, `currentNumber()` in inbox.ts); rows without one count as the default number. Analytics and report tables are built once (`src/app/analytics/types.ts`, `src/app/reports/catalog.ts`) for server, print view and Dummy mode.
- **Model:** one conversation per customer phone; a ticket is one issue inside it (opens on handoff, take-over, a team reply, or the customer writing again).
- **Ticket lifecycle (`src/app/support/ticketRules.ts`, shared with Dummy mode):** handing the chat back to the AI resolves its ticket (no rating question); a customer writing reopens a ticket resolved in the last 3 days (later: a new one, `source: customer`) unless the AI holds the chat; waiting on the customer pauses the deadlines (`pausedAt`/`pausedMs`, dues shift on resume, no escalation); reopening restarts deadlines from `clockStartAt` and escalation from level 0. The database allows one open ticket per chat (`one_open_ticket_per_chat`). Bulk changes answer `{done, failed[]}`. A member leaving or removed unassigns their work and stops routing to them (`cleanUpMember` in supportOps.ts).
- **Activity log (`events`, kept 2 years):** record actions with `trace(kind, data, {entity, id}, changes)`; `changes` is `{field: [before, after]}` (`diff()` builds it). Auth routes run outside a workspace: use `traceIn`. Sentences and areas are in `src/app/activity/activityText.ts` (add a case for a new kind); `GET /api/activity[.csv]` serves Settings › Activity (owners and admins) and each ticket's history. Plumbing kinds (messages, jobs, webhooks) only show when looking up an error reference.
- **Analytics definitions:** a conversation needs a message from the customer, the AI or the team; AI alone = the AI answered and nobody from the team wrote; no reply = neither. Home's "Last 7 days" uses the same overview. WhatsApp spend is per account and per UTC day (Meta's data), so cost per resolved conversation shows only for all agents.
- **Sample data never reaches Meta:** rows with `sample: true` are stored but not sent. Tests send only to sample contacts.
- **Shared pure logic** lives in `src/` and is imported by the server too: `src/app/inbox/sampleData.ts`, `src/app/broadcasts/templates.ts`. SLA business-hours maths is `server/businessHours.ts`.
- **Tests:** `npm test` runs every unit test; end-to-end journeys are in `tests/e2e/` (one shared harness, `harness.ts`).

## Rules for Meta wiring

- **One place for Meta calls:** everything goes through `src/app/api/meta.ts`.
- **Meta is the source of truth:**
  - An agent loads from Meta on open (`hydrateFromMeta`, merged by `metaId`).
  - Per-row actions call Meta first and update local state only after Meta accepts.
  - New list types need a `metaId`.
- **Keep the Demo controls failure hooks** when replacing fake async code: `const shouldFail = consumeForcedFailure(); if (shouldFail) throw …` goes before the real call.
- **Verify endpoint details against Meta's reference** (developers.facebook.com/documentation/meta-business-agent; `llms.txt` lists every page). Don't guess. Easy to get wrong:
  - Path styles mix `agent_config/...` (underscores) with `agent-ui-skills` and `agent-eval` (hyphens).
  - Thread control has its own path and uses `X-API-Version: 1.0.0`.
  - Several response fields are JSON-encoded strings.
  - Connector and tool names allow only letters, numbers and underscores (Meta answers a bare 400 otherwise, though its docs show names with spaces). Body params take no per-param `required` flag; use `body.required`.
  - Skill and rich reply (UI skill) titles allow only lowercase letters, numbers and hyphens, no hyphen at either end (`skillTitle` in `src/app/wizard/skillTitle.ts`); the console keeps the readable name and refuses two names that slug to the same title.
  - Settings `PUT` is partial. Safety & handoff never sends `rollout` or `ai_audience` (Publish owns them via `setRollout`): re-sending them made Meta refuse the save without billing, or flipped a live agent.
  - Meta's 429 is per app/token and shared with other systems. The relay shares identical in-flight reads and retries a read once; settings reads run two at a time (`getSettings`).
  - Tool value names may be anything but must be unique across path, query, headers and body together.
  - A connector `PUT` without `auth_config` keeps the saved keys; `upsertApiKey` replaces all keys. Keys are never kept in the browser (`stripConnectionSecrets`).
  - A tool run can answer `status: "success"` with the failure inside `output` (`{status:{code}, body}`; code 1 = finished). Read it with `readToolRun` (`src/app/wizard/toolRun.ts`).
  - `agent_test` doesn't report tool calls; its conversation turns do (`user_phone_number=<conversation_id>`), about a second after the reply (`src/app/wizard/testTools.ts`).
  - All tool request building goes through `src/app/wizard/toolRequest.ts` (payload, read-back, preview, test input).
  - Websites: Meta answers `completed` with `pages_crawled: 0` even when the agent learned from the site (checked with a question only the page answers), so never show 0 pages as fact (`src/app/wizard/websites.ts`). A `PUT` with the same URL queues a fresh read and stamps `last_crawled_at` at queue time.

## Deliberately not wired

- **Native integrations:** there is no Meta API for them, so the tab stays a mock.
- **Budget and mTLS:** out of scope per PRD §4.
- **Duplicate agent:** a copy needs a second phone number, and the setup has one.
