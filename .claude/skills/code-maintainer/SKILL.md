---
name: code-maintainer
description: Maintains this repo's code (the Helo.ai Meta Business Agent console, wizard/). Use for code clean-up, behaviour-preserving refactoring, code hygiene checks, explaining the code architecture, and analysing the code to find and fix bugs. Trigger on requests like "clean up the code", "refactor X", "run a hygiene check", "explain the architecture", "how does the backend work", "find bugs", "why is X broken", "audit the code", or "tidy this file".
---

# Code maintainer

You maintain the Helo.ai Meta Business Agent console: a React 19 + TypeScript + Vite app (`src/`) with a small Node server (`server/`) that relays to Meta and stores data in MongoDB. Five jobs, one playbook each below:

| Job | Playbook | Changes code? |
|---|---|---|
| Explain the architecture | §A | No |
| Code hygiene check | §B | No (report only; fix on request) |
| Code clean-up | §C | Yes |
| Refactoring | §D | Yes |
| Find and fix bugs | §E | Yes |

If the request is ambiguous ("look at the code"), run the hygiene check (§B) and ask before changing anything.

## Ground rules (every job)

**Understand before you touch.**
- Read the code you'll change *and* every caller (`grep -rn` / find references) before editing. Trace the real flow end to end: browser → `src/app/api/*` → `server/index.ts` → handler → MongoDB/Meta.
- Read `CLAUDE.md` first; its rules override habits.

**Smallest correct change.**
- Fix at the root, in the shared function every caller goes through, never by patching one caller.
- Reuse what exists before writing anything new (helpers listed in §Map). No new dependency for what a few lines do.
- No speculative abstraction, config, or "for later" code. Deletion beats addition.

**Behaviour.** Clean-up and refactoring never change behaviour, copy, or visuals. If a change *should* change behaviour, it's a bug fix (§E) or a feature, so say so and ask.

**Match the file.**
- Style: single quotes, no semicolons, 2-space indent, long lines are fine (~140–160). There's no Prettier config, so **never run Prettier or any formatter on whole files**; it rewrites unrelated lines.
- Comments say *why*, not what, at the density of the surrounding code.
- Names follow the file's existing conventions.

**Safety.**
- Never print, log, commit or store secrets: `.env` holds `BEARER_TOKEN`, `MONGODB_URI`, `SMTP_PASS`. Read `.env` only for key names (`grep -oE '^[A-Z_]+' .env`), never values.
- Don't edit `.env`, and don't commit or push unless the user asks.
- Don't stop, start or restart the user's running services (app on 5175, relay on 8787) without asking. Test on separate ports (e.g. relay 8797, app 5176) against a throwaway database.
- Bulk deletes in MongoDB Atlas need the user's go-ahead. Never touch other users' data.
- Hidden config files exist (`.oxlintrc.json`); use `ls -a` before creating a config file so you never overwrite one.

**Verify before you say done** (§Gates). Report what you ran and the result. Never claim a check passed that you didn't run.

## Gates (run after any code change; all must pass)

```bash
npm run build                    # tsc -b (src + server) + vite build
npm run lint                     # oxlint, must be 0 warnings
npm run lint:tw                  # Tailwind canonical classes / conflicts (scripts/check-tailwind.mjs), exit 0
node --test server/record.test.ts
```

Extra checks by area:
- **UI changes:** take a Playwright screenshot of the affected screens before and after and compare them. Wait for `document.fonts.ready`; changing timestamps and font loading are known false diffs. Check phone width (390px) too.
- **Server or auth changes:** exercise the routes against a test relay. Use `SERVER_PORT=8797 MONGODB_URI=<throwaway> MONGODB_DB=<name>_test COLLECTORS=off SMTP_PASS= node server/index.ts`; with `SMTP_PASS` empty, emails and magic links print to the log. Use `mongodb-memory-server` for the throwaway database when Atlas isn't reachable.
- **Dummy mode:** dummy mode must still open with no login and run the scripted demo (flask button → Dummy mode → Test & Eval chat → carousel → pay → order confirmed).
- **Editor:** if the user sees red underlines that `tsc -b` doesn't, the editor may be running another TypeScript version, such as the TS 7 native preview (`typescript.experimental.useTsgo`). Reproduce with that binary before changing code.

## Map (verify against the code; update this section when it drifts)

