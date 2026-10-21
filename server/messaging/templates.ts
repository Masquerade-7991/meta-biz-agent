// WhatsApp message templates (/api/templates): read from and created on the WhatsApp Business Account,
// and sent one at a time into a chat, e.g. to reopen it after WhatsApp's 24-hour reply window.
import type http from 'node:http'
import { HttpError, type Obj, type Titles, arr, obj, readJson, serveJson } from '../platform/http.ts'
import { db, dbOffReason, needMetaAssets, ws } from '../platform/db.ts'
import { metaJson } from '../whatsapp/index.ts'
import { trace } from '../platform/trace.ts'
import { needInScope } from '../support/index.ts'
import { parseCustomerKey } from '../../src/app/lib/customer.ts'
import { conversations, sendTemplateMessage, type Actor } from './inbox.ts'
import { renderTemplate, templatePayload, type Template } from '../../src/app/templates/templates.ts'
import { can } from '../../src/app/lib/permissions.ts'

const FIELDS = 'id,name,status,category,language,components,rejected_reason'
const toTemplate = (t: Obj): Template & { id: string; rejectedReason?: string } => ({
  id: String(t.id),
  name: String(t.name),
  language: String(t.language),
  status: String(t.status),
  category: String(t.category),
  components: arr(t.components) as Template['components'],
  ...(t.rejected_reason && t.rejected_reason !== 'NONE' ? { rejectedReason: String(t.rejected_reason) } : {}),
})

async function listTemplates() {
  needMetaAssets()
  const out: ReturnType<typeof toTemplate>[] = []
  let after = ''
  // ponytail: first 500 templates; page further if a business ever keeps more.
  for (let page = 0; page < 5; page++) {
    const r = await metaJson('graph', 'GET', `/WABA_ID/message_templates?fields=${FIELDS}&limit=100${after ? `&after=${after}` : ''}`)
    out.push(...arr(r.data).map((t) => toTemplate(obj(t))))
    after = String(obj(obj(r.paging).cursors).after ?? '')
    if (!obj(r.paging).next || !after) break
  }
  return out
}

async function getTemplate(name: string, language: string): Promise<Template> {
  needMetaAssets()
  const r = await metaJson('graph', 'GET', `/WABA_ID/message_templates?fields=${FIELDS}&name=${encodeURIComponent(name)}&limit=50`)
  const t = arr(r.data).map((x) => toTemplate(obj(x))).find((x) => x.name === name && x.language === language)
  if (!t) throw new HttpError(404, `Template ${name} (${language}) wasn’t found on your WhatsApp account.`)
  if (t.status !== 'APPROVED') throw new HttpError(400, `Template ${name} is ${String(t.status).toLowerCase()}; only approved templates can be sent.`)
  return t
}

/** Builds Meta's create-template body; every {{n}} needs an example value for review. */
async function createTemplate(b: Obj) {
  needMetaAssets()
  const name = String(b.name ?? '').trim()
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new HttpError(400, 'Template names use lowercase letters, numbers and underscores only, like order_update.')
  const category = ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(String(b.category)) ? String(b.category) : 'MARKETING'
  const body = String(b.body ?? '').trim()
  if (!body || body.length > 1024) throw new HttpError(400, 'The message is required and can be up to 1024 characters.')
  const examples = obj(b.examples)
  const nums = (s: string) => [...new Set([...s.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, z) => a - z)
  const ex = (prefix: string, s: string) =>
    nums(s).map((n) => {
      const v = String(examples[`${prefix}:${n}`] ?? '').trim()
      if (!v) throw new HttpError(400, `Add an example for {{${n}}} so Meta can review the template.`)
      return v
    })
  const components: Obj[] = []
  const header = String(b.header ?? '').trim()
  if (header) components.push({ type: 'HEADER', format: 'TEXT', text: header, ...(nums(header).length && { example: { header_text: ex('header', header) } }) })
  components.push({ type: 'BODY', text: body, ...(nums(body).length && { example: { body_text: [ex('body', body)] } }) })
  const footer = String(b.footer ?? '').trim()
  if (footer) components.push({ type: 'FOOTER', text: footer.slice(0, 60) })
  const buttons = arr(b.buttons)
    .map(obj)
    .slice(0, 3)
    .map((x) => (x.type === 'URL' ? { type: 'URL', text: String(x.text).slice(0, 25), url: String(x.url) } : { type: 'QUICK_REPLY', text: String(x.text).slice(0, 25) }))
    .filter((x) => x.text)
  if (buttons.length) components.push({ type: 'BUTTONS', buttons })
  const r = await metaJson('graph', 'POST', '/WABA_ID/message_templates', { name, category, language: String(b.language || 'en'), components })
  return { id: String(r.id), status: String(r.status ?? 'PENDING') }
}

async function route(req: http.IncomingMessage, u: URL, me: Actor): Promise<unknown> {
  const path = u.pathname
  const m = req.method ?? 'GET'
  let seg: RegExpMatchArray | null
  if (path === '/api/templates' && m === 'GET') return listTemplates()
  if (path === '/api/templates' && m === 'POST') {
    if (!can(me.role, 'templates.create')) throw new HttpError(403, 'Supervisors, admins and owners create templates.')
    const body = obj(await readJson(req))
    const t = await createTemplate(body)
    trace('template.created', { name: String(body.name) }, { entity: 'template', id: String(body.name) })
    return t
  }
  if ((seg = path.match(/^\/api\/templates\/([a-z0-9_]+)$/)) && m === 'DELETE') {
    needMetaAssets()
    if (!can(me.role, 'templates.delete')) throw new HttpError(403, 'Only owners and admins can delete templates.')
    await metaJson('graph', 'DELETE', `/WABA_ID/message_templates?name=${seg[1]}`)
    trace('template.deleted', { name: seg[1] }, { entity: 'template', id: seg[1] })
    return { ok: true }
  }
  if (path === '/api/templates/send-one' && m === 'POST') {
    const b = obj(await readJson(req))
    const phone = parseCustomerKey(String(b.phone ?? ''))
    const conv = await conversations().findOne({ workspaceId: ws(), phone })
    if (!conv) throw new HttpError(404, 'No chat with this number yet.')
    await needInScope(me, conv.assigneeId)
    const tpl = obj(b.template)
    const template = conv.sample ? (tpl as unknown as Template) : await getTemplate(String(tpl.name ?? ''), String(tpl.language ?? ''))
    const values = Object.fromEntries(Object.entries(obj(b.values)).map(([k, v]) => [k, String(v)]))
    let payload
    try {
      payload = templatePayload(template, values)
    } catch (err) {
      throw new HttpError(400, (err as Error).message)
    }
    await sendTemplateMessage(phone, payload, renderTemplate(template, values), { sample: !!conv.sample, actor: me })
    await conversations().updateOne({ workspaceId: ws(), phone }, { $set: { owner: 'human', ...(!conv.assigneeId && { assigneeId: me._id }) } })
    return { ok: true }
  }
  throw new HttpError(404, 'Not found.')
}

const TITLES: Titles = { 400: 'Check the details', 403: 'Not allowed', 404: 'Not found', 502: 'WhatsApp didn’t accept it' }
export async function handleTemplates(req: http.IncomingMessage, res: http.ServerResponse, me: Actor): Promise<boolean> {
  const u = new URL(req.url ?? '/', 'http://x')
  if (!/^\/api\/templates(\/|$)/.test(u.pathname)) return false
  return serveJson(req, res, { titles: TITLES, db, noDb: { title: dbOffReason, detail: 'Templates need the database.' } }, () => route(req, u, me))
}
