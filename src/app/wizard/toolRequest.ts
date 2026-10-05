// One model of a connector tool's request, shared by the Meta payload (toolBody), reading tools back
// from Meta (toolToAction), the live preview in the tool editor and test, and test-input typing.
// Keeping them together means the preview can't disagree with what Meta is sent.
//
// Meta's rules, checked live (Oct 2026; docs don't say): tool names are letters, numbers and
// underscores; value names can be anything but must be unique across path, query, headers and body;
// body params take no per-param `required` flag (that's the separate body.required list).

import type { ActionValue, ConnectionAction, ValueLocation } from './types'

export interface ParamNode {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  required?: boolean | string[]
  binding?: { kind: 'default' | 'macro'; value?: string; macro?: string }
  [k: string]: unknown
}
export interface MetaTool {
  id: string
  name: string
  description: string
  request_definition: {
    method: ConnectionAction['method']
    path: string
    path_parameters?: Record<string, ParamNode>
    query_parameters?: Record<string, ParamNode>
    headers?: Record<string, ParamNode>
    body?: { content_type: 'application/json'; params: Record<string, ParamNode>; required?: string[] } | null
  }
}

/** A value names its source; 'conversation_memory' (older drafts) behaves as 'conversation' on Meta. */
export const agentFills = (v: ActionValue) => v.source === 'conversation' || v.source === 'conversation_memory'
export const bodyAllowed = (method: ConnectionAction['method']) => method === 'POST' || method === 'PUT' || method === 'PATCH'

export function paramNode(v: ActionValue): ParamNode {
  // Shapes the console can't edit (objects, lists from MCP or elsewhere) go back exactly as Meta sent them.
  if (v.raw) return v.raw as ParamNode
  const binding: ParamNode['binding'] =
    v.source === 'fixed' ? { kind: 'default', value: v.fixedValue ?? '' } : v.source === 'whatsapp_number' ? { kind: 'macro', macro: 'WHATSAPP_PHONE_NUMBER' } : undefined
  return {
    type: v.type === 'text' ? 'string' : v.type,
    ...(v.description ? { description: v.description } : {}),
    ...(v.location === 'body' ? {} : { required: v.location === 'path' || v.required }),
    ...(binding ? { binding } : {}),
  }
}

export function toolBody(a: ConnectionAction) {
  const at = (loc: ValueLocation) => Object.fromEntries(a.values.filter((v) => v.location === loc && v.name).map((v) => [v.name, paramNode(v)]))
  const body = bodyAllowed(a.method) ? a.values.filter((v) => v.location === 'body' && v.name) : []
  return {
    name: a.name,
    description: a.description,
    user_auth_required: false,
    request_definition: {
      method: a.method,
      path: a.path,
      path_parameters: at('path'),
      query_parameters: at('query'),
      headers: at('header'),
      body: body.length
        ? { content_type: 'application/json', params: at('body'), required: body.filter((v) => v.required).map((v) => v.name) }
        : null,
    },
  }
}

/** A Meta tool as a local action. Ids are stable (tool id + place + name) so re-reading merges cleanly. */
export function toolToAction(t: MetaTool, connectionId: string, fromMcp: boolean): ConnectionAction {
  const rd = t.request_definition ?? { method: 'GET', path: '' }
  const bodyRequired = new Set(rd.body?.required ?? [])
  const values: ActionValue[] = []
  const add = (loc: ValueLocation, map?: Record<string, ParamNode>) =>
    Object.entries(map ?? {}).forEach(([name, n]) => {
      const simple = n.type === 'string' || n.type === 'integer' || n.type === 'number' || n.type === 'boolean'
      values.push({
        id: `${t.id}-${loc}-${name}`,
        name,
        type: n.type === 'string' || !simple ? 'text' : (n.type as ActionValue['type']),
        required: loc === 'body' ? bodyRequired.has(name) : n.required === true,
        location: loc,
        source: n.binding?.kind === 'default' ? 'fixed' : n.binding?.macro === 'WHATSAPP_PHONE_NUMBER' ? 'whatsapp_number' : 'conversation',
        fixedValue: n.binding?.value,
        description: n.description ?? '',
        ...(simple ? {} : { raw: n }),
      })
    })
  add('path', rd.path_parameters)
  add('query', rd.query_parameters)
  add('header', rd.headers)
  add('body', rd.body?.params)
  return { id: `tool-${t.id}`, metaId: t.id, connectionId, name: t.name, description: t.description, method: rd.method, path: rd.path, values, createdAt: Date.now(), fromMcp }
}