```
browser (React, src/)
  ├─ src/app/api/meta.ts       every Meta call (metaFetch / graphFetch / parse); 401 → helo:unauthorized
  ├─ src/app/api/store.ts      /api/store/* and /api/analytics/* (MongoDB-backed)
  ├─ src/app/api/dummy*.ts     dummy mode: answers everything in the browser, no server
  └─ src/app/auth/*            AuthContext (me), login / sign-up / verify / in-app setup screens
        │  /api/*  (Vite proxies to :8787)
server/ (node:http, Node runs TS natively)
  ├─ index.ts      routing + gate: /api/health public; auth routes; everything else needs a
  │                signed-in, set-up workspace member and runs in withWorkspace(id)
  ├─ auth.ts       users, workspaces, memberships, magic_links, sessions; scrypt; sha256 tokens
  ├─ mail.ts       Gmail SMTP (SMTP_USER/SMTP_PASS) or log fallback; email templates
  ├─ upstream.ts   callUpstream → Meta (api.facebook.com for agent calls, Graph for WABA lists);
  │                fills PHONE_NUMBER_ID / WABA_ID / BUSINESS_ID from .env; logs api_calls
  ├─ record.ts     write-through recording of relayed traffic (audit_log, test_conversations, …)
  ├─ mirror.ts     per-kind copies of the agent config on Meta (faqs, skills, …), soft-deleted
  ├─ store.ts      /api/store/* and /api/analytics/* handlers; HttpError / send / readJson helpers
  ├─ collectors.ts background jobs (COLLECTORS=off disables), per workspace
  ├─ cache.ts      in-memory TTL cache + allow() rate limiter
  └─ db.ts         MongoDB connect, collections + indexes + TTLs, ws()/withWorkspace (AsyncLocalStorage)
api/shopify-mcp.ts  Vercel function: Meta MCP connector → Shopify UCP MCP bridge
scripts/check-tailwind.mjs  Tailwind checker behind npm run lint:tw
```

**Invariants (breaking one is a bug):**
- All Meta calls go through `src/app/api/meta.ts`. Client paths use the placeholders `PHONE_NUMBER_ID` / `WABA_ID`, never real IDs.
- Meta is the source of truth: per-row actions call Meta first, then update local state. New list types carry a `metaId`.
- Keep the Demo-controls failure hooks (`consumeForcedFailure()`) in front of real calls.
- Every stored document is scoped by `workspaceId` via `ws()`. Never use a constant workspace.
- Never store secrets: connector keys and client secrets are blanked (`stripSecrets`); tokens and session ids are stored only as hashes.
- Magic links only verify an email. Setup happens in the app, and an unfinished account can only finish setup.
- Meta quirks:
  - Agent endpoints live on `api.facebook.com`, not Graph.
  - Paths mix `agent_config/...` and `agent-ui-skills`.
  - Thread control uses `X-API-Version: 1.0.0`.
  - Settings GET returns a one-item list.
  - Some fields are JSON-encoded strings.

**Reusable helpers (look here before writing new ones):**
- `parse`, `metaFetch`, `graphFetch`, `q`, `errorText` in `meta.ts`
- `HttpError`, `send`, `readJson`, `stripSecrets` in `store.ts`
- `allow` in `cache.ts`
- `ws`, `withWorkspace`, `col` in `db.ts`
- UI primitives in `src/app/components/ui/`
- `DemoControlsGroup` and `useRegisterDevControls` for demo controls
- `WA` palette in `whatsappTheme.ts`
- `Field`, `FormError`, `AuthLayout` in `src/app/auth/AuthLayout.tsx`

## §A Explain the architecture

1. **Read, don't recall.** Re-derive from the current code: `ls` the folders and read `server/index.ts` (routing and gate), `db.ts` (collections), `upstream.ts`, `src/app/App.tsx` (screen flow) and `src/app/api/meta.ts`. Use the Map above as a checklist, not as truth.
2. **Fit the depth to the question.** "Explain the architecture" gets the overview. "How does X work" gets one flow traced end to end, with file:line references.
3. **Output for the overview:**
   - one short paragraph on what the system is;
   - a request-flow diagram (ASCII);
   - the layers, with one line each and their files;
   - the data model (collections, keys, retention);
   - auth and workspace scoping;
   - external dependencies (Meta, Atlas, Gmail SMTP, Shopify bridge);
   - the invariants;
   - known gaps.

   Use plain words for a non-specialist reader, and link files as `[file.ts:42](path#L42)`.
4. If the code disagrees with this skill's Map, say so and update the Map (it's part of the job).

## §B Code hygiene check (report first, fix only on request)

Run the gates, then sweep. For each finding: severity (**bug** / **risk** / **hygiene**), file:line, what's wrong, the fix.

