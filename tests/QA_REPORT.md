# QA report: first pass

## Status after the fixes (12 Oct 2026)

Every finding below is fixed, except QA-31, which is deliberately left strict. The tests that reproduced the findings are now ordinary tests (no `todo` left).

- **High:**
  - QA-01: escalations continue after an on-time first reply.
  - QA-02 and QA-15: restricted agents are checked before any action, and when reading a ticket by its number.
  - QA-03: `refusal()` refuses root/batch Graph writes, protected ids in the body, form-encoded PINs, and any letter case.
  - QA-04: the Graph relay is read-only and refuses `?ids=`/`batch`.
  - QA-06: replies, thread control, blocks and turns use the chat's own number.
  - QA-10: simulate works only on sample chats.
- **Medium:**
  - QA-05: `isRole` checks own keys only.
  - QA-07 and QA-27: one formula-safe `csvCell` for every CSV.
  - QA-08 and QA-11: number and template events show in the log, in sentences.
  - QA-12: no code change; the test now waits for the relay's after-response write.
  - QA-13: fields in other scripts get their own keys; header matching handles any script; blank headers match nothing.
  - QA-16: a stale form can't undo a customer's STOP (`optedOutWas`).
  - QA-18: 10 digits without + or 00 are refused as a local number.
  - QA-20: the webhook body is capped at 5 MB before the signature check.
  - QA-30: a broadcast is created once per dialog key or identical content within 30 s.
  - QA-35: an error boundary, plus a one-time reload on `vite:preloadError`.
- **Low and improvements:**
  - QA-09: business minutes step at most an hour, so DST is exact.
  - QA-14: shifted deadlines are capped at "never".
  - QA-17: `dayStart` settles the offset twice.
  - QA-19: skipped rows carry their file line.
  - QA-21: a per-account login cap across IPs.
  - QA-22: if no owner is left after a race, the change is undone with a 409.
  - QA-24: presets use the workspace's time zone on Analytics, Reports and Home.
  - QA-25: escalation levels must rise on each clock.
  - QA-28: `dur` rounds first.
  - QA-29: an invalid segment id gives 400.
  - QA-32: quotes in the business's text can't break the instruction.
  - QA-33: a stray % in a map link doesn't throw.
  - QA-34: `npm test` is the gate in CLAUDE.md and the skill.
  - QA-36: `lint:tw` is clean.
  - QA-37: Reports shows a loader, and an error with Try again.
  - QA-38: Dummy mode routes through the shared `routePlan`.
- **Smaller notes:**
  - Skill names in other scripts get a stable tag (`skill-xxxx`).
  - Routing keywords match at word starts ("no" no longer matches "know").
  - `playwright-core` is pinned as a direct dev dependency.
- **Not changed: QA-31.** Emoji in button labels still count as two. Loosening the limit before confirming how Meta counts could let saves fail at Meta. Its eval stays `known`.

Gates after the fixes:

| Gate | Result |
|---|---|
| build | pass |
| lint | 0 warnings |
| lint:tw | exit 0 |
| `npm test` | 221/221 |
| `npm run test:e2e` | 87/87 |
| evals | 46/47 Dummy mode, 49/50 upstream; the remaining case is QA-31, known |
| `npm run test:ui` | 89/89, on two runs in a row; the error and stale checks now wait for their message instead of racing the page |


Date: 12 Oct 2026 · Branch `worktree-agent-a119c6662efff8335` (from `947c620`) · No product code changed.

**Outcome.** The core flows hold up end to end: sign-up, roles, webhook ingest, the ticket lifecycle, analytics by local day, reports, imports and broadcasts all work against a real server and database. There are also 4 high-severity problems:

- Escalations silently stop after an on-time first reply (QA-01).
- Restricted agents can act on other people's chats (QA-02).
- The protected business account can still be rewired through a Graph batch call (QA-03).
- The raw Graph relay gives admins owner-only powers and can read other businesses (QA-04).

Every finding below has a test that reproduces it. Those tests are marked `todo` with the finding's id, so the suites stay green; each one flips to passing once its finding is fixed.

## How to run

| What | Command | Needs |
|---|---|---|
| All unit tests | `npm test` (globs every `server/**/*.test.ts` and `src/**/*.test.ts`) | nothing |
| End-to-end journeys | `npm run test:e2e` | MongoDB (`E2E_MONGODB_URI`, or `MONGODB_URI` from the nearest `.env`); uses port 8797 and a throwaway `meta_agent_e2e_*` database that is always dropped |
| AI evals, Dummy mode | `npm run test:evals` | nothing |
| AI evals, fake upstream | `node tests/evals/run.ts --target=upstream` | MongoDB, as above |
| UI checks | `npm run test:ui` (`--modes=dummy,empty,error,loading,stale`, `--pages=home,…`) | MongoDB, installed Chrome; Vite on 5176, API on 8797 |
| Leftover databases | `node tests/e2e/cleanup.ts` drops `meta_agent_e2e_*` only | MongoDB |

None of these reach real Meta. The server runs with `UPSTREAM=meta` pointed at an in-process fake, and the shell environment isn't inherited, so no real token leaks into the tests. The user's :5173 and :8787 servers are never touched.