/** Problems that stop Meta accepting the tool, keyed by value id ('' = the tool itself). */
export function valueProblems(a: Pick<ConnectionAction, 'method' | 'values'>): Record<string, string> {
  const out: Record<string, string> = {}
  const seen = new Map<string, ActionValue>()
  for (const v of a.values) {
    const name = v.name.trim()
    if (!name) out[v.id] = 'Give this value a name.'
    else if (seen.has(name)) out[v.id] = `“${name}” is already used in this tool. Each value needs its own name, even in different places.`
    else seen.set(name, v)
    if (v.source === 'fixed' && !v.raw && v.type !== 'text' && v.fixedValue && coerce(v.type, v.fixedValue) === undefined)
      out[v.id] = `“${v.fixedValue}” isn't a ${v.type === 'boolean' ? 'yes/no value' : v.type === 'integer' ? 'whole number' : 'number'}.`
  }
  if (!bodyAllowed(a.method) && a.values.some((v) => v.location === 'body')) out[''] = `${a.method} requests have no body. Remove the body values or change the method.`
  return out
}

/** A typed value for Meta's run input, or undefined when it can't be read as that type. */
export function coerce(type: ActionValue['type'], raw: string): string | number | boolean | undefined {
  const s = raw.trim()
  if (type === 'text') return raw
  if (type === 'boolean') return /^(true|yes|1)$/i.test(s) ? true : /^(false|no|0)$/i.test(s) ? false : undefined
  if (s === '') return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || (type === 'integer' && !Number.isInteger(n))) return undefined
  return n
}

/** Test inputs (typed by the person, keyed by value id) as Meta's run input, keyed by name and typed. */
export function runInput(a: ConnectionAction, inputs: Record<string, string>): { input: Record<string, unknown>; errors: Record<string, string> } {
  const input: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  for (const v of a.values.filter(agentFills)) {
    const raw = inputs[v.id]
    if (raw === undefined || raw === '') {
      if (v.required || v.location === 'path') errors[v.id] = 'Needed for this test.'
      continue
    }
    const typed = coerce(v.type, raw)
    if (typed === undefined) errors[v.id] = `Enter a ${v.type === 'boolean' ? 'yes or no' : v.type === 'integer' ? 'whole number' : 'number'}.`
    else input[v.name] = typed
  }
  return { input, errors }
}

export interface RequestPreview {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
}

/**
 * What the tool sends, written out. Keys show as their place + last 4 characters; values the agent
 * fills show as ‹from chat: description›, or the test input when one is given.
 */
export function previewRequest(
  base: string,
  keys: { location: 'header' | 'query'; fieldName: string; prefix: string; hint?: string }[],
  a: Pick<ConnectionAction, 'method' | 'path' | 'values'>,
  inputs: Record<string, string> = {},
): RequestPreview {
  const shown = (v: ActionValue): string => {
    if (v.source === 'fixed') return v.fixedValue ?? ''
    if (v.source === 'whatsapp_number') return '‹customer’s WhatsApp number›'
    const given = inputs[v.id]
    return given !== undefined && given !== '' ? given : `‹from chat: ${v.description.trim() || v.name}›`
  }
  const masked = (k: (typeof keys)[number]) => `${k.prefix}••••${k.hint ?? ''}`
  let path = a.path || ''
  for (const v of a.values.filter((x) => x.location === 'path')) path = path.split(`{${v.name}}`).join(shown(v))
  const query = [
    ...keys.filter((k) => k.location === 'query' && k.fieldName).map((k) => `${k.fieldName}=${masked(k)}`),
    ...a.values.filter((v) => v.location === 'query' && v.name).map((v) => `${v.name}=${shown(v)}`),
  ]
  const url = base.replace(/\/+$/, '') + (path && !path.startsWith('/') ? '/' : '') + path + (query.length ? `?${query.join('&')}` : '')
  const headers: [string, string][] = [
    ...keys.filter((k) => k.location === 'header' && k.fieldName).map((k): [string, string] => [k.fieldName, masked(k)]),
    ...a.values.filter((v) => v.location === 'header' && v.name).map((v): [string, string] => [v.name, shown(v)]),
  ]
  const bodyValues = bodyAllowed(a.method as ConnectionAction['method']) ? a.values.filter((v) => v.location === 'body' && v.name) : []
  const body = bodyValues.length
    ? JSON.stringify(
        Object.fromEntries(bodyValues.map((v) => [v.name, v.raw ? `‹${String((v.raw as ParamNode).type)}›` : v.source === 'fixed' ? (coerce(v.type, v.fixedValue ?? '') ?? v.fixedValue ?? '') : shown(v)])),
        null,
        2,
      )
    : null
  if (body) headers.push(['Content-Type', 'application/json'])
  return { method: a.method, url, headers, body }
}

/** Meta names a called tool `integration_<id>_<Connector>__<Tool>`; split it back, or keep it whole. */
export function splitToolName(name: string): { connector: string | null; tool: string } {
  const m = /^integration_\d+_(.+?)__(.+)$/.exec(name)
  return m ? { connector: m[1], tool: m[2] } : { connector: null, tool: name }
}
