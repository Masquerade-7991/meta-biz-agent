// Dummy mode for the support platform: the server's /api/inbox, /api/tickets, /api/support, /api/contacts
// and /api/broadcasts routes, answered in this browser from the sample chats.
// Changes live in memory for the session only. Replies go into the chat; nothing is sent.
import { SAMPLE_CHATS, sampleName } from '../inbox/sampleData'
import { MetaError } from './meta'
import { isBsuid, NO_CONTROL_HIDDEN } from '../lib/customer'
import type { CannedResponse, ChatDetail, ChatMessage, ChatSummary } from './inbox'
import type { Priority, SupportSettings, Ticket } from './tickets'
import type { Contact, FieldDef, Segment } from './contacts'
import type { Broadcast, BroadcastDetail, WaTemplate } from './broadcasts'
import type { WaAccount } from './whatsapp'
import { renderTemplate } from '../broadcasts/templates'

interface Chat {
  phone: string
  name: string
  tags: string[]
  owner: 'ai' | 'human'
  assigneeId: string | null
  unread: number
  messages: ChatMessage[]
}
const ME = { id: 'demo', name: 'You' }
const DAY = 86_400_000
let seq = 0
let chats: Chat[] | null = null
let canned: CannedResponse[] = [
  { id: 'c1', title: 'Refund timeline', shortcut: '/refund', body: 'Hi {{name}}, refunds reach your account in 3 to 5 working days.', shared: true },
  { id: 'c2', title: 'Book a demo', shortcut: '/demo', body: 'Happy to show you around, {{name}}. Pick a time that suits you: https://helo.ai/contact-us', shared: true },
]

function load(): Chat[] {
  if (chats) return chats
  const now = Date.now()
  chats = SAMPLE_CHATS.map((c) => ({
    phone: c.phone,
    name: sampleName(c),
    tags: c.tags,
    owner: c.owner,
    assigneeId: c.owner === 'human' && c.phone.endsWith('103') ? ME.id : null,
    unread: c.messages.at(-1)?.author === 'customer' ? 1 : 0,
    messages: c.messages.map((m) => ({
      id: `m${++seq}`,
      phone: c.phone,
      direction: m.author === 'customer' ? 'in' : 'out',
      author: m.author === 'note' ? 'agent' : m.author,
      ...(m.author === 'agent' || m.author === 'note' ? { authorId: ME.id, authorName: ME.name } : {}),
      kind: m.author === 'note' ? 'note' : 'text',
      body: m.body,
      at: new Date(now - m.ago * 60_000).toISOString(),
    })),
  }))
  return chats
}
const lastInbound = (c: Chat) => c.messages.filter((m) => m.direction === 'in').at(-1)?.at ?? null
const windowOpen = (c: Chat) => {
  const t = lastInbound(c)
  return !!t && Date.now() - Date.parse(t) < DAY
}
const summary = (c: Chat): ChatSummary => {
  const last = c.messages.filter((m) => m.kind !== 'note').at(-1)
  return {
    phone: c.phone,
    name: c.name,
    tags: c.tags,
    owner: c.owner,
    assigneeId: c.assigneeId,
    unread: c.unread,
    lastMessageAt: c.messages.at(-1)?.at ?? null,
    windowOpen: windowOpen(c),
    sample: true,
    preview: last ? { author: last.author, body: last.body } : null,
  }
}
const detail = (c: Chat): ChatDetail => ({
  conversation: { phone: c.phone, owner: c.owner, assigneeId: c.assigneeId, lastInboundAt: lastInbound(c), windowOpen: windowOpen(c), sample: true },
  contact: { phone: c.phone, name: c.name, tags: c.tags, fields: {} },
  messages: c.messages,
})
const push = (c: Chat, m: Omit<ChatMessage, 'id' | 'phone' | 'at'>) => c.messages.push({ id: `m${++seq}`, phone: c.phone, at: new Date().toISOString(), ...m })

