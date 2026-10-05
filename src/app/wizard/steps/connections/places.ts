import type { ApiKeyEntry, ValueLocation } from '@/app/wizard/types'

// Where a value travels. Colour is never the only cue: every badge carries its words.
export const PLACE: Record<ValueLocation, { label: string; short: string; example: string; tone: string }> = {
  path: { label: 'Path', short: 'Path', example: '/orders/{id}', tone: 'var(--chart-4)' },
  query: { label: 'Web address', short: 'URL', example: '?limit=3', tone: 'var(--chart-1)' },
  header: { label: 'Headers', short: 'Header', example: 'Name: value', tone: 'var(--chart-5)' },
  body: { label: 'Body (JSON)', short: 'Body', example: '{ "query": … }', tone: 'var(--chart-2)' },
}

/** Dialog titles: the theme's --text-lg is a display size, too big for a dialog. */
export const DIALOG_TITLE = { fontSize: '1.25rem', lineHeight: 1.3 } as const

// How an access key is sent. "Bearer token" is the common case, so it needs no field name.
export type KeyMode = 'bearer' | 'header' | 'query'
export const KEY_MODES: { id: KeyMode; title: string; hint: string }[] = [
  { id: 'bearer', title: 'Bearer token', hint: 'Authorization: Bearer …' },
  { id: 'header', title: 'Custom header', hint: 'e.g. X-API-Key: …' },
  { id: 'query', title: 'Web address', hint: '…?api_key=…' },
]
export const keyMode = (k: Pick<ApiKeyEntry, 'location' | 'fieldName' | 'prefix'>): KeyMode =>
  k.location === 'query' ? 'query' : k.fieldName.toLowerCase() === 'authorization' && k.prefix.trim().toLowerCase() === 'bearer' ? 'bearer' : 'header'
/** A key row as Meta stores it. Typed values are only ever passed through to Meta, never kept. */
export const keyEntry = (r: { id: string; mode: KeyMode; fieldName: string; prefix: string; value: string; savedHint?: string }): ApiKeyEntry =>
  r.mode === 'bearer'
    ? { id: r.id, location: 'header', fieldName: 'Authorization', prefix: 'Bearer ', value: r.value, hint: r.savedHint }
    : { id: r.id, location: r.mode === 'query' ? 'query' : 'header', fieldName: r.fieldName.trim(), prefix: r.mode === 'query' ? '' : r.prefix, value: r.value, hint: r.savedHint }
