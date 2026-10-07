// AI help for people setting up the agent, and the questions the agent couldn't answer.
// - POST /api/assist/write: drafts or rewrites a piece of the agent's setup with Claude (needs
//   ANTHROPIC_API_KEY, like chat summaries in inbox.ts).
// - GET /api/assist/gaps: customer and test questions from the last week that the agent answered
//   with Meta's fallback, or handed to a person, grouped by question, so they can become FAQs.
import type http from 'node:http'
import { HttpError, type Obj, type Titles, arr, obj, readJson, serveJson, str } from './http.ts'
import { col, db, dbOffReason, ws } from './db.ts'
import { env } from './upstream.ts'
import { recordAiUsage } from './aiUsage.ts'
import type { Actor } from './inbox.ts'
import { can } from '../src/app/lib/permissions.ts'

const MODEL = 'claude-haiku-4-5-20251001'
const DAY = 86_400_000

/** Meta's canned reply when its agent can't produce an answer (src/app/wizard/testTools.ts). */
const FALLBACK = /^I had trouble responding fully/i
const HANDED_OFF = 'The agent handed this chat to a person.'

const TASKS: Record<string, { system: string; max: number }> = {
  draft_role: {
    system:
      'You write the one-paragraph description of what a business\'s WhatsApp AI agent does for customers. Plain English, 1 to 3 sentences, written as a description ("Helps customers…"), not as instructions. No preamble, no quotes.',
    max: 600,
  },
  improve: {
    system:
      'You improve a short piece of text that sets up a WhatsApp AI agent. Keep its meaning and facts, make it clearer and more specific, plain English, no jargon, about the same length. Return only the improved text, no preamble, no quotes.',
    max: 2000,
  },
  draft_skill: {
    system:
      'You write a skill instruction for a WhatsApp AI agent: when it applies and exactly what the agent should do, in 2 to 5 short plain-English sentences addressed to the agent. Never ask for or mention sensitive personal data. Return only the instruction.',
    max: 1500,
  },
}

async function write(b: Obj) {
  const task = TASKS[String(b.task)]
  if (!task) throw new HttpError(400, 'Task must be draft_role, improve or draft_skill.')
  const key = env('ANTHROPIC_API_KEY')
  if (!key) throw new HttpError(400, 'Writing help needs an Anthropic API key in the server settings (ANTHROPIC_API_KEY).')
  const text = String(b.text ?? '').trim().slice(0, 4000)
  const c = obj(b.context)
  const context = [
    str(c.agentName) && `Agent name: ${str(c.agentName)}`,
    str(c.business) && `About the business: ${str(c.business)}`,
    str(c.category) && `Business category: ${str(c.category)}`,
    str(c.goal) && `What it should cover: ${str(c.goal)}`,
  ]
    .filter(Boolean)
    .join('\n')
  if (b.task === 'improve' && !text) throw new HttpError(400, 'Write something first, then ask to improve it.')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: task.system,
      messages: [{ role: 'user', content: [context, text && `Text:\n${text}`].filter(Boolean).join('\n\n') || 'A small business that answers customers on WhatsApp.' }],
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  const json = r ? obj(await r.json().catch(() => ({}))) : {}
  recordAiUsage(`assist_${String(b.task)}`, MODEL, json.usage)
  const out = str(obj(arr(json.content)[0]).text)?.trim()
  if (!r?.ok || !out) throw new HttpError(502, 'Couldn’t write that right now. Try again.')
  return { text: out.slice(0, task.max) }
}

interface Gap {
  question: string
  /** couldn't answer (Meta's fallback) or handed to a person */
  reason: 'fallback' | 'handoff'
  source: 'customer' | 'test'
  count: number
  lastAt: Date
}

async function gaps(days: number) {
  const since = new Date(Date.now() - days * DAY)
  const found: Omit<Gap, 'count'>[] = []
  // Real chats: the customer's words before a fallback reply or a handoff (words arrive by webhook).
  const misses = await col('messages')
    .find({ workspaceId: ws(), at: { $gte: since }, $or: [{ author: 'ai', body: { $regex: FALLBACK.source, $options: 'i' } }, { kind: 'event', body: HANDED_OFF }] })
    .sort({ at: -1 })
    .limit(200)
    .toArray()
  for (const m of misses) {
    const asked = await col('messages').findOne(
      { workspaceId: ws(), phone: m.phone, author: 'customer', body: { $type: 'string', $ne: '' }, at: { $lte: m.at, $gte: new Date(+m.at - DAY) } },
      { sort: { at: -1 } },
    )
    if (asked?.body) found.push({ question: String(asked.body), reason: m.kind === 'event' ? 'handoff' : 'fallback', source: 'customer', lastAt: m.at as Date })
  }
  // Test chats (Test & Eval, Try it): the question before a fallback reply.
  for (const c of await col('test_conversations').find({ workspaceId: ws(), updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(200).toArray()) {
    const msgs = arr(c.messages).map(obj)
    msgs.forEach((m, i) => {
      if (m.from === 'agent' && FALLBACK.test(String(m.text ?? '')) && msgs[i - 1]?.from === 'user')
        found.push({ question: String(msgs[i - 1].text), reason: 'fallback', source: 'test', lastAt: new Date(String(m.at ?? c.updatedAt)) })
    })
  }
  // One row per question, however it was typed.
  const byKey = new Map<string, Gap>()
  for (const f of found) {
    const k = f.question.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
    if (!k) continue
    const g = byKey.get(k)
    if (g) {
      g.count++
      if (+f.lastAt > +g.lastAt) g.lastAt = f.lastAt
      if (f.source === 'customer') g.source = 'customer'
    } else byKey.set(k, { ...f, question: f.question.trim().slice(0, 300), count: 1 })
  }
  return [...byKey.values()].sort((a, z) => z.count - a.count || +z.lastAt - +a.lastAt).slice(0, 20)
}

async function route(req: http.IncomingMessage, u: URL): Promise<unknown> {
  if (u.pathname === '/api/assist/write' && req.method === 'POST') return write(obj(await readJson(req)))
  if (u.pathname === '/api/assist/gaps' && req.method === 'GET') {
    const days = Number(u.searchParams.get('days') ?? 7)
    if (![7, 30].includes(days)) throw new HttpError(400, 'days must be 7 or 30.')
    return gaps(days)
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 502: 'Writing help didn’t answer' }
export async function handleAssist(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!u.pathname.startsWith('/api/assist/')) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'This needs the database.' } }, () => {
    // Drafting is part of changing the agent: owners and admins (server/app.ts has the same rule).
    if (u.pathname === '/api/assist/write' && !can(me.role, 'agent.edit')) throw new HttpError(403, 'Only owners and admins change the AI agent.')
    return route(req, u)
  })
}