export async function dummyInbox<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, string | null>
  const u = new URL(path, 'http://x')
  const list = load()
  const m = u.pathname.match(/^\/api\/inbox\/conversations\/([^/]+)(?:\/([a-z]+))?$/)
  if (u.pathname === '/api/inbox/conversations') {
    const f = u.searchParams.get('filter')
    const q = (u.searchParams.get('q') ?? '').toLowerCase()
    return list
      .filter((c) => (f === 'mine' ? c.assigneeId === ME.id : f === 'unassigned' ? c.owner === 'human' && !c.assigneeId : f === 'ai' ? c.owner === 'ai' : true))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .map(summary)
      .sort((a, z) => Date.parse(z.lastMessageAt ?? '0') - Date.parse(a.lastMessageAt ?? '0')) as T
  }
  if (m) {
    const c = list.find((x) => x.phone === decodeURIComponent(m[1]))
    if (!c) throw new MetaError(404, 'Not found', 'No chat with this number yet.')
    if (m[2] === 'suggest') return { text: 'Thanks for your patience! I’ve checked this for you and our team is on it. You’ll hear back within the day.' } as T
    if (m[2] === 'summary') throw new MetaError(400, 'Check the details', 'Summaries need an Anthropic API key in the server settings (ANTHROPIC_API_KEY).')
    if (m[2] === 'presence') return { ok: true } as T
    if (m[2] === 'messages') {
      if (!windowOpen(c)) throw new MetaError(400, 'Check the details', 'WhatsApp only allows free replies within 24 hours of the customer’s last message. Send a template instead.')
      push(c, { direction: 'out', author: 'agent', authorId: ME.id, authorName: ME.name, kind: 'text', body: String(b.text), status: 'sent' })
      c.owner = 'human'
      c.unread = 0
      c.assigneeId ??= ME.id
      ensureTicket(c, 'reply').firstRespondedAt ??= new Date().toISOString()
    }
    if (m[2] === 'notes') push(c, { direction: 'out', author: 'agent', authorId: ME.id, authorName: ME.name, kind: 'note', body: String(b.text) })
    if (m[2] === 'assign') c.assigneeId = b.userId ?? null
    if (m[2] === 'read') c.unread = 0
    if (m[2] === 'control') {
      if (isBsuid(c.phone)) throw new MetaError(400, 'Check the details', NO_CONTROL_HIDDEN)
      c.owner = b.action === 'take' ? 'human' : 'ai'
      if (b.action === 'take') {
        c.assigneeId ??= ME.id
        ensureTicket(c, 'takeover')
      }
      push(c, { direction: 'out', author: 'system', kind: 'event', body: b.action === 'take' ? 'You took over from the AI agent.' : 'You handed the chat back to the AI agent.' })
    }
    return detail(c) as T
  }
  if (u.pathname === '/api/inbox/canned' && method === 'GET') return canned as T
  if (u.pathname.startsWith('/api/inbox/canned')) {
    const id = u.pathname.split('/')[4]
    if (method === 'DELETE') {
      canned = canned.filter((x) => x.id !== id)
      return { ok: true } as T
    }
    const shortcut = '/' + String(b.shortcut ?? '').replace(/^\//, '').toLowerCase()
    if (canned.some((x) => x.shortcut === shortcut && x.id !== id)) throw new MetaError(409, 'Already exists', `${shortcut} is already used.`)
    const row = { id: id ?? `c${++seq}`, title: String(b.title), shortcut, body: String(b.body), shared: (body as { shared?: boolean }).shared !== false }
    canned = id ? canned.map((x) => (x.id === id ? row : x)) : [...canned, row]
    return row as T
  }
  if (u.pathname === '/api/inbox/demo/simulate') {
    const c = list.find((x) => x.phone === b.phone) ?? list[0]
    push(c, { direction: 'in', author: 'customer', kind: 'text', body: String(b.text) })
    c.unread++
    return { ok: true } as T
  }
  if (u.pathname === '/api/inbox/demo') {
    if (method === 'DELETE') chats = []
    else chats = null
    return { ok: true } as T
  }
  throw new MetaError(404, 'Not found', path)
}

// ---- tickets, support settings, assist (dummy) ----
const MIN = 60_000
let tickets: Ticket[] | null = null
let nextNumber = 1001
let settings: SupportSettings = {
  hours: {
    timezone: 'Asia/Kolkata',
    week: { sun: null, mon: { open: '09:30', close: '18:30' }, tue: { open: '09:30', close: '18:30' }, wed: { open: '09:30', close: '18:30' }, thu: { open: '09:30', close: '18:30' }, fri: { open: '09:30', close: '18:30' }, sat: { open: '10:00', close: '14:00' } },
    holidays: [],
  },
  awayMessage: 'Thanks for your message. Our team is offline right now and will reply when we’re back.',
  sla: { urgent: { firstResponse: 15, resolve: 240 }, high: { firstResponse: 30, resolve: 480 }, normal: { firstResponse: 60, resolve: 1440 }, low: { firstResponse: 240, resolve: 2880 } },
  routing: { mode: 'round_robin', teamId: null, userId: null },
  teams: [],
  csat: { enabled: true, question: 'How did we do today?' },
  aiSummary: false,
}

