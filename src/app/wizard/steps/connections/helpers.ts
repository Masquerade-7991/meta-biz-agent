import { newId } from '@/app/wizard/mockData'
import type { ActionValue, ConnectionAction, ValueLocation } from '@/app/wizard/types'

export function domainFromUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

/** A new value. Path values are named by their {placeholder}; others start unnamed for the person to fill in. */
export function newValue(name: string, location: ValueLocation): ActionValue {
  return { id: newId('value'), name, type: 'text', required: location === 'path', location, source: 'conversation', description: '' }
}

const placeholders = (path: string) => Array.from(path.matchAll(/\{([^{}/]+)\}/g)).map((m) => m[1])

/** Path values follow the {placeholders} typed in the path; other values are left as they are. */
export function syncPathValues(path: string, values: ActionValue[]): ActionValue[] {
  const pathValues = placeholders(path).map((name) => values.find((v) => v.location === 'path' && v.name === name) ?? newValue(name, 'path'))
  return [...pathValues, ...values.filter((v) => v.location !== 'path')]
}

const loose = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Another tool on the same connection whose name differs only in case or punctuation. */
export function similarTool(name: string, tools: ConnectionAction[], excludeId?: string): ConnectionAction | undefined {
  const n = loose(name)
  return n ? tools.find((a) => a.id !== excludeId && loose(a.name) === n) : undefined
}

export function formatActivityTime(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === now.toDateString()) return `Today ${time}`
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

/** Meta's connector errors in plain words, with what to change. Unknown ones come through as they are. */
export function metaErrorHint(message: string): string {
  const dup = /duplicate top-level input name "([^"]+)"/.exec(message)
  if (dup) return `Two values are both named “${dup[1]}”. Each value needs its own name, even in different places.`
  if (/tool name must contain only/i.test(message)) return 'The tool name can only use letters, numbers and underscores.'
  if (/already exists|unique/i.test(message) || /\b409\b/.test(message)) return 'Something with this name already exists here. Choose another name.'
  const field = /JSON field '([^']+)'/.exec(message)
  if (field) return `Meta didn’t accept ${field[1].replace(/^request_definition\./, '').replace('body.params', 'the body values').replace('query_parameters', 'the web address values').replace('headers', 'the header values').replace('path_parameters', 'the path values')}. Check the names and types there.`
  if (/Invalid connector request/i.test(message)) return 'Meta didn’t accept the connection. Check the name uses only letters, numbers and underscores, the address starts with https://, and every key is filled in.'
  if (/Invalid tool request|Invalid request_definition/i.test(message)) return `Meta didn’t accept the tool: ${message.replace(/^[^:]*:\s*/, '')}`
  return message
}