## Gate results (run on this branch)

| Gate | Result |
|---|---|
| `npm run build` | ✅ pass (tsc -b covers the new `server/*.test.ts` too) |
| `npm run lint` | ✅ 0 warnings |
| `npm run lint:tw` | ❌ exit 1: **8 pre-existing** findings in product files this pass didn't touch (QA-36) |
| `npm test` (all unit) | ✅ 219 tests: 202 pass, 0 fail, 17 todo (known findings) |
| CLAUDE.md's `node --test …` command | ✅ 162 tests: 151 pass, 11 todo. It still skips 6 test files (QA-34) |
| `npm run test:e2e` (8 journeys) | ✅ 86 tests: 69 pass, 0 fail, 17 todo (known findings); about 3.3 min |
| `npm run test:evals` (Dummy) | ✅ 47 cases: 44 pass, 3 known |
| evals `--target=upstream` | ✅ 50 cases: 47 pass, 3 known |
| `npm run test:ui` | 89 checks: 82 clean, 7 with problems (QA-35, QA-37), and no contrast violations |

## Coverage map

"Before" means the tests that existed at `947c620`: 27 files and 111 tests, all pure-function unit tests, with no route, database or UI tests. "After" adds 9 unit files (108 tests), 8 end-to-end journeys (86 tests), 50 eval cases and 89 UI checks.

