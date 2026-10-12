// Replays the AI-facing eval cases (tests/evals/cases/*.json) and judges each one.
//
//   node tests/evals/run.ts                   Dummy mode: the console's own logic and Dummy mode's
//                                             in-browser Meta (src/app/api/dummyMeta.ts), no network.
//   node tests/evals/run.ts --target=upstream The real API server against a fake Meta (tests/e2e
//                                             harness, throwaway database): what the relay and the
//                                             recorder do with each recorded Meta answer.
//   --feature=<skills|rich_replies|tools|websites|test_chat>  only one feature.
//
// A case: { id, feature, what, input, expect: [{ path, equals|includes|regex|notRegex|length|max }],
// targets?, known? }. `known` names a QA report finding: that case is expected to fail until it's
// fixed (reported as KNOWN, or FIXED once it passes). Exit 1 on any other failure. Never calls Meta.
import { registerHooks } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

// The browser code imports without extensions and with the "@/" alias (Vite resolves both).
const SRC = path.resolve(import.meta.dirname, '../../src')
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) spec = path.join(SRC, spec.slice(2))
    try {
      return next(spec, ctx)
    } catch (err) {
      if (/^(\.|\/)/.test(spec) && !/\.[a-z]+$/.test(spec)) return next(spec + '.ts', ctx)
      throw err
    }
  },
})

type Obj = Record<string, any>
interface Judge {
  path: string
  equals?: unknown
  includes?: unknown
  regex?: string
  notRegex?: string
  length?: number
  max?: number
}
interface Case {
  id: string
  feature: string
  what: string
  input: Obj
  expect: Judge[]
  targets?: ('dummy' | 'upstream')[]
  known?: string
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const target: 'dummy' | 'upstream' = args.target === 'upstream' ? 'upstream' : 'dummy'
const dir = path.join(import.meta.dirname, 'cases')
const cases: Case[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Case[])
  .filter((c) => (!args.feature || c.feature === args.feature) && (c.targets ?? ['dummy', 'upstream']).includes(target))

const at = (o: unknown, p: string): unknown => p.split('.').reduce<unknown>((v, k) => (v == null ? undefined : (v as Obj)[k]), o)
function judge(out: unknown, j: Judge): string | null {
  const v = at(out, j.path)
  const show = (x: unknown) => JSON.stringify(x)?.slice(0, 160)
  if ('equals' in j && !isDeepStrictEqual(v, j.equals)) return `${j.path} = ${show(v)}, expected ${show(j.equals)}`
  if ('includes' in j && !(Array.isArray(v) ? v.some((x) => isDeepStrictEqual(x, j.includes)) : String(v).includes(String(j.includes)))) return `${j.path} = ${show(v)}, expected to include ${show(j.includes)}`
  if (j.regex && !new RegExp(j.regex, 'u').test(String(v))) return `${j.path} = ${show(v)}, expected /${j.regex}/`
  if (j.notRegex && new RegExp(j.notRegex, 'u').test(String(v))) return `${j.path} = ${show(v)}, expected not /${j.notRegex}/`
  if (j.length !== undefined && (v as unknown[] | undefined)?.length !== j.length) return `${j.path} has length ${(v as unknown[] | undefined)?.length}, expected ${j.length}`
  if (j.max !== undefined && !(Number(v) <= j.max)) return `${j.path} = ${show(v)}, expected at most ${j.max}`
  return null
}

// ---- what each feature produces for one case ----
const { skillTitle, titleTaken } = await import('../../src/app/wizard/skillTitle.ts')
const rr = await import('../../src/app/wizard/richReplies.ts')
const { readToolRun } = await import('../../src/app/wizard/toolRun.ts')
const { toolCallsSince, isMetaFallback } = await import('../../src/app/wizard/testTools.ts')
const { splitToolName } = await import('../../src/app/wizard/toolRequest.ts')
const sites = await import('../../src/app/wizard/websites.ts')

const pure: Record<string, (i: Obj) => unknown> = {
  skills: (i) => {
    const title = skillTitle(i.name)
    return { title, titleLength: title.length, taken: titleTaken(i.name, i.others ?? []) }
  },
  rich_replies: (i) => {
    if ('mapsLink' in i) {
      try {
        return { coords: rr.coordsFromMapsLink(i.mapsLink), threw: false }
      } catch {
        return { coords: null, threw: true }
      }
    }
    const issues = rr.validateRichReply(i as never)
    return { issues, fields: issues.map((x) => x.field), messages: issues.map((x) => x.message).join(' | '), sentence: rr.compileRichReplySentence(i as never) }
  },
  tools: (i) => {
    if (i.kind === 'run') return readToolRun(i.metaStatus, i.output)
    if (i.kind === 'turns') return { calls: toolCallsSince(i.turns, i.since) }
    return splitToolName(i.name)
  },
  websites: (i) => {
    if (i.kind === 'view') return sites.siteView(i.site)
    if (i.kind === 'status') return { status: sites.crawlStatus(i.status, i.error) }
    return { covered: sites.coveredBy(i.url, i.sites)?.url ?? null }
  },
}

// ---- the test chat: Dummy mode's in-browser Meta, or the relay against a fake Meta ----
async function dummyChat(): Promise<(i: Obj) => Promise<unknown>> {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  })
  // dummyAssets asks the local server for labels; with no server it falls back to placeholders.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (u: string | URL | Request, o?: RequestInit) => (String(u).startsWith('/') ? Promise.reject(new Error('no server in evals')) : realFetch(u, o))) as typeof fetch
  const { dummyMeta, PRODUCTS } = await import('../../src/app/api/dummyMeta.ts')
  return async (i) => {
    const turns: Obj[] = []
    let order = ''
    for (const [n, t] of (i.turns as Obj[]).entries()) {
      const msg = String(t.send).replace('{{product:0}}', PRODUCTS[0].id).replace('{{order}}', order)
      const r = await dummyMeta('POST', '/PHONE_NUMBER_ID/agent_test', { user_msg: msg, conversation_id: `eval-${i.id ?? 'x'}-${t.conversation ?? 'main'}` })
      const j = (r.json ?? {}) as Obj
      const rich = j.dummy_rich as Obj | undefined
      if (rich?.order) order = rich.order.id
      turns[n] = { status: r.status, agent_response: j.agent_response, quick_replies: j.quick_replies ?? [], rich: rich?.kind ?? null, cards: rich?.cards?.length, fallback: isMetaFallback(String(j.agent_response ?? '')), ...(t.classify && { classified: isMetaFallback(t.classify) }) }
    }
    return { turns }
  }
}