/** Demo SLAs count plain minutes (the server counts business hours). */
function withSla(t: Ticket): Ticket {
  const target = t.status === 'resolved' ? null : t.firstRespondedAt ? 'resolve' : 'firstResponse'
  if (!target) return { ...t, sla: { kind: 'done', at: null, breached: false } }
  const at = new Date(Date.parse(t.createdAt) + settings.sla[t.priority][target] * MIN).toISOString()
  return { ...t, sla: { kind: target, at, breached: Date.parse(at) < Date.now() } }
}
function ticketsNow(): Ticket[] {
  if (!tickets) {
    tickets = []
    for (const c of load().filter((x) => x.owner === 'human')) ensureTicket(c, 'handoff', c.tags.includes('priority') ? 'high' : 'normal')
  }
  return tickets
}
function ensureTicket(c: Chat, source: Ticket['source'], priority: Priority = 'normal'): Ticket {
  const list = tickets ?? ticketsNow()
  const open = list.find((t) => t.phone === c.phone && t.status !== 'resolved')
  if (open) return open
  const words = c.messages.filter((m) => m.author === 'customer' && m.body).at(-1)?.body ?? `Chat with +${c.phone}`
  const at = c.messages.find((m) => m.author === 'customer')?.at ?? new Date().toISOString()
  const t: Ticket = { id: `t${nextNumber}`, number: nextNumber++, phone: c.phone, name: c.name, subject: words.slice(0, 120), status: 'open', priority, assigneeId: c.assigneeId, tags: [], source, createdAt: at, updatedAt: at, firstRespondedAt: null, resolvedAt: null, resolution: null, csat: null, sla: { kind: 'firstResponse', at: null, breached: false }, sample: true }
  list.unshift(t)
  return t
}