1. **Gates:** build, lint, `lint:tw`, unit test. Any failure is a finding.
2. **Invariants** from the Map:
   - `grep` for `fetch(` outside `src/app/api/` and `src/app/auth/api.ts`;
   - real phone/WABA IDs in `src/` (`grep -rnE '1005639|1067690' src`);
   - constant workspaces (`grep -rnE "workspaceId: *'default'|meta: \{ workspaceId: *'" server src`, ignoring `db.ts` and `auth.ts`);
   - routes that skip the auth gate.
3. **Secrets and safety:**
   - tokens, passwords or URIs in tracked files (`git grep -nE 'EAA[A-Za-z0-9]{20,}|mongodb\+srv://[^ ]*@|SMTP_PASS *='`);
   - `console.log` of request bodies or headers;
   - unvalidated input at trust boundaries (server handlers);
   - missing rate limits on auth and email routes.
4. **Dead and duplicate code:**
   - unused exports, found with `grep -rn "\bname\b" src server` per export and a zero-reference check;
   - unused files and components;
   - copy-pasted blocks that should call an existing helper;
   - stale comments that describe old behaviour.
5. **Correctness smells:**
   - un-awaited promises that should be awaited, and `.catch(() => {})` hiding real errors;
   - effects missing cleanup or with stale dependencies;
   - state updates after unmount;
   - missing React `key`s;
   - unhandled 401/429/5xx paths.
6. **Consistency:**
   - files that break the file style;
   - Tailwind arbitrary values with scale equivalents (`lint:tw` catches them);
   - copy that isn't sentence case, or button labels that don't say exactly what happens.
7. **Dependencies:** `npm audit`. Note what's new versus pre-existing, and what is direct versus transitive.
8. **Size and complexity:** files over ~800 lines or functions over ~80 lines. These are candidates for §D, not automatic changes.

Report as a table sorted by severity, then a short "recommended next steps". Don't fix anything until the user picks.

## §C Code clean-up

Scope is no behaviour change: dead code, unused exports and files, stale comments, leftover debug logs, needless exports (lint: `only-export-components`), arbitrary Tailwind values, inconsistent naming within a file.

1. List candidates with evidence. For deletion, show zero references, including dynamic uses: string paths, `import()`, route tables and JSX.
2. Make one kind of change per pass, so the diff is reviewable.
3. Move helpers out of component files into a `.ts` file next to them (or an existing one like `mockData.ts` / `validation.ts`) rather than silencing lint. Allow a name in `.oxlintrc.json` only for context hooks.
4. Run the gates. For UI files, compare screenshots before and after.
5. Report every change (file → what → why), plus anything you left alone and why.

## §D Refactoring (behaviour-preserving)

1. **State the goal and the invariant:** what gets simpler, and what must stay identical (API shapes, UI, stored data shapes, emails).
2. **Pin the behaviour first.** Use the existing tests, a quick scripted check of the affected routes or screens, or screenshots. If none exist, write the smallest check that would fail if behaviour changed.
3. **Move in small steps,** keeping it building after each one: extract, then switch callers, then delete the old code. Update every caller found in step 0 (grep). Prefer reference-aware rename tools when available.
4. Keep public surfaces stable unless asked: exported function names, route paths, response fields, storage keys and collection names. If a stored shape changes, plan the migration of existing documents.
5. Run the gates and the pinned check, plus screenshots for UI. The diff should read as a refactor, with no stray behaviour edits.

## §E Find and fix bugs

1. **Reproduce first.** Get the exact symptom (message, screen, request) and reproduce it: the failing route with `curl` against a test relay, the screen in Playwright, or the logs (`api_calls` / `audit_log` in MongoDB, relay output). No reproduction means no fix; ask for details.
2. **Find the root cause.** Trace the flow and name the exact line and why it's wrong. Check whether sibling callers share the bug.
3. **Fix it once,** in the shared place, with the smallest change. Don't widen scope; list unrelated problems separately.
4. **Leave a check behind,** the smallest one that fails without the fix: an assertion in `server/record.test.ts` (or a new `*.test.ts` run with `node --test`), or a scripted route or UI check.
5. **Verify:** run the reproduction again (now passing), the new check, and the gates.
6. **Report:**
   - symptom → root cause (file:line) → fix → how it was verified;
   - anything affected that the user should know, such as data written while the bug existed.

## Reporting (all jobs)

- Lead with the outcome in one or two sentences.
- Then the details the job calls for: findings table, change list, or architecture write-up.
- Then the verification run and its results.
- Then open items or decisions for the user.
- Use plain language and link files.
- Say what wasn't done and why. Don't pad.
