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
  - Accounts need MongoDB.
  - Emails go through Gmail SMTP (`SMTP_USER` / `SMTP_PASS` App password). Without `SMTP_PASS`, emails, including magic links, print to the relay log.
  - Dummy mode skips login entirely.
- **IDs stay on the server:** client paths use the literal placeholders `PHONE_NUMBER_ID` / `WABA_ID`, and the server fills them in from the workspace's WhatsApp account. Never put real IDs in client code.
- **WhatsApp accounts are per workspace (`server/accounts.ts`, `whatsapp_accounts`):**
  - Each request runs with its workspace's accounts (`server/context.ts`); calls use that account's token. The `.env` number is the first workspace's account (`source: 'env'`, server token).
  - `/api/meta` and `/api/graph` reject real IDs that aren't the workspace's own.
  - New numbers come in through **Embedded Signup v4** (`server/whatsapp.ts`, `src/app/whatsapp/*`). It needs `META_APP_ID`, `META_ES_CONFIG_ID`, `META_APP_SECRET` and `TOKEN_ENCRYPTION_KEY`, plus optionally `WA_CREDIT_LINE_ID` / `WA_CREDIT_CURRENCY` for billing through Helo.ai. Without them, Home offers "Talk to Helo.ai"; Dummy mode simulates the signup.
  - Customer tokens and PINs are stored only sealed (`server/crypto.ts`, AES-256-GCM).
- **There is no test suite.** Verify with `npm run build` (type-checks `src/` and `server/`) and `npm run lint`. Lint is clean; keep it that way. Context hooks are allowed by name in `.oxlintrc.json`; other shared helpers go in a `.ts` file, not next to a component.

## UI conventions

- **Tokens** live in `src/styles/theme.css` (light on `:root`, dark on `.dark`, switched by `src/app/lib/theme.ts`). Neutral greys, the Helo blue (`primary`) for actions, Helo red (`brand`) only for the logo and progress bars; the active-nav bar is `primary` blue. Text colours meet WCAG AA; keep it that way (status text uses the `-foreground` shades on `/10`–`/15` tints).
- **Type** is classes, not inline styles: `text-title` (page), `text-section`, `text-sm` (body), `text-xs`/`text-meta` (metadata), `text-display` (Home greeting only). Base h1–h4 are 24/20/16/14px.
- **Page pieces** in `src/app/components/ui/page.tsx` (PageContainer, PageHeader, EmptyState, SaveBar), `sheet.tsx` for side panels, `status.tsx` StatusPill with the words in `src/app/lib/status.ts` (agent: Draft · Testing · Live · Paused).
- **Addresses:** every page has a URL (`src/app/nav.ts` `pathFor`); the studio is `/agents/studio/<section>` (`src/app/wizard/studioPaths.ts`) and follows the wizard's `currentSection` both ways (`StudioUrlSync` in `App.tsx`). Real IDs never go in URLs.
- **Demo controls** render only in dummy mode or dev (`App.tsx`); Demo controls → Loader previews the page loader.
- **Loading a page or panel:** `PageLoader` (`ui/wavy-loader.tsx`) with an area's lines from `lib/loadingLines.ts`; small spinners only inside buttons.
- **Forms with Save:** use `SaveButton` (it also shows the floating unsaved-changes bar); pass `onDiscard` (`useSaveOnNextSection().discard`).
- **Lists:** compact density is `html[data-density=compact]` (`lib/density.ts`); new list rows that should tighten get `data-density-row`.
- **AI help** (`server/assist.ts`, `src/app/api/assist.ts`): writing help needs `ANTHROPIC_API_KEY`; unanswered questions come from Inbox messages and test chats answered with Meta's fallback or handed off.
- **⌘K palette** (`shell/CommandPalette.tsx`) lists pages, settings, the open agent's sections and quick actions; add new pages there. The studio's **Try it** panel (`steps/TryItPanel.tsx`) is the quick test chat from any section.
- Effects return nothing or a cleanup function: wrap calls like `scrollIntoView` in a block body (newer browsers return a Promise from it, which crashes React).

## Support platform (Home, Inbox, Tickets, Contacts, Broadcasts, Analytics)

- **Server modules:** `inbox.ts` (chats, replies, thread control, canned responses, webhook, AI assist), `tickets.ts` (tickets, SLA, routing, CSAT, support settings, notifications, analytics), `contacts.ts` (contacts, fields, segments, CSV import), `broadcasts.ts` (templates, broadcasts, send worker). All workspace-scoped; sending needs `ownsMetaAssets()`.
- **Model:** one conversation per customer phone; a ticket is one issue inside it (opens on handoff, take-over or a team reply).
- **Sample data never reaches Meta:** rows with `sample: true` are stored but not sent. Tests send only to sample contacts.
- **Shared pure logic** lives in `src/` and is imported by the server too: `src/app/inbox/sampleData.ts`, `src/app/broadcasts/templates.ts`. SLA business-hours maths is `server/businessHours.ts`.
- **Tests:** `node --test server/*.test.ts src/app/contacts/csv.test.ts src/app/whatsapp/signupEvent.test.ts src/app/wizard/*.test.ts`.

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
  - Skill and rich reply (UI skill) titles allow only lowercase letters, numbers and hyphens (`skillTitle`); the console keeps the readable name.
  - Tool value names may be anything but must be unique across path, query, headers and body together.
  - A connector `PUT` without `auth_config` keeps the saved keys; `upsertApiKey` replaces all keys. Keys are never kept in the browser (`stripConnectionSecrets`).
  - A tool run can answer `status: "success"` with the failure inside `output` (`{status:{code}, body}`; code 1 = finished). Read it with `readToolRun` (`src/app/wizard/toolRun.ts`).
  - `agent_test` doesn't report tool calls; its conversation turns do (`user_phone_number=<conversation_id>`), about a second after the reply (`src/app/wizard/testTools.ts`).
  - All tool request building goes through `src/app/wizard/toolRequest.ts` (payload, read-back, preview, test input).
  - Websites: Meta answers `completed` with `pages_crawled: 0` even when the agent learned from the site (checked with a question only the page answers), so never show 0 pages as fact (`src/app/wizard/websites.ts`). A `PUT` with the same URL queues a fresh read and stamps `last_crawled_at` at queue time.

## Deliberately not wired

- **Native integrations:** there is no Meta API for them, so the tab stays a mock.
- **Live inbound messages:** the webhook receiver exists (`POST /api/webhooks/whatsapp`, `server/inbox.ts`; optional `WEBHOOK_VERIFY_TOKEN`, `APP_SECRET`), but Meta still sends this number's webhooks to Helo.ai. Until they're routed here, the Inbox rebuilds each chat from Meta's conversation turns (the agent's replies; customer text shows as a placeholder), and Demo controls → Inbox → "Simulate customer message" drives the same processor.
- **Budget and mTLS:** out of scope per PRD §4.
- **Duplicate agent:** a copy needs a second phone number, and the setup has one.