export async function dummyTickets<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, unknown>
  const u = new URL(path, 'http://x')
  const list = ticketsNow()
  const p = (k: string) => u.searchParams.get(k) ?? ''
  if (u.pathname === '/api/tickets' && method === 'GET') {
    const q = p('q').toLowerCase()
    return list
      .filter((t) => (p('status') === 'all' ? true : p('status') ? t.status === p('status') : t.status !== 'resolved'))
      .filter((t) => (p('assignee') === 'me' ? t.assigneeId === ME.id : p('assignee') === 'none' ? !t.assigneeId : true))
      .filter((t) => !p('priority') || t.priority === p('priority'))
      .filter((t) => !p('phone') || t.phone === p('phone'))
      .filter((t) => !q || `${t.number} ${t.subject} ${t.name ?? ''} ${t.phone}`.toLowerCase().includes(q))
      .map(withSla) as T
  }
  if (u.pathname === '/api/tickets' && method === 'POST') {
    const c = load().find((x) => x.phone === b.phone)
    if (!c) throw new MetaError(404, 'Not found', 'No chat with this number yet.')
    if (list.some((t) => t.phone === c.phone && t.status !== 'resolved')) throw new MetaError(409, 'Already exists', 'This chat already has an open ticket.')
    const t = ensureTicket(c, 'manual', (b.priority as Priority) ?? 'normal')
    if (b.subject) t.subject = String(b.subject)
    return withSla(t) as T
  }
  if (u.pathname === '/api/tickets/bulk') {
    for (const n of (b.numbers as number[]) ?? []) {
      const t = list.find((x) => x.number === n)
      if (!t) continue
      if (b.action === 'resolve') Object.assign(t, { status: 'resolved', resolvedAt: new Date().toISOString() })
      else Object.assign(t, b.patch)
    }
    return { ok: true, count: ((b.numbers as number[]) ?? []).length } as T
  }
  const tm = u.pathname.match(/^\/api\/tickets\/(\d+)(\/resolve)?$/)
  if (tm) {
    const t = list.find((x) => x.number === Number(tm[1]))
    if (!t) throw new MetaError(404, 'Not found', `Ticket #${tm[1]} doesn’t exist.`)
    if (tm[2]) {
      Object.assign(t, { status: 'resolved', resolvedAt: new Date().toISOString(), resolution: String(b.resolution ?? '') || null })
      const c = load().find((x) => x.phone === t.phone)
      if (c) {
        push(c, { direction: 'out', author: 'system', kind: 'event', body: `You resolved ticket #${t.number}.` })
        if (b.askFeedback !== false && settings.csat.enabled && windowOpen(c)) push(c, { direction: 'out', author: 'system', kind: 'interactive', body: `${settings.csat.question} [Good · Okay · Bad]` })
        if (b.handBack !== false && !isBsuid(c.phone)) c.owner = 'ai'
      }
    } else if (method === 'PATCH') {
      Object.assign(t, b, { updatedAt: new Date().toISOString() })
      const c = load().find((x) => x.phone === t.phone)
      if (c && 'assigneeId' in b) c.assigneeId = (b.assigneeId as string | null) ?? null
    }
    return withSla(t) as T
  }
  if (u.pathname === '/api/support/settings') {
    if (method === 'PUT') settings = { ...(b as unknown as SupportSettings), aiSummary: false }
    return settings as T
  }
  if (u.pathname.startsWith('/api/support/notifications/')) return { ok: true } as T
  if (u.pathname === '/api/support/notifications') return [] as T
  if (u.pathname === '/api/support/analytics') {
    const days = Number(u.searchParams.get('days') ?? 7)
    const series = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10), created: (i * 7) % 5, resolved: (i * 5) % 4 }))
    return { days, timezone: settings.hours.timezone, series, created: series.reduce((n, x) => n + x.created, 0), resolved: series.reduce((n, x) => n + x.resolved, 0), open: list.filter((t) => t.status !== 'resolved').length, medianFirstReplyMin: 18, medianResolveMin: 260, slaFirstReplyMet: 0.92, slaResolveMet: 0.81, csat: { responses: 24, average: 2.6, good: 17, okay: 5, bad: 2 }, chats: { total: 140, aiOnly: 118, withTeam: 22 }, people: [{ name: ME.name, resolved: 14, open: 2, medianFirstReplyMin: 12 }], broadcasts: { sent: 320, read: 211, replied: 38 } } as T
  }
  throw new MetaError(404, 'Not found', path)
}

// ---- contacts (dummy) ----
let extraContacts: Contact[] = []
let removed = new Set<string>()
let fieldDefsDemo: FieldDef[] = [{ key: 'city', label: 'City', type: 'text' }]
let segmentsDemo: Segment[] = []
const edits = new Map<string, Partial<Contact>>()
function contactsNow(): Contact[] {
  const fromChats = load().map((c): Contact => ({ phone: c.phone, name: c.name, email: null, tags: c.tags, fields: {}, source: 'sample', createdAt: c.messages[0]?.at ?? new Date().toISOString(), lastSeenAt: lastInbound(c) ?? undefined }))
  return [...extraContacts, ...fromChats].filter((c) => !removed.has(c.phone)).map((c) => ({ ...c, ...edits.get(c.phone) }))
}
const matches = (c: Contact, f: { tags?: string[] }) => (f.tags ?? []).every((t) => c.tags.includes(t))