| Area | Before | Added now | Still not covered | Riskiest gap left |
|---|---|---|---|---|
| Auth & workspaces (roles, invites, switching, removal) | `permissions.test.ts` (3 basic tests, and outside the CLAUDE.md gate) | `permissions.matrix.test.ts` (whole matrix, every actor × from × to); `auth-roles.e2e.ts` (magic-link sign-up, login, 415 on form posts, role × route matrix, invites answered in-app, switching, removal, last owner) | email change, password reset, rate limits, concurrent demotion (QA-22) | two owners demoting each other at once |
| Protected business account | `protect.test.ts` | `protect.edges.test.ts`; `protected-account.e2e.ts` (relay and number routes refused, listen-only: no away message or CSAT) | coexistence sync, billing routes | QA-03 batch bypass |
| Webhook receiver | `webhookCore.test.ts` (pure) | `webhookCore.edges.test.ts`; `inbox-webhook.e2e.ts` (verify handshake, bad or absent signature, retries stored once, statuses only forward, unrouted numbers, garbage bodies) | `reprocessWebhooks` after a crash, body size (QA-20) | unbounded body before the signature check |
| Inbox (replies, 24-hour window, take over / hand back, hidden numbers) | `sessions`, `interactive`, `media`, `customer` tests (pure) | `inbox-webhook.e2e.ts`: unicode, the window, thread control with `X-API-Version 1.0.0`, BSUID customers, STOP/START | media upload, canned responses, snooze and remind, presence, search | QA-02, QA-06, QA-10 |
| Ticket lifecycle | `ticketRules.test.ts` (2 tests, outside the gate) | `ticketRules.edges.test.ts`; `tickets.e2e.ts` (open, pause and resume, CSAT, reopen within 3 days vs new after, resolve race, handoff race, permissions, restricted agents, away message once per 12 h, settings validation) | bulk actions | QA-15 |
| SLA & business hours | `businessHours.test.ts` (6 tests, no DST) | `businessHours.edges.test.ts` (DST both ways in NY and London, holidays across the year end, closed weeks, boundaries) | — | QA-09 (low) |
| Routing & escalation | `routing.test.ts` | `routing.edges.test.ts`; escalation sweep run in-process with a chosen "now" in `tickets.e2e.ts` | reassign-to-team levels end to end, round robin under concurrency | **QA-01** |
| Activity log | `activityText.test.ts` (3 tests, outside the gate) | `activityText.kinds.test.ts` (every emitted kind with its real data); `activity.e2e.ts` (before → after, who may read what, filters, error reference, paging, CSV) | live stream (`/api/stream`) | QA-08, QA-12 |
| Analytics definitions & time zones | `analytics.test.ts` (4 tests) | `analytics.edges.test.ts` (DST days in both hemispheres, :30 and :45 zones, filter bounds); `analytics-reports.e2e.ts` (IST midnight bucketing, notes aren't answers, backlog, heatmap, previous period, number filter) | tool metrics, spend, agent usage | QA-17 |
| Reports & schedules | `reports.test.ts` | `analytics-reports.e2e.ts` (CSV with BOM, roles, schedule validation, send now with attachments) | the timed job firing at its hour | QA-27 |
| Contacts & CSV import | `csv.test.ts` (3 tests) | `csv.edges.test.ts`; `contacts-import.e2e.ts` (fields, import exactly as the browser sends it, unicode and RTL, skip reasons, segments, search, delete cascade) | export file (browser) | QA-16, QA-13, QA-18 |
| Broadcasts & templates | `templates.test.ts`, `sendErrors.test.ts` | `broadcasts.e2e.ts` (worker with JOBS on, opted-out and sample contacts, name fallback, ticks and replies, late failures, cancel) | template creation and deletion, retries after the marketing cap | QA-30 |
| Billing & usage | none | none | everything (`billing.ts`, the `agentUsage` collector) | **untested** |
| Agent studio (sections, publish, rollback) | wizard pure tests | 50 eval cases (rich replies, skills, tools, websites, the test chat in Dummy mode and via the relay) | publish and rollback, `hydrateFromMeta`, connectors CRUD | **publish/rollback untested** |
| API docs drift | `openapi.test.ts` | — | the method-level drift in QA-04 | — |
| Dummy-mode parity | none | UI dummy runs (40 checks) and the scripted demo eval | `supportDummy.ts` reimplements routing (QA-38) | — |
| UI (pages × widths × themes, empty / error / loading) | none | `tests/ui/run.ts` (89 checks) | wizard steps, dialogs | QA-35 |

## Findings, most severe first

Each finding gives its label, what breaks, the steps to reproduce, file:line, the root cause and the smallest fix. "Test" names the check that reproduces it (marked `todo` until fixed).

### QA-01 · bug · high: escalations stop for good once the first reply is on time

- **Breaks:** with the default matrix, an urgent or high ticket answered on time never escalates when its resolution target breaches. Supervisors and admins are never told.
- **Steps:** turn escalation on (default levels: urgent = FR 75%, FR 100%, resolution 100%). Open an urgent ticket and reply within 5 minutes. Leave it unresolved past `resolveDueAt`, then let the sweep run. `escalationLevel` stays 0.
- **Where:** `src/app/support/routing.ts:211-217` (`nextEscalation`).
- **Cause:** levels fire strictly in order. Level 1's first-reply clock is stopped (`clockPercent` answers null), so `nextEscalation` returns null, and every later level is blocked behind it.
- **Fix:** skip first-reply levels whose clock stopped:
  ```ts
  for (let i = current; i < levels.length; i++) {
    const pct = clockPercent(t, levels[i].clock, now)
    if (pct == null && levels[i].clock === 'first_response' && t.status !== 'resolved') continue
    return pct != null && pct >= levels[i].percent ? i + 1 : null
  }
  return null
  ```
- **Test:** `server/routing.edges.test.ts` (2), `tests/e2e/tickets.e2e.ts` "a ticket answered on time still escalates…"

### QA-02 · bug · high: restricted agents can reply, take over, note and snooze in someone else's chat

- **Breaks:** with "Agents see only their chats" on, an agent POSTs a reply into a chat assigned to someone else. The message is **sent to the customer** and stored, and only then does the API answer 403. The same applies to `control`, `notes`, `snooze`, `remind`, `interactive`, `media` and `/api/broadcasts/send-one`.
- **Steps:** set `restrictAgents: true`. Assign a chat to a supervisor. As an agent, `POST /api/inbox/conversations/{phone}/messages`.
- **Where:** `server/inbox.ts:799-859`. The only scope check is `getConversation(phone, me)` at :859, after the action. Also `server/broadcasts.ts:337`.
- **Cause:** the scope check (`needInScope`) runs on the read that follows the write, not before it.
- **Fix:** at `inbox.ts:804`, before any POST action:
  ```ts
  await needInScope(me, (await conversations().findOne({ workspaceId: ws(), phone }, { projection: { assigneeId: 1 } }))?.assigneeId)
  ```
  Add the same line in `send-one`.
- **Test:** `inbox-webhook.e2e.ts` "a restricted agent can't reply into someone else's chat".

### QA-03 · bug · high: the protected account can still be rewired (Graph batch, form bodies, body ids)

- **Breaks:** CLAUDE.md promises the `.env` account's subscriptions, PIN and registration can't be changed. Several requests get past `refusal()` anyway:
  - `POST /api/graph/` with `{"batch":[{"method":"POST","relative_url":"<WABA>/subscribed_apps"}]}` reaches Meta. The path names no id, so the ownership check passes too.
  - A form-encoded body `pin=123456`: the pattern requires `?` or `&` before `pin=`.
  - `{"waba_id":"<WABA>"}` in the body of `whatsapp_credit_sharing_and_attach`: only path and query ids are read. The relay's 10-digit ownership check happens to stop it today; server modules don't get that check.
  - `/Subscribed_Apps`: the pattern is case-sensitive.
- **Steps:** see `tests/e2e/protected-account.e2e.ts` (batch) and `server/protect.edges.test.ts` (4 cases).
- **Where:** `server/protect.ts:20-33`.
- **Cause:** a deny-list over path text.
- **Fix:** refuse any Graph write whose path has no id segment (batch is `POST /`). Make both patterns case-insensitive. Treat `(^|[?&\s])pin=` and any protected id anywhere in the body as protected:
  ```ts
  const named = [...`${path} ${body ?? ''}`.matchAll(/\d{6,}/g)].map((m) => m[0])
  if (kind === 'graph' && !/\/\d{6,}/.test(p)) return 'Batch and root Graph calls aren’t allowed from this console.'
  ```

### QA-04 · bug · high: the raw Graph relay gives admins owner powers and reads other businesses

- **Breaks:**
  - `/api/graph/*` forwards **any method** for anyone with `agent.edit` (admins). An admin can therefore `POST /api/graph/WABA_ID/subscribed_apps` with an `override_callback_uri`, register or deregister numbers, or change the PIN on any non-protected account. Settings › WhatsApp reserves all of that for `whatsapp.manage` (owners).
  - `pathIds` checks only the path, so `GET /api/graph/?ids=<any id>&fields=…` runs with the workspace's token. For the `.env` workspace that is the server's (BSP) token, readable by **any member, agents included**.
  - The spec (`docs/openapi.json`) documents `/api/graph/{path}` as GET only.
- **Where:** `server/app.ts:182-201`, `server/upstream.ts:42`.
- **Fix:**
  ```ts
  if (metaRoute[1] === 'graph' && req.method !== 'GET') return sendError(res, 405, 'Not allowed', 'The Graph relay is read-only.')
  if (/[?&](ids|batch)=/.test(path)) return sendError(res, 403, 'Not allowed', 'Name one id in the path.')
  ```
  Writes go through the dedicated routes, which check `whatsapp.manage` and `numbers.edit`.
- **Test:** `auth-roles.e2e.ts`, `protected-account.e2e.ts`.

### QA-06 · bug · high (multi-number workspaces): replies leave from the wrong number

- **Breaks:** a customer writes to the workspace's second number, and the team's reply, the CSAT question, templates and blocks are all sent from the **first** number. The customer sees a different sender.
- **Steps:** an account with two numbers. A webhook arrives on number 2. Reply in the Inbox, and the fake Meta receives `POST /<number1>/messages`.
- **Where:** `server/inbox.ts:605` (`'/PHONE_NUMBER_ID/messages'`), `:853` (block), and the thread control at `:685`.
- **Cause:** `resolveIds` maps the placeholder to the workspace default and ignores `conversations.phoneNumberId`.
- **Fix:** in `deliver`, use the number the chat belongs to:
  ```ts
  const from = (await conversations().findOne({ workspaceId: ws(), phone }, { projection: { phoneNumberId: 1 } }))?.phoneNumberId ?? 'PHONE_NUMBER_ID'
  // metaJson('graph', 'POST', `/${from}/messages`, …)
  ```
  Do the same for block and thread control.
- **Test:** `inbox-webhook.e2e.ts` "a reply goes out from the number the customer wrote to".

### QA-10 · risk · high: any member can forge a customer message into a real chat

- **Breaks:** `POST /api/inbox/demo/simulate {phone, text}` runs the real webhook processor for **any** phone, for any role. The forged text appears as the customer's own words. It also opens or reopens tickets, can rate a ticket ("Good"), toggles opt-out (STOP), and can trigger a **real** away message to the customer through Meta.
- **Where:** `server/inbox.ts:880-905`.
- **Fix:** allow it only for sample chats, and refuse otherwise:
  ```ts
  if (!conv?.sample) throw new HttpError(403, 'Simulate only works on sample chats.')
  ```
  Optionally limit it to `settings.manage`.
- **Test:** `inbox-webhook.e2e.ts` "a teammate can't forge…".

### QA-05 · bug · medium: "toString" is accepted as a role

- **Breaks:** `PUT /api/workspace/members/{id} {"role":"toString"}` answers 200 and stores the role (the same goes for invites). The member then has an unknown role: no permissions, labelled "Member".
- **Where:** `src/app/lib/permissions.ts:13`.
- **Cause:** `v in RANK` walks the prototype chain.
- **Fix:** `Object.hasOwn(RANK, v)`.
- **Test:** `permissions.matrix.test.ts`, `auth-roles.e2e.ts`.

### QA-16 · bug · medium (compliance): a stale contact form re-subscribes someone who sent STOP

- **Breaks:** the contact sheet sends `optedOut` from when it was opened. If the customer sends STOP meanwhile, saving the sheet opts them back in to broadcasts.
- **Where:** `server/contacts.ts:115` (and `ContactsPage.tsx:78`).
- **Fix:** write `optedOut` only when the person changed it:
  ```ts
  ...(typeof b.optedOut === 'boolean' && { optedOut: b.optedOut })
  ```
  Have the form send it only when the switch was touched. Better still, refuse to clear an opt-out that arrived after `b.loadedAt`.
- **Test:** `contacts-import.e2e.ts`.

### QA-07 · risk · medium: contacts CSV export runs formulas

- **Breaks:** contact names come from WhatsApp profiles, which customers control. A name like `=HYPERLINK("http://evil","click")` becomes a live formula in Excel. Reports already neutralise this; the contacts export doesn't.
- **Where:** `src/app/contacts/csv.ts:34`.
- **Fix:** reuse the reports' rule:
  ```ts
  const esc = (v: string) => (/^[=+\-@\t\r]/.test(v) || /[",\n\r]/.test(v) ? `"${(/^[=+\-@\t\r]/.test(v) ? "'" : '') + v.replace(/"/g, '""')}"` : v)
  ```
  Phone cells start with `+`, so export them without the plus or as `'+91…`.
- **Test:** `csv.edges.test.ts`.

### QA-12 · bug · medium: the activity log's "AI agent" area is always empty

- **Breaks:** Settings › Activity › AI agent shows nothing on a real server. Nothing writes `agent.*` events; agent changes live only in `audit_log`. Dummy mode shows one, so demos hide the gap.
- **Where:** `src/app/activity/activityText.ts:26` (the area). No emitter in `server/record.ts`.
- **Fix:** in `record()` (`server/record.ts`), after a successful non-GET agent write:
  ```ts
  trace(`agent.${verb}`, { resource, ...summary }, { entity: 'agent', id: phone })
  ```
  This is the same data `ActivityPage` already turns into sentences.
- **Test:** `activity.e2e.ts`.

### QA-08 · bug · medium: number changes (PIN viewed, deregistered, blocked) never show in the workspace log

- **Breaks:** `number.blocked`, `number.pin_viewed`, `number.pin_changed`, `number.registered`, `number.deregistered`, `number.profile_updated` and similar events are written, but match no area prefix. The workspace activity log and its CSV exclude them, including the security-relevant PIN views.
- **Where:** `src/app/activity/activityText.ts:32` (whatsapp area lists only three `number.` kinds).
- **Fix:** list the prefix `number.` in the WhatsApp area, and add sentences for each action, e.g. `case 'number.pin_viewed': return `${who} viewed a number's PIN``.
- **Test:** `activityText.kinds.test.ts`, `activity.e2e.ts`.

### QA-15 · bug · medium: restricted agents can read any ticket by number

- **Breaks:** `GET /api/tickets/{n}` returns someone else's ticket (phone, subject, assignee) to a restricted agent. Numbers are sequential, so they can be walked.
- **Where:** `server/tickets.ts:484` (`one(n)` has no scope check).
- **Fix:**
  ```ts
  if (m === 'GET') {
    const t = await one(n)
    await needInScope(me, t.assigneeId)
    return t
  }
  ```
- **Test:** `tickets.e2e.ts`.

### QA-13 · bug · medium (India/Gulf market): non-Latin field names collide and mis-map on import

- **Breaks:**
  - Contact field keys slug to `[a-z0-9]`, so every Hindi or Arabic label becomes `field`, and a second one is refused ("Two fields would both be called…").
  - On import, `norm()` turns any non-Latin header, and blank headers, into `''`, so they all fill that one non-Latin field.
- **Where:** `server/contacts.ts:187`, `src/app/contacts/csv.ts:44`.
- **Fix:**
  - Key: when the slug is empty, use `field_${hash(label).slice(0, 6)}`.
  - Header matching: normalise with `\p{L}\p{N}` instead of `a-z0-9`:
    ```ts
    h.trim().toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    ```
  - Never match an empty normalised header.
- **Test:** `csv.edges.test.ts`, `contacts-import.e2e.ts`.

### QA-18 · risk · medium: 10-digit local numbers import as foreign numbers

- **Breaks:** `9850000003` (an Indian mobile without +91) passes the 8–15 digit check and is stored as a number in another country. Broadcasts to it fail or reach a stranger.
- **Where:** `server/contacts.ts:28-31`.
- **Fix:** add a "default country code" to the import dialog and prefix it to numbers of the national length. Without one, refuse 10-digit numbers with "add the country code".
- **Test:** `contacts-import.e2e.ts`.

### QA-30 · risk · medium: Send pressed twice sends the broadcast twice

- **Breaks:** two concurrent `POST /api/broadcasts` create two broadcasts. Every customer gets the template twice, and the business pays twice.
- **Where:** `server/broadcasts.ts:360`.
- **Fix:** accept an `idempotencyKey` from the dialog, created when the dialog opens, with a unique index on `{workspaceId, idempotencyKey}`. Return the existing broadcast on a duplicate key.
- **Test:** `broadcasts.e2e.ts`.

### QA-35 · bug · medium: a page whose code fails to load leaves a blank white screen

- **Breaks:** after a deploy, a tab left open that navigates to a page it hasn't loaded yet fetches an old chunk name. The import fails: "Failed to fetch dynamically imported module". There is no error boundary anywhere, so the whole app unmounts to white, with no message and no reload button. This reproduces for Home, Inbox, Tickets, Contacts, Broadcasts and WhatsApp.
- **Where:** `src/app/components/shell/ProductShell.tsx:30-40,185` and `src/app/App.tsx:150`. No `ErrorBoundary` exists in `src/`.
- **Fix:**
  - Add one small error boundary around the two `<Suspense>`s that shows "This page couldn't load. Reload".
  - Add `window.addEventListener('vite:preloadError', () => location.reload())`.
- **Test:** `npm run test:ui -- --modes=stale`.

### QA-20 · risk · medium: the public webhook reads unlimited bodies before checking the signature

- **Where:** `server/inbox.ts:443`.
- **Breaks:** anyone can stream an arbitrarily large POST into memory.
- **Fix:** reuse `readRaw(req, 5_000_000)` (already in the file), and 413 above it. Meta's payloads are small.

### QA-11 · bug · low: template review results read "The system: template status"

- **Where:** `activityText.ts`, which has no `template.status` case; the emitter is `server/health.ts:99`.
- **Fix:**
  ```ts
  case 'template.status': return `Meta ${String(d.event).toLowerCase()} the template “${d.name}”${d.reason ? `: ${d.reason}` : ''}`
  ```
- **Test:** `activityText.kinds.test.ts`.

### QA-29 · bug · low: a malformed segment id is a 500

- **Breaks:** `POST /api/broadcasts/preflight {segmentId:"abc"}` answers 500 (BSONError).
- **Where:** `server/broadcasts.ts:111`.
- **Fix:**
  ```ts
  if (!ObjectId.isValid(String(segmentId))) throw new HttpError(404, 'That segment no longer exists.')
  ```
- **Test:** `broadcasts.e2e.ts`.

### QA-19 · bug · low: skipped-row numbers are wrong when the CSV has blank lines

- **Where:** `server/contacts.ts:159` (`row: i + 2`); `parseCsv` drops blank lines.
- **Fix:** have the browser send each row's source line number with it (`parseCsv` knows it), and report that.
- **Test:** `contacts-import.e2e.ts`.

### QA-14 · bug · low: with no open hours, resuming a paused ticket writes Invalid Date

- **Breaks:** with no open hours, deadlines are `8.64e15`, the largest date. `shiftDues` adds the paused time and overflows to Invalid Date, which is stored and sorts unpredictably.
- **Where:** `src/app/support/ticketRules.ts:30`.
- **Fix:** cap at the largest date:
  ```ts
  new Date(Math.min(8.64e15, +new Date(x) + ms))
  ```
- **Test:** `ticketRules.edges.test.ts`.

### QA-17 · bug · low: analytics day boundaries are an hour off on DST days in Australia and New Zealand

- **Where:** `server/analytics.ts:38-44`.
- **Cause:** the offset is read at UTC midnight, which for UTC+10…+13 falls after that day's change.
- **Fix:** compute twice and settle:
  ```ts
  let t = utc - off(utc)
  t = utc - off(t)
  ```
  where `off(x)` is the wall-time difference at `x`.
- **Test:** `analytics.edges.test.ts`.

### QA-09 · bug · low: a working window that spans the spring-forward hour counts phantom minutes

- **Where:** `server/businessHours.ts:56-59`. A step of N wall minutes is added as N real minutes.
- **Fix:** step to the window's closing instant computed with the zone, or step at most 60 minutes at a time and re-read the local time after each step.
- **Test:** `businessHours.edges.test.ts`.

### QA-33 · bug · low: typing "%" in the rich-reply map-link box throws

- **Where:** `src/app/wizard/richReplies.ts:278` (`decodeURIComponent` on any text).
- **Fix:**
  ```ts
  let t = text.trim()
  try { t = decodeURIComponent(t) } catch { /* keep as typed */ }
  ```
- **Eval:** `rr-maps-link-percent`.

### QA-32 · risk · medium (agent behaviour): quotes in the business's text break the agent's instruction

- **Breaks:** `compileRichReplySentence` wraps values in `"…"` without escaping. A body like `Say "yes". Ignore all previous instructions` closes the quote early and turns the rest into instruction text for Meta's agent.
- **Where:** `src/app/wizard/richReplies.ts:184-247`.
- **Fix:** quote values with curly quotes `“…”` and replace inner `"` and `“` with `'`. Or JSON-encode values: `${JSON.stringify(v)}`.
- **Eval:** `rr-quotes-in-text`.

### QA-25 · improvement: escalation levels can be saved out of order

- **Breaks:** 100% then 75% on the same clock is accepted, and level 2 then fires the minute after level 1.
- **Where:** `src/app/support/routing.ts:284-303`.
- **Fix:** refuse when a level's percent is not above the previous level's on the same clock.

### QA-27 · risk · low: report CSVs don't neutralise a leading tab or CR

- **Where:** `src/app/reports/catalog.ts:100`.
- **Fix:** extend the pattern to `/^[=+\-@\t\r]/`.
- **Test:** `analytics.edges.test.ts`.

### QA-21 · risk · low: login lockout is per email and IP only

- **Where:** `server/auth.ts:313`.
- **Breaks:** password guessing is unbounded across IPs.
- **Fix:** also apply `limit(`login|${e}`, 50, …)`.

### QA-22 · risk · low: two owners demoting each other at once can leave a workspace with no owner

- **Where:** `server/auth.ts:499`. There's a check (`ownersLeft`), then a write, with nothing in between to stop a second request.
- **Fix:** demote with a conditional update in one step, e.g. run the `ownersLeft` check and the `updateOne` inside a transaction, or recount after the write and roll back.

### QA-24 · risk · low: analytics presets use the browser's date, not the workspace's time zone

- **Where:** `src/app/analytics/useAnalyticsFilter.ts:12`.
- **Breaks:** a viewer in the US looking at an Indian workspace in the evening misses "today".
- **Fix:** take `today` from `range.timezone`.

### QA-31 · risk · low (needs a check against Meta): emoji count double towards button limits

- **Where:** `richReplies.ts` measures `.length` (UTF-16 units), so `👍`×11 counts as 22 against WhatsApp's 20.
- **Fix:** measure with `[...v].length`, after confirming how Meta counts.
- **Eval:** `rr-buttons-emoji-label`.

### QA-28 · bug · trivial: 59.6 minutes reads "60m"

- **Where:** `src/app/analytics/format.ts:4`.
- **Fix:** round first: `const m = Math.round(min)`, then branch on `m`.

### QA-37 · improvement · low: Reports' schedule list shows nothing while it loads

- **Where:** `src/app/reports/ReportsPage.tsx:116` renders `null` until schedules arrive.
- **Fix:** show a small `PageLoader` or skeleton there.
- **Found by:** `test:ui` loading mode.

### QA-34 · improvement: the documented test command skips 6 test files

- **Breaks:** CLAUDE.md's `node --test …` never runs:
  - `src/app/activity/*`, `src/app/support/*`, `src/app/lib/*` (`permissions`, `customer`);
  - `src/app/broadcasts/sendErrors.test.ts`;
  - `src/app/whatsapp/profileRules.test.ts`.
- **Fix:** point the docs and the code-maintainer gate at `npm test`, which globs everything.

### QA-36 · improvement: `npm run lint:tw` is red on `main`

- **Breaks:** 8 unaccepted suggestions in files this pass didn't touch:
  - `AgentStudioShell.tsx:269` `w-[3px]`
  - `SettingsPage.tsx:428`
  - `tabs.tsx:48`
  - `tooltip.tsx:51`
  - `wavy-loader.tsx:49` `z-[70]`
  - `ProfileTab.tsx:39` and `ToolTestDialog.tsx:164` `break-words`
  - `SignupWindow.tsx:125`
- **Fix:** run `npm run lint:tw -- --fix` for the identical-CSS ones, and add the rest to `ACCEPTED`.

### QA-38 · risk · low: Dummy mode re-implements routing

- **Where:** `src/app/api/supportDummy.ts:337` ("Same decision as the server's routeTicket").
- **Breaks:** this is a second copy of the server's logic, and it will drift.
- **Fix:** call `firstMatch` / `applyRule` / `pickFromPool` from `routing.ts` the way the server does. The duplicated part is the default-routing branch.

### Smaller notes, no test written

- **Two non-Latin skill names can't coexist.** Both slug to `skill`, by design. A hash fallback like rich replies' `reply-ab12` would allow it (eval `skill-title-two-hindi`).
- **Routing keywords match substrings.** "no" matches "know". Consider word boundaries (`\b` doesn't work for Devanagari, so split on whitespace).
- **`playwright-core` isn't a direct `devDependency`.** It's installed through `@axe-core/playwright`. Pin it if the UI checks become a gate.

## What was checked and is fine

- Sign-up links are single-use.
- Sessions survive invites and keep their own workspace.
- Removed members lose access at once.
- The last owner is protected.
- Auth routes refuse form posts.
- Webhooks:
  - wrong, absent and tampered signatures get 401;
  - retries are stored once;
  - statuses never move backwards;
  - unknown numbers are kept but not routed;
  - garbage bodies don't cause retry storms.
- Inbox:
  - the 24-hour window is enforced before anything reaches Meta;
  - thread control sends `X-API-Version: 1.0.0`;
  - BSUID customers can't be handed over.
- Opt-out and broadcasts:
  - STOP and START work;
  - opted-out and sample contacts never reach Meta in broadcasts.
- Tickets:
  - concurrent resolves give exactly one 200 and one 409;
  - concurrent handoffs leave one ticket;
  - waiting time shifts deadlines exactly;
  - CSAT is recorded once and doesn't reopen.
- Escalation fires in order, once per level, as long as QA-01 doesn't apply.
- Analytics:
  - IST midnight bucketing is right;
  - notes aren't counted as answers.
- The report CSVs start with a BOM and neutralise formulas.
- Meta 401 is turned into 502, so it never logs anyone out.
- Meta 429 on a write is not retried.
- UI:
  - no uncaught errors and no horizontal scroll on any main page at 1440 or 390, in light or dark;
  - axe colour contrast is clean on all 10 pages in both themes;
  - empty workspaces render;
  - every data-API failure shows a message;
  - loaders show while waiting (except QA-37).

## What to improve next

1. **Fix the four highs** (QA-01, 02, 03, 04, then 06 and 10). Each is a few lines. The matching `todo` tests flip to passing; remove the `todo` flag when they do, so they become regression tests.
2. **Make `npm test` the gate.** Do this in CLAUDE.md and the code-maintainer skill (QA-34). Add `npm run test:e2e` before pushes to `main`, which deploys to production.
3. **Cover what's still dark:**
   - billing and usage (`billing.ts`, the `agentUsage` "Billable account not found" state);
   - agent studio publish and rollback (`setRollout` never re-sending `rollout`/`ai_audience`, the CLAUDE.md rule);
   - Embedded Signup.
4. **Add an error boundary and the chunk-reload handler** (QA-35). Then add `test:ui` to the release checklist.
5. **Decide the compliance items with the product owner:** stale opt-outs (QA-16), local-number imports (QA-18) and double-send protection (QA-30).

## Load baseline (`npm run test:load`, laptop → Atlas, fake Meta)

Comparable between runs on the same machine only; the absolute numbers are the e2e environment's network latency, not production's.

| Scenario | Before shared state (commit eda6f8d) | After (phase 1) |
| --- | --- | --- |
| 50 webhooks at once, p50 / p95 | 15.5 s / 16.5 s | 16.3 s / 16.4 s |
| 200 inbox reads at once, p50 / p95 | 11.2 s / 12.0 s | 12.2 s / 13.1 s |
| 100 tickets + 100 overview, p50 / p95 | 30.9 s / 33.9 s | 29.8 s / 32.9 s |

Errors: 0 in every run.

## Settings revamp verification (22 Oct 2026)

Open findings from verifying task `2026-10-22-settings-revamp`. Tests marked `todo` are in `tests/e2e/settings-qa.e2e.ts`; remove the flag when the fix lands.

- **QA-39 (bug, medium).** Two saves at the same moment over the same copy both win on routing rules, escalation, contact fields and the billing budget. `needFresh`/`needUnmodified` read `updatedAt`, then a separate `updateOne` writes, so four simultaneous saves with the same `If-Unmodified-Since` all answer 200 (billing: 3 of 4). Support settings is right: it writes only over the copy it checked (`server/support/tickets.ts:610`). Fix: the same conditional write in `server/support/supportOps.ts` (rules, escalation), `server/support/contacts.ts` (fields) and `server/whatsapp/billing.ts` (budget). Test: `todo`, one per document. **Fixed 22 Oct 2026 for rules, escalation and contact fields** (`saveChecked` in `server/support/stale.ts`, also used by support settings); billing is server-backend's. **Billing budget fixed 22 Oct 2026** (server-backend): `server/whatsapp/billing.ts` writes only over the `updatedAt` it checked and answers 409 when it changed in between; its test is no longer `todo`.
- **QA-40 (risk, medium).** Removing a contact field sets the filter of each segment that used it to `null`. A segment whose only filter was that field then matches every contact: "North only" went from 1 contact to 3 (`server/support/contacts.ts:102`). Fix: delete such segments, or mark them as needing a new filter, rather than widening them. Test: `todo`. **Fixed 22 Oct 2026:** a segment left with no other filter (no tags, no active-days) is deleted and traced `segment.deleted` with `reason: 'field_removed'`; otherwise just the field filter is dropped. The same applies when a select choice a segment filtered on is removed.
- **QA-41 (risk, low).** `PUT /api/support/settings` with `hours.week` holding one day closes every day it leaves out. The PUT is partial for top-level keys and per priority under `sla`, but not per day (`server/support/tickets.ts:100`). Fix: merge `before.week` under the days that were sent. Test: `todo`. **Fixed 22 Oct 2026:** days left out keep their stored hours; a day sent as `null` closes it.
- **QA-42 (bug, medium).** One click on a Settings tab pushes the same address three times, so Back seems to do nothing until the third press. Radix calls `onValueChange={go}` on mousedown and on focus, and the link's `onClick` calls `go` again (`src/app/components/shell/SettingsPage.tsx:115`). Fix: drop `onValueChange={go}` from `<Tabs>`; the links already navigate. Reproduced in a browser (history calls: three times `push /settings/profile`); there's no `todo` test because `test:ui` has no `todo` state. **Fixed 22 Oct 2026:** the tab links stop Radix's mousedown (and so the focus change after it); the click navigates once, and arrow keys still change tabs through `onValueChange` and `confirmLeave()`. A browser flow check counted one `pushState` per click and per arrow press (three before the fix), and Back returned to the previous tab.
- **QA-43 (bug, low).** Budget alert emails go to owners **and admins** (`server/platform/alerts.ts:36`). The Budget alerts switch, though, shows only to owners (`src/app/components/shell/settings/NotificationsSettings.tsx:20`), so an admin can't turn those emails off. The Billing text and the docs also say "owners". Fix: show the switch for `billing.view`, or send budget emails to owners only. **Fixed 22 Oct 2026:** the switch shows for `alerts.receive` (owners and admins, the same roles `raiseAlert` emails); the Billing text and the docs say owners and admins.
- **QA-44 (bug, low).** Saving one form takes away the browser's leave prompt for every other unsaved form on the page. All forms share one `beforeunload` listener, and the first form to clean up removes it (`src/app/components/shell/settings/leaveGuard.ts:41`). This shows on Teams & people: a person row and Chat visibility. Found by reading the code; not reproduced in a browser. Fix: add the listener once at module load (it already checks `hasUnsaved()`). **Fixed 22 Oct 2026:** the listener is added once when `leaveGuard.ts` loads and never removed; `leaveGuard.test.ts` covers it.
- **Known deviation, not new.** Browser Back with unsaved changes leaves without asking. `BrowserRouter` has no `useBlocker`.
