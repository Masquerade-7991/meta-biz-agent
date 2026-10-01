// The in-browser Meta used in dummy mode (see dummy.ts). Answers every path meta.ts calls, in the
// same shapes, from a small store kept in this browser. The real number and WABA from .env (read
// from the local server's /api/health, which never calls Meta) are used so the demo looks real.
import { storageKey } from './dummy'

export interface Product {
  id: string
  name: string
  description: string
  price: number
  image: string
}
export interface Order {
  id: string
  product: Product
  quantity: number
  subtotal: number
  delivery: number
  total: number
}
/** Rich parts of a scripted reply. Dummy only: Meta's agent_test returns text and quick replies. */
export type DummyRich =
  | { kind: 'carousel'; cards: Product[] }
  | { kind: 'order_details'; order: Order }
  | { kind: 'order_confirmed'; order: Order; paymentRef: string; eta: string }

/** Tokens the dummy chat sends for taps; the chat shows a label, never the token. */
export const BUY = '__buy:'
export const PAID = '__paid:'

const tile = (bg: string, fg: string, glyph: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240' viewBox='0 0 400 240'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${bg}'/><stop offset='1' stop-color='${fg}'/></linearGradient></defs><rect width='400' height='240' fill='url(#g)'/><g fill='none' stroke='#fff' stroke-width='10' stroke-linecap='round' stroke-linejoin='round' opacity='0.92'>${glyph}</g></svg>`,
  )}`

// Helo.ai's products, priced as demo monthly plans (not real pricing).
export const PRODUCTS: Product[] = [
  {
    id: 'voice',
    name: 'Helo Voice',
    description: 'AI voicebots that answer calls, resolve queries and speak 12 Indian languages',
    price: 14999,
    image: tile('#0f766e', '#5eead4', `<rect x='175' y='50' width='50' height='90' rx='25'/><path d='M150 115a50 50 0 0 0 100 0M200 165v25M175 190h50'/>`),
  },
  {
    id: 'messaging',
    name: 'Helo Messaging',
    description: 'WhatsApp, RCS, SMS and Email from one platform, with rich media and buttons',
    price: 4999,
    image: tile('#1e3a8a', '#93c5fd', `<path d='M120 60h160a20 20 0 0 1 20 20v70a20 20 0 0 1-20 20h-90l-40 30v-30h-30a20 20 0 0 1-20-20V80a20 20 0 0 1 20-20z'/><path d='M150 105h100M150 130h60'/>`),
  },
  {
    id: 'clarity',
    name: 'Helo Clarity',
    description: 'Track every campaign from send to conversion, with real-time reports',
    price: 7999,
    image: tile('#6d28d9', '#c4b5fd', `<path d='M130 190h150M150 190v-50M190 190v-90M230 190v-120M270 190v-70'/>`),
  },
  {
    id: 'convo',
    name: 'Helo Convo',
    description: 'No-code AI agents for WhatsApp, web and app that end in a resolution',
    price: 9999,
    image: tile('#9a3412', '#fdba74', `<rect x='140' y='75' width='120' height='95' rx='22'/><path d='M200 75V50'/><circle cx='200' cy='45' r='6'/><circle cx='175' cy='115' r='7'/><circle cx='225' cy='115' r='7'/><path d='M180 145h40'/>`),
  },
  {
    id: 'touchpoints',
    name: 'Helo Touchpoints',
    description: 'Connect every customer touchpoint into one journey across channels',
    price: 5999,
    image: tile('#be185d', '#f9a8d4', `<circle cx='200' cy='120' r='18'/><circle cx='130' cy='70' r='14'/><circle cx='275' cy='75' r='14'/><circle cx='135' cy='180' r='14'/><circle cx='270' cy='175' r='14'/><path d='M185 108l-43-28M215 108l47-25M186 132l-40 38M214 132l44 33'/>`),
  },
]

export const rupees = (n: number) => '₹' + n.toLocaleString('en-IN')

// ---- Assets: the real .env labels when the local server is up, placeholders otherwise ----
interface Assets {
  businessId: string
  businessName: string
  wabaId: string
  wabaName: string
  phoneNumberId: string
  phoneNumber: string
  phoneName: string
}
let assets: Promise<Assets> | null = null
export function dummyAssets(): Promise<Assets> {
  assets ??= fetch('/api/health')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((h: Partial<Assets> | null) => ({
      businessId: 'BUSINESS_ID',
      businessName: h?.businessName || 'Helo Demo Store',
      wabaId: h?.wabaId || '106769052057950',
      wabaName: h?.wabaName || h?.businessName || 'Helo Demo Store',
      phoneNumberId: h?.phoneNumberId || '100563996021650',
      phoneNumber: h?.phoneNumber || '+91 98765 43210',
      phoneName: h?.phoneName || 'Helo Demo Store',
    }))
  return assets
}

// ---- Store (persisted so a reload mid-demo keeps the agent) ----
type Row = { id: string; [k: string]: unknown }
interface Db {
  n: number
  onboarded: string[]
  settings: Record<string, unknown>
  business_info: Record<string, unknown>
  skills: Row[]
  faq: Row[]
  allowlist: Row[]
  files: Row[]
  websites: Row[]
  ui: Row[]
  connectors: Row[]
  tools: Record<string, Row[]>
  jobs: Record<string, { polls: number; caseId: string }>
  events: Record<string, { polls: number; type: string }>
  conversations: Record<string, number>
}
const DB_KEY = storageKey('meta-agent-dummy-db')
const fresh = (): Db => ({
  n: 0,
  onboarded: [],
  settings: {
    channel: 'whatsapp',
    rollout: { enabled: false },
    ai_audience: 'ALLOWLISTED_ONLY',
  },
  business_info: {},
  skills: [],
  faq: [],
  allowlist: [],
  files: [],
  websites: [],
  ui: [],
  connectors: [],
  tools: {},
  jobs: {},
  events: {},
  conversations: {},
})
const db: Db = (() => {
  try {
    return {
      ...fresh(),
      ...(JSON.parse(localStorage.getItem(DB_KEY) ?? '{}') as Partial<Db>),
    }
  } catch {
    return fresh()
  }
})()
const save = () => {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    // storage full or blocked: the demo just won't survive a reload
  }
}
const id = (p = 'id') => `${p}_${Date.now().toString(36)}${(++db.n).toString(36)}`
const now = () => Math.floor(Date.now() / 1000)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export interface DummyReply {
  status: number
  json?: unknown
}
const ok = (json?: unknown, status = 200): DummyReply => ({ status, json })
const notFound = (detail: string): DummyReply => ({
  status: 404,
  json: { title: 'Not found', detail },
})
const bad = (detail: string): DummyReply => ({
  status: 400,
  json: { title: 'Bad request', detail },
})