export async function dummyContacts<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, unknown>
  const u = new URL(path, 'http://x')
  const p = (k: string) => u.searchParams.get(k) ?? ''
  if (u.pathname === '/api/contacts' && method === 'GET') {
    const seg = segmentsDemo.find((x) => x.id === p('segment'))
    const q = p('q').toLowerCase()
    return contactsNow()
      .filter((c) => matches(c, { tags: [...(seg?.filter.tags ?? []), ...(p('tag') ? [p('tag')] : [])] }))
      .filter((c) => !q || `${c.name ?? ''} ${c.phone} ${c.email ?? ''}`.toLowerCase().includes(q)) as T
  }
  if (u.pathname === '/api/contacts' && method === 'POST') {
    const phone = String(b.phone ?? '').replace(/\D/g, '')
    if (!/^\d{8,15}$/.test(phone)) throw new MetaError(400, 'Check the details', 'That isn’t a phone number with a country code (8 to 15 digits).')
    if (contactsNow().some((c) => c.phone === phone)) throw new MetaError(409, 'Already exists', `+${phone} is already a contact.`)
    const c: Contact = { phone, name: (b.name as string) || null, email: (b.email as string) || null, tags: (b.tags as string[]) ?? [], fields: (b.fields as Record<string, string>) ?? {}, source: 'manual', createdAt: new Date().toISOString() }
    extraContacts = [c, ...extraContacts]
    removed.delete(phone)
    return c as T
  }
  if (u.pathname === '/api/contacts/import') {
    let added = 0
    for (const r of (b.rows as { phone: string; name?: string }[]) ?? []) {
      const phone = String(r.phone).replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(phone) || contactsNow().some((c) => c.phone === phone)) continue
      extraContacts.push({ phone, name: r.name ?? null, email: null, tags: [], fields: {}, source: 'import', createdAt: new Date().toISOString() })
      added++
    }
    return { added, updated: 0, skipped: [], skippedCount: 0 } as T
  }
  if (u.pathname === '/api/contacts/tags') {
    const counts = new Map<string, number>()
    for (const c of contactsNow()) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].map(([tag, count]) => ({ tag, count })) as T
  }
  if (u.pathname === '/api/contacts/fields') {
    if (method === 'PUT') fieldDefsDemo = ((b.fields as FieldDef[]) ?? []).map((f) => ({ ...f, key: f.key || f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_') }))
    return fieldDefsDemo as T
  }
  if (u.pathname === '/api/contacts/segments') {
    const withCount = (x: Segment) => ({ ...x, count: contactsNow().filter((c) => matches(c, x.filter)).length })
    if (method !== 'POST') return segmentsDemo.map(withCount) as T
    const created: Segment = { id: `s${++seq}`, name: String(b.name), filter: b.filter as Segment['filter'], count: 0 }
    segmentsDemo = [...segmentsDemo, created]
    return withCount(created) as T
  }
  const sm = u.pathname.match(/^\/api\/contacts\/segments\/(.+)$/)
  if (sm) {
    segmentsDemo = segmentsDemo.filter((s) => s.id !== sm[1])
    return { ok: true } as T
  }
  const cm = u.pathname.match(/^\/api\/contacts\/(\d+)$/)
  if (cm) {
    if (method === 'DELETE') {
      removed = new Set([...removed, cm[1]])
      return { ok: true } as T
    }
    edits.set(cm[1], { ...edits.get(cm[1]), ...(b as Partial<Contact>) })
    return contactsNow().find((c) => c.phone === cm[1]) as T
  }
  throw new MetaError(404, 'Not found', path)
}

// ---- broadcasts (dummy) ----
const demoTemplates: WaTemplate[] = [
  { id: 't1', name: 'diwali_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'HEADER', format: 'TEXT', text: 'Festive offer' }, { type: 'BODY', text: 'Hi {{1}}, get 20% off Helo Messaging this Diwali. Offer ends {{2}}.' }, { type: 'FOOTER', text: 'Reply STOP to opt out' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Tell me more' }] }] },
  { id: 't2', name: 'order_update', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi {{1}}, your order is confirmed and goes live tomorrow.' }] },
  { id: 't3', name: 'webinar_invite', language: 'en', status: 'PENDING', category: 'MARKETING', components: [{ type: 'BODY', text: 'Join our WhatsApp AI webinar this Friday.' }] },
]
let demoBroadcasts: BroadcastDetail[] = []

