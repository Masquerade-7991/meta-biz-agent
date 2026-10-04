// WhatsApp message templates: what a template needs filled in, and the send payload that fills it.
// Slots: body {{n}}, a text header {{1}} or a media header (image/video/document link), and a
// {{1}} at the end of a URL button.

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
  text?: string
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[]
}
export interface Template {
  name: string
  language: string
  status?: string
  category?: string
  components: TemplateComponent[]
}
export type Slot = { id: string; label: string; kind: 'text' | 'media' }

const vars = (s = '') => [...new Set([...s.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, z) => a - z)
const comp = (t: Template, type: TemplateComponent['type']) => t.components.find((c) => c.type === type)

/** Every value a template needs before it can be sent, in a stable order. */
export function slotsOf(t: Template): Slot[] {
  const out: Slot[] = []
  const h = comp(t, 'HEADER')
  if (h?.format && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(h.format)) out.push({ id: 'header:media', label: `Header ${h.format.toLowerCase()} link`, kind: 'media' })
  else if (h?.format === 'TEXT') for (const n of vars(h.text)) out.push({ id: `header:${n}`, label: `Header {{${n}}}`, kind: 'text' })
  for (const n of vars(comp(t, 'BODY')?.text)) out.push({ id: `body:${n}`, label: `{{${n}}}`, kind: 'text' })
  comp(t, 'BUTTONS')?.buttons?.forEach((b, i) => {
    if (b.type === 'URL' && vars(b.url).length) out.push({ id: `button:${i}`, label: `Link in “${b.text}”`, kind: 'text' })
  })
  return out
}

/** The `template` object for POST /{phone-number-id}/messages, with every slot filled from `values`. */
export function templatePayload(t: Template, values: Record<string, string>) {
  const missing = slotsOf(t).filter((s) => !values[s.id]?.trim())
  if (missing.length) throw new Error(`Fill in ${missing.map((s) => s.label).join(', ')}.`)
  const components: Record<string, unknown>[] = []
  const h = comp(t, 'HEADER')
  if (h?.format && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(h.format)) {
    const kind = h.format.toLowerCase()
    components.push({ type: 'header', parameters: [{ type: kind, [kind]: { link: values['header:media'] } }] })
  } else if (h?.format === 'TEXT' && vars(h.text).length) components.push({ type: 'header', parameters: vars(h.text).map((n) => ({ type: 'text', text: values[`header:${n}`] })) })
  const body = vars(comp(t, 'BODY')?.text)
  if (body.length) components.push({ type: 'body', parameters: body.map((n) => ({ type: 'text', text: values[`body:${n}`] })) })
  comp(t, 'BUTTONS')?.buttons?.forEach((b, i) => {
    if (b.type === 'URL' && vars(b.url).length) components.push({ type: 'button', sub_type: 'url', index: String(i), parameters: [{ type: 'text', text: values[`button:${i}`] }] })
  })
  return { name: t.name, language: { code: t.language }, ...(components.length && { components }) }
}

/** What the customer will read, for the chat history and previews. */
export function renderTemplate(t: Template, values: Record<string, string>) {
  const fill = (s: string | undefined, prefix: string) => (s ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => values[`${prefix}:${n}`] ?? `{{${n}}}`)
  const h = comp(t, 'HEADER')
  const parts = [h?.format === 'TEXT' ? `*${fill(h.text, 'header')}*` : h?.format ? `[${h.format.toLowerCase()}]` : '', fill(comp(t, 'BODY')?.text, 'body'), comp(t, 'FOOTER')?.text ? `_${comp(t, 'FOOTER')!.text}_` : '']
  const buttons = comp(t, 'BUTTONS')?.buttons?.map((b) => b.text) ?? []
  return parts.filter(Boolean).join('\n\n') + (buttons.length ? `\n[${buttons.join(' · ')}]` : '')
}
