# Helo.ai console for Meta Business Agent

A web console for configuring Meta's WhatsApp Business Agent through Meta's Platform API, with a support desk around it: an inbox, tickets, contacts, analytics and reports. Meta runs the agent; this console sets it up.

- **Frontend:** React 19, Vite and Tailwind 4 (`src/`)
- **API server:** Node and TypeScript (`server/`), backed by MongoDB
- **Docs site:** Fumadocs on Next.js (`docs-site/`), live at <https://helo-docs.vercel.app>

## Run it locally

```bash
npm install
npm run dev:server   # API on :8787
npm run dev          # console on Vite; /api is proxied to the server
```

Settings are read from the environment (a local `.env`, which is never committed) through `server/platform/env.ts`.

- **The main ones:** `MONGODB_URI`, `MONGODB_DB`, `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_APP_SECRETS`, and `SMTP_USER` with `SMTP_PASS` for email.
- **Connecting WhatsApp numbers:** `META_APP_ID`, `META_APP_SECRET` and `META_ES_CONFIG_ID`, or `EMBEDDED_SIGNUP_LINK`.
- **AI writing help:** `ANTHROPIC_API_KEY`.

Without MongoDB or Meta credentials, open the console in demo mode (Dummy mode). It runs entirely in the browser with sample data.

## Checks

```bash
npm run build      # type-checks src/ and server/, builds the console and the API bundle
npm run lint       # oxlint, 0 warnings
npm test           # unit tests
npm run test:e2e   # end-to-end journeys against a throwaway database and a fake Meta
npm run test:ui    # every page in a browser
```

The API is described in OpenAPI 3.1 (`server/openapi/`, committed as `docs/openapi.json`; regenerate it with `npm run docs:openapi`).