export async function dummyBroadcasts<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, unknown>
  const u = new URL(path, 'http://x')
  if (u.pathname === '/api/broadcasts/templates') {
    if (method === 'POST') {
      demoTemplates.push({ id: `t${++seq}`, name: String(b.name), language: String(b.language || 'en'), status: 'PENDING', category: String(b.category), components: [{ type: 'BODY', text: String(b.body) }] })
      return { id: `t${seq}`, status: 'PENDING' } as T
    }
    return demoTemplates as T
  }
  if (u.pathname.startsWith('/api/broadcasts/templates/')) return { ok: true } as T
  if (u.pathname === '/api/broadcasts/send-one') {
    const c = load().find((x) => x.phone === b.phone)
    if (c) {
      push(c, { direction: 'out', author: 'agent', authorName: ME.name, kind: 'template', body: renderTemplate(b.template as WaTemplate, b.values as Record<string, string>), status: 'sent' })
      c.owner = 'human'
    }
    return { ok: true } as T
  }
  if (u.pathname === '/api/broadcasts/preflight') {
    const seg = segmentsDemo.find((x) => x.id === b.segmentId)
    const audience = contactsNow().filter((c) => !c.optedOut && (!seg || matches(c, seg.filter)))
    const marketing = String(b.category).toUpperCase() === 'MARKETING'
    return {
      audience: audience.length,
      sample: audience.length,
      hiddenNumbers: audience.filter((c) => isBsuid(c.phone)).length,
      gotMarketingToday: marketing && demoBroadcasts.some((x) => Date.now() - Date.parse(x.createdAt) < 86_400_000) ? Math.min(2, audience.length) : 0,
      estimate: { currency: 'INR', total: audience.length * (marketing ? 0.86 : 0.13), unpriced: 0, countries: [{ country: 'IN', people: audience.length, rate: marketing ? 0.86 : 0.13 }] },
    } as T
  }
  if (u.pathname === '/api/broadcasts' && method === 'GET') return demoBroadcasts as unknown as T
  if (u.pathname === '/api/broadcasts' && method === 'POST') {
    const tpl = demoTemplates.find((x) => x.name === (b.template as { name: string }).name)!
    const seg = segmentsDemo.find((x) => x.id === b.segmentId)
    const audience = contactsNow().filter((c) => !c.optedOut && (!seg || matches(c, seg.filter)))
    const later = b.scheduledAt && Date.parse(String(b.scheduledAt)) > Date.now()
    // Like the real thing: a marketing send to 3+ people meets WhatsApp's daily marketing limit once.
    const capped = !later && tpl.category === 'MARKETING' && audience.length >= 3 ? audience.at(-1)!.phone : null
    const retryAt = new Date(Date.now() + 86_400_000).toISOString()
    const row: BroadcastDetail = {
      id: `b${++seq}`,
      name: String(b.name),
      template: { name: tpl.name, language: tpl.language },
      segmentId: seg?.id ?? null,
      segmentName: seg?.name ?? 'All contacts',
      audienceCount: audience.length,
      status: later ? 'scheduled' : capped ? 'sending' : 'completed',
      scheduledAt: String(b.scheduledAt ?? new Date().toISOString()),
      createdByName: ME.name,
      createdAt: new Date().toISOString(),
      stats: { queued: later ? audience.length : capped ? 1 : 0, sent: later ? 0 : audience.length - (capped ? 1 : 0), delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0, retrying: capped ? 1 : 0 },
      preview: renderTemplate(tpl, {}),
      failures: capped ? [{ reason: 'marketing_limit', retrying: true, count: 1, nextAt: retryAt }] : [],
      recipients: audience.map((c) =>
        c.phone === capped
          ? { phone: c.phone, name: c.name, status: 'queued', reason: 'marketing_limit', error: 'This message was not delivered to maintain healthy ecosystem engagement.', retryAt }
          : { phone: c.phone, name: c.name, status: later ? 'queued' : 'sent' },
      ),
    }
    demoBroadcasts = [row, ...demoBroadcasts]
    return row as T
  }
  const m = u.pathname.match(/^\/api\/broadcasts\/([^/]+)(\/cancel)?$/)
  if (m) {
    const row = demoBroadcasts.find((x) => x.id === m[1])
    if (!row) throw new MetaError(404, 'Not found', 'That broadcast no longer exists.')
    if (m[2]) Object.assign(row, { status: 'cancelled', stats: { ...row.stats, skipped: row.stats.queued, queued: 0 } } satisfies Partial<Broadcast>)
    return row as T
  }
  throw new MetaError(404, 'Not found', path)
}

// ---- WhatsApp accounts (dummy) ----
const dummyAccountNow = (): WaAccount => ({
  wabaId: '990000000000001',
  wabaName: 'Helo Demo Store',
  businessId: '990000000000003',
  phoneNumbers: [{ id: '990000000000002', display: '+91 98765 43210', verifiedName: 'Helo Demo Store' }],
  source: 'env',
  billing: { mode: 'partner_credit', state: 'shared' },
  steps: {},
  hasPin: false,
  canDisconnect: false,
  needsAttention: false,
  createdAt: new Date().toISOString(),
})
let waAccounts: WaAccount[] | null = null
/** Demo control: show Home as a brand-new workspace (no WhatsApp yet). */
export const resetDummyWhatsApp = (connected: boolean) => void (waAccounts = connected ? [dummyAccountNow()] : [])