async function upstreamChat() {
  const { startStack } = await import('../e2e/harness.ts')
  const s = await startStack('evals')
  const w = await s.seed.workspace()
  const run = async (i: Obj) => {
    const turns: Obj[] = []
    let conversationId: string | null = null
    for (const [n, t] of (i.turns as Obj[]).entries()) {
      const off = s.fake.on('POST', /\/agent_test$/, () => t.meta)
      const before = s.fake.find('POST', /\/agent_test$/).length
      const r = await s.api(w.admin, 'POST', '/api/meta/PHONE_NUMBER_ID/agent_test', { user_msg: t.send, ...(conversationId && { conversation_id: conversationId }) })
      off()
      const calls = s.fake.find('POST', /\/agent_test$/)
      conversationId = (r.json?.conversation_id as string | undefined) ?? conversationId
      turns[n] = {
        status: r.status,
        title: r.json?.title,
        agent_response: r.json?.agent_response,
        quick_replies: r.json?.quick_replies ?? [],
        metaVersion: calls.at(-1)?.headers['x-api-version'],
        metaCalls: calls.length - before,
        fallback: isMetaFallback(String(r.json?.agent_response ?? '')),
        ...(t.classify && { classified: isMetaFallback(t.classify) }),
      }
    }
    // The relay records test chats after answering: give it a moment.
    let recorded: unknown = null
    if (conversationId) {
      const id = conversationId
      recorded = await s.until(async () => (await s.db.collection('test_conversations').findOne({ conversationId: id }))?.messages ?? null, 5000).catch(() => null)
    }
    return { turns, recorded }
  }
  return { run, stop: () => s.stop() }
}

// ---- run ----
let chat: ((i: Obj) => Promise<unknown>) | null = null
let stop: (() => Promise<void>) | null = null
if (cases.some((c) => c.feature === 'test_chat')) {
  if (target === 'upstream') {
    const u = await upstreamChat()
    chat = u.run
    stop = u.stop
  } else chat = await dummyChat()
}

const tally = { PASS: 0, FAIL: 0, KNOWN: 0, FIXED: 0 }
try {
  for (const c of cases) {
    let problems: string[]
    try {
      const out = c.feature === 'test_chat' ? await chat!({ id: c.id, ...c.input }) : pure[c.feature](c.input)
      problems = c.expect.map((j) => judge(out, j)).filter((x): x is string => !!x)
    } catch (err) {
      problems = [`threw ${err instanceof Error ? err.message : String(err)}`]
    }
    const verdict = problems.length ? (c.known ? 'KNOWN' : 'FAIL') : c.known ? 'FIXED' : 'PASS'
    tally[verdict]++
    console.log(`${verdict.padEnd(5)} ${c.feature.padEnd(12)} ${c.id}${c.known ? ` (${c.known})` : ''}${problems.length ? `\n        ${c.what}\n        - ${problems.join('\n        - ')}` : ''}`)
  }
} finally {
  await stop?.()
}
console.log(`\n${target}: ${cases.length} cases · ${tally.PASS} pass · ${tally.FAIL} fail · ${tally.KNOWN} known (QA report) · ${tally.FIXED} fixed since reported`)
process.exitCode = tally.FAIL ? 1 : 0
// Dummy mode's demo timers and the database client shouldn't hold the process open.
setTimeout(() => process.exit(), 100).unref()