// ---- The scripted test conversation ----
async function agentTest(body: Record<string, unknown>): Promise<DummyReply> {
  const msg = String(body.user_msg ?? '').trim()
  if (!msg) return bad('user_msg is required')
  const conversation_id = String(body.conversation_id || id('conv'))
  const reply = (agent_response: string, extra: Record<string, unknown> = {}) => {
    save()
    return ok({
      message_id: id('wamid'),
      conversation_id,
      timestamp: now(),
      agent_response,
      ...extra,
    })
  }
  await sleep(700 + Math.random() * 700) // the agent "typing"

  if (msg.startsWith(BUY)) {
    const product = PRODUCTS.find((p) => p.id === msg.slice(BUY.length)) ?? PRODUCTS[0]
    const order: Order = {
      id: 'OD' + digits(8),
      product,
      quantity: 1,
      subtotal: product.price,
      delivery: 0,
      total: product.price,
    }
    const rich: DummyRich = { kind: 'order_details', order }
    return reply(`Great choice! Here are your order details for ${product.name} (monthly plan). Tap "Review and pay" to activate it.`, {
      dummy_rich: rich,
    })
  }
  if (msg.startsWith(PAID)) {
    const [orderId, productId] = msg.slice(PAID.length).split(':')
    const product = PRODUCTS.find((p) => p.id === productId) ?? PRODUCTS[0]
    const order: Order = {
      id: orderId,
      product,
      quantity: 1,
      subtotal: product.price,
      delivery: 0,
      total: product.price,
    }
    const eta = new Date(Date.now() + 86_400_000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    const rich: DummyRich = {
      kind: 'order_confirmed',
      order,
      paymentRef: 'pay_' + digits(12),
      eta,
    }
    return reply(`Payment received, thank you! 🎉 ${product.name} will be live on your account by ${eta}. Your account manager will reach out to help you get started.`, {
      dummy_rich: rich,
      quick_replies: ['Talk to my account manager'],
    })
  }

  const step = db.conversations[conversation_id] ?? 0
  db.conversations[conversation_id] = step + 1
  const { businessName } = await dummyAssets()
  if (step === 0) {
    const desc = String(db.business_info.business_description ?? '').trim()
    return reply(
      desc
        ? `Hi! 👋 Here's a quick intro to ${businessName}:\n\n${desc}`
        : `Hi! 👋 ${businessName} builds Helo.ai, an AI-first customer communication platform. With 25 years in enterprise communication, we help banks, insurers, fintechs and retailers engage customers on WhatsApp, RCS, SMS, Email and Voice, faster and smarter.`,
      { quick_replies: ['What products do you have?'] },
    )
  }
  if (step === 1) {
    const rich: DummyRich = { kind: 'carousel', cards: PRODUCTS }
    return reply('Here are our products. Swipe to see all five, and tap "Buy now" to start a monthly plan.', { dummy_rich: rich })
  }
  return reply("Happy to help with that! Is there anything else you'd like to know about our products or your plan?")
}

// ---- Router: same paths and shapes as the Business Agent API and Graph ----
export async function dummyMeta(method: string, fullPath: string, body: Record<string, unknown> = {}, form?: FormData): Promise<DummyReply> {
  const url = new URL(fullPath, 'http://dummy')
  const path = url.pathname
  const qp = (k: string) => url.searchParams.get(k)
  const a = await dummyAssets()
  if (!path.endsWith('/agent_test')) await sleep(250 + Math.random() * 450)

  if (/\/thread_control$/.test(path)) return ok({ messaging_product: 'whatsapp' })
  if (/^\/[^/]+$/.test(path)) return ok({ id: a.wabaId, name: a.wabaName }) // one WABA by id

  const g = path.match(/^\/([^/]+)\/phone_numbers$/)
  if (g) {
    if (g[1] !== a.wabaId && g[1] !== 'WABA_ID') return notFound('Unknown WABA ' + g[1])
    return ok({
      data: [
        {
          id: a.phoneNumberId,
          display_phone_number: a.phoneNumber,
          verified_name: a.phoneName,
          quality_rating: 'GREEN',
          status: 'CONNECTED',
          platform_type: 'CLOUD_API',
        },
      ],
    })
  }

  const p = path.match(/^\/([^/]+)\/(.*)$/)
  if (!p) return notFound(path)
  const phone = p[1] === 'PHONE_NUMBER_ID' ? a.phoneNumberId : p[1]
  const rest = p[2]
  const m = method
  const result = route()
  if (m !== 'GET') save()
  return result

  function route(): DummyReply | Promise<DummyReply> {
    if (rest === 'agent_eligibility') return ok({ is_eligible: true })
    if (rest === 'agent_onboarding' && m === 'POST') {
      if (db.onboarded.includes(phone)) return bad('Agent already onboarded on this number')
      db.onboarded.push(phone)
      db.settings.agent_id = id('agent')
      return ok({ agent_id: db.settings.agent_id }, 201)
    }
    if (rest === 'delete_agent' && m === 'DELETE') {
      const deleted = db.settings.agent_id ?? null
      Object.assign(db, fresh(), { n: db.n })
      return ok({ deleted_agent_id: deleted })
    }
    if (rest === 'agent_test' && m === 'POST') return agentTest(body)
    if (rest === 'agent_config/settings') {
      if (!db.onboarded.includes(phone)) return notFound('No agent on this number')
      if (m === 'PUT') Object.assign(db.settings, body)
      return ok(db.settings)
    }
    if (rest === 'agent_config/business_info') {
      if (m === 'PUT') db.business_info = body
      return ok(db.business_info)
    }

    // Files
    if (rest === 'agent_config/files' && m === 'POST') {
      const name = String(form?.get('file_name') ?? '')
      if (!name) return bad('file_name and file are required')
      if (db.files.some((f) => f.file_name === name))
        return {
          status: 409,
          json: { title: 'Conflict', detail: 'name taken' },
        }
      const row = { id: id('file'), file_name: name }
      db.files.push(row)
      return ok(row, 201)
    }
    if (rest === 'agent_config/files') return ok(db.files)
    const fm = rest.match(/^agent_config\/files\/(.+)$/)
    if (fm) {
      const i = db.files.findIndex((x) => x.id === fm[1])
      if (i < 0) return notFound(fm[1])
      if (m === 'DELETE') return ok(void db.files.splice(i, 1), 204)
      return ok(db.files[i])
    }

    // Websites: a crawl advances pending → in progress → completed over successive reads
    if (rest === 'agent_config/websites' && m === 'POST') {
      const row: Row = {
        id: id('site'),
        url: body.url,
        crawl_status: 'not_started',
        pages_crawled: 0,
        created_at: now(),
        _reads: 0,
      }
      db.websites.push(row)
      return ok(pub(row), 201)
    }
    if (rest === 'agent_config/websites') return ok(db.websites.map(pub))
    const ws = rest.match(/^agent_config\/websites\/(.+)$/)
    if (ws) {
      const w = db.websites.find((x) => x.id === ws[1])
      if (!w) return notFound(ws[1])
      if (m === 'DELETE') return ok(void db.websites.splice(db.websites.indexOf(w), 1), 204)
      if (m === 'PUT') Object.assign(w, { url: body.url, crawl_status: 'pending', _reads: 0 })
      else crawl(w)
      save()
      return ok(pub(w))
    }

    // UI skills (rich replies)
    if (rest === 'agent-ui-skills' && m === 'GET') return ok({ data: db.ui })
    if (rest === 'agent-ui-skills' && m === 'POST') {
      const row = {
        id: id('ui'),
        ...body,
        created_at: now(),
        updated_at: now(),
      }
      db.ui.push(row)
      return ok(row, 201)
    }
    const ui = rest.match(/^agent-ui-skills\/(.+)$/)
    if (ui) {
      const r = db.ui.find((x) => x.id === ui[1])
      if (!r) return notFound(ui[1])
      if (m === 'DELETE') return ok(void db.ui.splice(db.ui.indexOf(r), 1), 204)
      return ok(Object.assign(r, body, { updated_at: now() }))
    }

    // Connectors and tools
    if (rest === 'agent_connectors' && m === 'GET') return ok(db.connectors)
    if (rest === 'agent_connectors' && m === 'POST') {
      if (db.connectors.some((c) => c.name === body.name))
        return {
          status: 409,
          json: { title: 'Conflict', detail: 'name exists' },
        }
      const row: Row = {
        id: id('conn'),
        ...body,
        connection_status: { status: 'ACTIVE' },
        mcp_tool_sync: body.connector_protocol === 'MCP' ? { status: 'PENDING', tool_count: 0 } : null,
      }
      db.connectors.push(row)
      db.tools[row.id] = []
      return ok(row, 201)
    }
    const cm = rest.match(/^agent_connectors\/([^/]+)(?:\/(.*))?$/)
    if (cm) {
      const c = db.connectors.find((x) => x.id === cm[1])
      if (!c) return notFound(cm[1])
      const sub = cm[2]
      const tools = (db.tools[c.id] ??= [])
      if (!sub) {
        if (m === 'DELETE') {
          db.connectors.splice(db.connectors.indexOf(c), 1)
          delete db.tools[c.id]
          return ok(undefined, 204)
        }
        if (m === 'PUT') Object.assign(c, body, { connector_protocol: c.connector_protocol })
        return ok(c)
      }
      if (sub === 'upsertApiKey' || sub === 'upsertOAuth') return ok(Object.assign(c, { connection_status: { status: 'ACTIVE' } }))
      if (sub === 'refreshMCPTools') {
        db.tools[c.id] = [
          {
            id: id('tool'),
            name: 'search_catalog',
            description: 'Search products',
            request_definition: {
              method: 'GET',
              path: '/search',
              query_parameters: { q: { type: 'string', required: true } },
            },
          },
        ]
        return ok(
          Object.assign(c, {
            mcp_tool_sync: { status: 'READY', tool_count: 1 },
          }),
        )
      }
      if (sub === 'logs') {
        if (qp('summary_only') === 'true') return ok({ data: [] })
        return ok({
          data: [],
          stats: {
            start_count: 42,
            success_count: 41,
            exception_count: 1,
            success_rate: 0.98,
            avg_latency_s: 0.38,
            p95_latency_s: 0.9,
            p99_latency_s: 1.2,
            time_window_seconds: 604800,
          },
        })
      }
      if (sub === 'tools' && m === 'POST') {
        const row = { id: id('tool'), ...body }
        tools.push(row)
        return ok(row, 201)
      }
      if (sub === 'tools') return ok(tools)
      const tm = sub.match(/^tools\/([^/]+)(\/run)?$/)
      if (tm) {
        const t = tools.find((x) => x.id === tm[1])
        if (!t) return notFound(tm[1])
        if (tm[2])
          return ok({
            status: 'success',
            output: JSON.stringify({ tool: t.name, ok: true }),
          })
        if (m === 'DELETE') return ok(void tools.splice(tools.indexOf(t), 1), 204)
        return ok(Object.assign(t, body))
      }
    }

    // Eval: a run moves through the three stages over successive polls
    if (rest === 'agent-eval/cases')
      return ok({
        eval_cases: [
          {
            id: 'case_delivery',
            scenario: 'Customer asks how long delivery takes to their city',
            categories: ['Delivery'],
            max_turns: 4,
            success_criteria: ['Gives a time range'],
          },
          {
            id: 'case_returns',
            scenario: 'Customer wants to return earbuds bought last week',
            categories: ['Returns'],
            max_turns: 4,
            success_criteria: ['Explains the 7-day policy'],
          },
        ],
      })
    if (rest === 'agent-eval/run' && m === 'POST') {
      const job = id('job')
      db.jobs[job] = {
        polls: 0,
        caseId: qp('eval_case_ids') ?? 'case_delivery',
      }
      return ok({ job_id: job, status: 'QUEUED' })
    }
    if (rest === 'agent-eval/run') {
      const job = qp('job_id') ?? ''
      const j = db.jobs[job]
      if (!j) return notFound('job')
      const polls = ++j.polls
      save()
      const stages = ['simulation', 'evaluation', 'insights']
      if (polls <= 3)
        return ok({
          status: 'RUNNING',
          progress: {
            completed: 0,
            total: 1,
            current_stage: stages[polls - 1],
          },
        })
      return ok({
        status: 'COMPLETED',
        progress: { completed: 1, total: 1, current_stage: 'done' },
        result: {
          summary_id: id('sum'),
          avg_conversation_score: 4.4,
          avg_turn_score: 4.6,
          summary: 'Accurate, friendly answers that stay on topic.',
          highlights: JSON.stringify(['Clear delivery window', 'Offered next steps']),
          top_failure_categories: JSON.stringify([]),
          eval_ids_by_score: JSON.stringify({ '5': [`eval_${j.caseId}`] }),
          creation_time: now(),
          update_time: now(),
        },
      })
    }
    if (rest === 'agent-eval/details')
      return ok({
        evaluations: (qp('eval_ids') ?? '')
          .split(',')
          .filter(Boolean)
          .map((evalId) => ({
            id: evalId,
            eval_case_id: evalId.replace(/^eval_/, ''),
            score: 5,
            per_turn_labels: '[1,1]',
            reasons: JSON.stringify([
              {
                category: 'Answer quality',
                score: 5,
                description: 'Correct and complete',
                recommended_actions: [],
              },
            ]),
            transcript: JSON.stringify({
              transcript_turns: [
                {
                  role: 'user',
                  content: 'How long will delivery take to Pune?',
                },
                {
                  role: 'assistant',
                  content: 'Orders to Pune usually arrive within 2–3 days, and delivery is free.',
                },
              ],
            }),
            creation_time: now(),
            update_time: now(),
          })),
      })

    // Agent events: request_received → processing → sent → success over polls
    if (rest === 'agent_event' && m === 'POST') {
      const eid = id('evt')
      db.events[eid] = {
        polls: 0,
        type: String((body.event as { type?: string } | undefined)?.type ?? 'event'),
      }
      return ok({ status: 'accepted', agent_event_id: eid })
    }
    const ev = rest.match(/^agent_event\/(.+)$/)
    if (ev) {
      const e = db.events[ev[1]]
      if (!e) return notFound(ev[1])
      e.polls++
      save()
      const status = e.polls < 2 ? 'processing' : e.polls < 3 ? 'sent' : 'success'
      return ok({
        status,
        event_type: e.type,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }

    // Insights: steady, believable numbers
    if (rest === 'insights/conversations/turns') return ok({ data: [] })
    if (rest === 'insights/conversations') {
      const sd = qp('start_date') ?? isoDay(new Date())
      const ed = qp('end_date') ?? sd
      const days = Math.max(1, Math.round((Date.parse(ed) - Date.parse(sd)) / 86_400_000) + 1)
      const perDay = (d: string) => 18 + ([...d].reduce((s, c) => s + c.charCodeAt(0), 0) % 23)
      const threads = days === 1 ? perDay(sd) : days * 26
      return ok({
        data: [
          {
            ai_threads: { count: threads },
            ai_handoffs: { count: Math.max(1, Math.round(threads * 0.06)) },
          },
        ],
      })
    }
    if (rest === 'insights/tool_calls') return ok({ data: [] })
    if (rest === 'insights/agent_events') return ok({ data: [], avg_e2e_latency_ms: null })

    // Plain CRUD lists
    for (const [col, base] of [
      ['skills', 'agent_config/skills'],
      ['faq', 'agent_config/faq'],
      ['allowlist', 'agent_config/allowlist'],
    ] as const) {
      const list = db[col]
      if (rest === base && m === 'GET') return ok(list)
      if (rest === base && m === 'POST') {
        const item: Row = {
          id: id(col),
          ...body,
          ...(col === 'skills' ? { status: 'active' } : {}),
        }
        list.push(item)
        return ok(item, 201)
      }
      const one = rest.match(new RegExp(`^${base}/(.+)$`))
      if (one) {
        const i = list.findIndex((x) => x.id === one[1] || x.consumer_phone_number === decodeURIComponent(one[1]))
        if (i < 0) return notFound(one[1])
        if (m === 'DELETE') return ok(void list.splice(i, 1), 204)
        return ok((list[i] = { ...list[i], ...body }))
      }
    }
    return notFound(`${m} ${rest}`)
  }
}

function crawl(w: Row) {
  const reads = ((w._reads as number) ?? 0) + 1
  w._reads = reads
  w.crawl_status = reads < 2 ? 'pending' : reads < 3 ? 'in_progress' : 'completed'
  w.pages_crawled = reads < 3 ? reads * 4 : 14
  if (w.crawl_status === 'completed') w.last_crawled_at = now()
}
const pub = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')))