export async function dummyWhatsApp<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as Record<string, string>
  waAccounts ??= [dummyAccountNow()]
  const u = new URL(path, 'http://x')
  if (u.pathname === '/api/whatsapp/health')
    return waAccounts.flatMap((a) =>
      a.phoneNumbers.map((n) => ({ phoneNumberId: n.id, display: n.display, name: n.verifiedName, quality: 'GREEN', nameStatus: 'APPROVED', status: 'CONNECTED', limit: 'TIER_2K', limitLabel: '2,000', checkedAt: new Date().toISOString() })),
    ) as T
  if (u.pathname === '/api/whatsapp/config') return { ready: true, missing: [], appId: 'demo', configId: 'demo', sdkVersion: 'v23.0', partnerCredit: true } as T
  if (u.pathname === '/api/whatsapp/accounts' && method === 'GET') return waAccounts as T
  if (u.pathname === '/api/whatsapp/connect') {
    const now = new Date().toISOString()
    const done = { state: 'done' as const, at: now }
    const coexist = b.flow === 'coexistence'
    const own = b.billing === 'own'
    const account: WaAccount = {
      wabaId: b.wabaId,
      wabaName: 'Asha Foods',
      businessId: b.businessId,
      phoneNumbers: [{ id: b.phoneNumberId, display: coexist ? '+91 99887 76655' : '+91 90000 12345', verifiedName: 'Asha Foods' }],
      source: coexist ? 'coexistence' : 'signup',
      billing: { mode: own ? 'own' : 'partner_credit', state: own ? 'pending' : 'shared' },
      steps: {
        exchange: done,
        subscribe: done,
        register: coexist ? { state: 'skipped', at: now } : done,
        sync: coexist ? done : { state: 'skipped', at: now },
        details: done,
        billing: own ? { state: 'failed', at: now, error: 'Add a payment method in WhatsApp Manager, then confirm here.' } : done,
      },
      hasPin: !coexist,
      canDisconnect: true,
      needsAttention: own,
      createdAt: now,
    }
    waAccounts = [...waAccounts.filter((a) => a.wabaId !== account.wabaId), account]
    return { account, ...(!coexist && { pin: '482913' }) } as T
  }
  const m = u.pathname.match(/^\/api\/whatsapp\/accounts\/(\d+)(?:\/([a-z]+))?$/)
  const acc = m && waAccounts.find((a) => a.wabaId === m[1])
  if (!m || !acc) throw new MetaError(404, 'Not found', 'That WhatsApp account isn’t connected to this workspace.')
  if (!m[2] && method === 'DELETE') {
    waAccounts = waAccounts.filter((a) => a !== acc)
    return { ok: true } as T
  }
  if (m[2] === 'billing') {
    const confirmed = (body as { confirmed?: boolean }).confirmed === true || b.mode === 'partner_credit'
    Object.assign(acc, { billing: { mode: b.mode, state: b.mode === 'partner_credit' ? 'shared' : confirmed ? 'confirmed' : 'pending' }, needsAttention: !confirmed })
    acc.steps.billing = confirmed ? { state: 'done', at: new Date().toISOString() } : acc.steps.billing
    return acc as T
  }
  if (m[2] === 'pin') return { pin: '482913' } as T
  return acc as T
}

// ---- billing (dummy): a month of made-up spend in rupees ----
let demoBudget: number | null = 5000
export async function dummyBilling<T>(method: string, path: string, body: unknown): Promise<T> {
  if (method === 'PUT') demoBudget = ((body ?? {}) as { budget: number | null }).budget
  const today = new Date()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today.getTime() - (29 - i) * 86_400_000)
    const volume = 40 + ((i * 37) % 90)
    return { day: d.toISOString().slice(0, 10), volume, cost: Math.round(volume * 0.62 * 100) / 100 }
  })
  const thisMonth = days.filter((d) => d.day.startsWith(today.toISOString().slice(0, 7)))
  const total = thisMonth.reduce((n, d) => n + d.cost, 0)
  void path
  return {
    currency: 'INR',
    budget: demoBudget,
    lastSyncAt: new Date(today.getTime() - 2 * 3_600_000).toISOString(),
    lastSyncError: null,
    month: { total, byCategory: [{ category: 'MARKETING', cost: total * 0.78, volume: 0 }, { category: 'UTILITY', cost: total * 0.17, volume: 0 }, { category: 'AUTHENTICATION', cost: total * 0.05, volume: 0 }] },
    days,
  } as T
}
