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
- **IDs stay on the server:** client paths use the literal placeholders `PHONE_NUMBER_ID` / `WABA_ID`, and the server fills them in from `.env`. Never put real IDs in client code.
- **There is no test suite.** Verify with `npm run build` (type-checks `src/` and `server/`) and `npm run lint`. Lint is clean; keep it that way. Context hooks are allowed by name in `.oxlintrc.json`; other shared helpers go in a `.ts` file, not next to a component.

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

## Deliberately not wired

- **Native integrations:** there is no Meta API for them, so the tab stays a mock.
- **Handoff bell and live inbound events:** they need webhooks, which need the app secret.
- **Budget and mTLS:** out of scope per PRD §4.
- **Duplicate agent:** a copy needs a second phone number, and the setup has one.
