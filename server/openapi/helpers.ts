// Shorthand for writing the OpenAPI document (server/openapi/index.ts) by hand without drowning in
// JSON: a field is a short string ('string', 'integer[]', 'open|pending', 'Ticket', 'date-time?')
// or a full schema; an operation is one op({...}) call; who may call it comes from permissions.ts.
import { ROLES, can, type Action } from '../../src/app/lib/permissions.ts'

export type Schema = { [k: string]: unknown }
export type Field = string | Schema
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` })

const TYPES = new Set(['string', 'integer', 'number', 'boolean', 'object', 'array', 'null'])

/** 'string' · 'integer' · 'number' · 'boolean' · 'object' · 'date-time' · 'a|b|c' (enum) · 'Name' (a
 *  component) · any other word is that exact value · suffix '[]' for a list, '?' for "or null". A
 *  schema object passes through. */
export function t(f: Field): Schema {
  if (typeof f !== 'string') return f
  if (f.endsWith('?')) {
    const s = t(f.slice(0, -1))
    if (s.$ref || !s.type) return { anyOf: [s, { type: 'null' }] }
    return { ...s, type: [s.type, 'null'], ...(Array.isArray(s.enum) && { enum: [...s.enum, null] }) }
  }
  if (f.endsWith('[]')) return { type: 'array', items: t(f.slice(0, -2)) }
  if (f.includes('|')) return { type: 'string', enum: f.split('|') }
  if (f === 'date-time') return { type: 'string', format: 'date-time' }
  if (f === 'any') return {}
  if (/^[A-Z]/.test(f)) return ref(f)
  if (TYPES.has(f)) return { type: f }
  return { type: 'string', const: f }
}

/** A field with a description (and any extra keywords, e.g. maxLength). */
export const d = (f: Field, description: string, extra: Schema = {}): Schema => ({ ...t(f), description, ...extra })

/** An object; a key ending in '*' is required. */
export function o(props: Record<string, Field>, description?: string): Schema {
  const properties: Record<string, Schema> = {}
  const required: string[] = []
  for (const [k, v] of Object.entries(props)) {
    const name = k.endsWith('*') ? k.slice(0, -1) : k
    if (name !== k) required.push(name)
    properties[name] = t(v)
  }
  return { type: 'object', properties, ...(required.length && { required }), ...(description && { description }) }
}

export const OK = o({ 'ok*': { type: 'boolean', const: true } })

/** "Admin or above (`agent.edit`)": the lowest role the permission allows, from the shared matrix. */
export function roleFor(action: Action): string {
  const lowest = [...ROLES].reverse().find((r) => can(r.id, action))
  return `${lowest?.label ?? 'Owner'}${lowest?.id === 'owner' ? '' : ' or above'} (\`${action}\`)`
}

export interface Op {
  id: string
  summary: string
  description?: string
  /** 'public', 'member' (default), a permission, or free text for anything else (e.g. a shared secret). */
  who?: 'public' | 'member' | Action | { text: string; public?: boolean }
  query?: Record<string, Field>
  headers?: Record<string, Field>
  /** Path parameter schemas that differ from the shared ones in PARAMS. */
  params?: Record<string, Field>
  body?: Schema
  /** Request body media type when it isn't JSON (raw uploads). */
  bodyType?: string
  ok?: Field | null
  okStatus?: number
  okType?: string
  okDescription?: string
  /** Status → what the server says (its real messages). */
  errors?: Record<number, string>
  /** Documents a Meta endpoint reached through the relay, not one of our own routes. */
  meta?: boolean
}

/** Shared path parameters; an op's `params` overrides them. */
const PARAMS: Record<string, Schema> = {
  phone: d('string', 'Customer phone number, country code first, digits only (e.g. 919876543210), or the BSUID of a customer who hides their number.', {
    pattern: String.raw`^(\d{8,15}|[A-Z]{2}\.[A-Za-z0-9.]{1,140})$`,
  }),
  id: d('string', 'Record id (MongoDB ObjectId).', { pattern: '^[a-f0-9]{24}$' }),
  n: d('integer', 'Ticket number, as shown in the console (#123).'),
  userId: d('string', 'Member user id (UUID).', { format: 'uuid' }),
  wabaId: d('string', 'WhatsApp Business Account id.', { pattern: String.raw`^\d+$` }),
  numberId: d('string', 'WhatsApp phone number id.', { pattern: String.raw`^\d{6,20}$` }),
}

function who(w: Op['who']): string {
  if (!w || w === 'member') return 'Any signed-in member of the workspace.'
  if (w === 'public') return 'Anyone; no sign-in.'
  if (typeof w === 'object') return w.text
  return roleFor(w) + '.'
}
const isPublic = (w: Op['who']) => w === 'public' || (typeof w === 'object' && !!w.public)

const errorBody = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } })

function build(path: string, op: Op, tag: string) {
  const pathParams = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: op.params?.[name] ? t(op.params[name]) : (PARAMS[name] ?? { type: 'string' }),
    ...(PARAMS[name]?.description && !op.params?.[name] ? { description: PARAMS[name].description } : {}),
  }))
  const named = (where: 'query' | 'header', fields: Record<string, Field> = {}) =>
    Object.entries(fields).map(([k, v]) => {
      const name = k.endsWith('*') ? k.slice(0, -1) : k
      const s = t(v)
      return { name, in: where, required: name !== k, schema: s, ...(typeof s.description === 'string' && { description: s.description }) }
    })
  const responses: Record<string, unknown> = {
    [op.okStatus ?? 200]:
      op.ok === null
        ? { description: op.okDescription ?? 'Done; no body.' }
        : {
            description: op.okDescription ?? 'Success.',
            content: { [op.okType ?? 'application/json']: { schema: t(op.ok ?? OK) } },
          },
  }
  for (const [status, text] of Object.entries(op.errors ?? {})) responses[status] = errorBody(text)
  // Meta's own errors come back through the relay unchanged.
  if (op.meta) responses['4XX'] ??= { description: 'Meta’s error, passed through: {title, detail} (Graph: {error: {message, code, fbtrace_id}}). The relay’s own 403, 429 and 502 are listed on /api/meta/{path}.' }
  // Every signed-in route passes the same gate (server/app.ts): no database 503, no session 401,
  // unfinished setup or no workspace 403.
  if (!isPublic(op.who) && !op.meta) {
    responses['401'] ??= { $ref: '#/components/responses/NotLoggedIn' }
    responses['403'] ??= { $ref: '#/components/responses/Forbidden' }
    responses['503'] ??= { $ref: '#/components/responses/DatabaseUnavailable' }
  }
  return {
    operationId: op.id,
    tags: [tag],
    summary: op.summary,
    description: [`**Who can call:** ${who(op.who)}`, op.description].filter(Boolean).join('\n\n'),
    ...(isPublic(op.who) && { security: [] }),
    ...(pathParams.length || op.query || op.headers ? { parameters: [...pathParams, ...named('query', op.query), ...named('header', op.headers)] } : {}),
    ...(op.body && {
      requestBody: { required: true, content: { [op.bodyType ?? 'application/json']: { schema: op.body } } },
    }),
    responses,
    ...(op.meta && { 'x-meta': true }),
  }
}

/** One area's routes, tagged and expanded into OpenAPI path items. */
export function area(tag: string, routes: Record<string, Partial<Record<Method, Op>>>) {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [path, methods] of Object.entries(routes)) {
    out[path] = {}
    for (const [m, op] of Object.entries(methods) as [Method, Op][]) out[path][m] = build(path, op, tag)
  }
  return out
}
