// Reply buttons and list messages a person can send from the inbox, with WhatsApp's limits
// (Cloud API interactive messages). Shared: the dialog checks as you type, the server enforces it.

export interface ButtonsReply {
  type: 'button'
  body: string
  buttons: string[]
}
export interface ListReply {
  type: 'list'
  body: string
  /** The label on the button that opens the list. */
  button: string
  rows: { title: string; description?: string }[]
}
export type InteractiveReply = ButtonsReply | ListReply

export const LIMITS = { body: 1024, buttonTitle: 20, buttons: 3, listButton: 20, rows: 10, rowTitle: 24, rowDescription: 72 }

/** The first problem with a reply, in words; null when WhatsApp will take it. */
export function interactiveError(r: InteractiveReply): string | null {
  if (!r.body.trim()) return 'Write the message first.'
  if (r.body.length > LIMITS.body) return `The message is too long (max ${LIMITS.body} characters).`
  if (r.type === 'button') {
    const titles = r.buttons.map((b) => b.trim()).filter(Boolean)
    if (!titles.length) return 'Add at least one button.'
    if (titles.length > LIMITS.buttons) return `WhatsApp allows ${LIMITS.buttons} buttons.`
    if (titles.some((t) => t.length > LIMITS.buttonTitle)) return `Button labels can be ${LIMITS.buttonTitle} characters at most.`
    if (new Set(titles.map((t) => t.toLowerCase())).size !== titles.length) return 'Each button needs a different label.'
    return null
  }
  if (!r.button.trim()) return 'Name the button that opens the list.'
  if (r.button.length > LIMITS.listButton) return `The list button label can be ${LIMITS.listButton} characters at most.`
  const rows = r.rows.filter((x) => x.title.trim())
  if (!rows.length) return 'Add at least one option.'
  if (rows.length > LIMITS.rows) return `WhatsApp allows ${LIMITS.rows} options.`
  if (rows.some((x) => x.title.length > LIMITS.rowTitle)) return `Option titles can be ${LIMITS.rowTitle} characters at most.`
  if (rows.some((x) => (x.description ?? '').length > LIMITS.rowDescription)) return `Option descriptions can be ${LIMITS.rowDescription} characters at most.`
  if (new Set(rows.map((x) => x.title.trim().toLowerCase())).size !== rows.length) return 'Each option needs a different title.'
  return null
}

/** The Cloud API `interactive` object. Ids are positional, so a tap tells us which one. */
export function interactivePayload(r: InteractiveReply) {
  if (r.type === 'button')
    return {
      type: 'button',
      body: { text: r.body.trim() },
      action: { buttons: r.buttons.map((b) => b.trim()).filter(Boolean).map((title, i) => ({ type: 'reply', reply: { id: `btn_${i + 1}`, title } })) },
    }
  return {
    type: 'list',
    body: { text: r.body.trim() },
    action: {
      button: r.button.trim(),
      sections: [{ title: r.button.trim().slice(0, 24), rows: r.rows.filter((x) => x.title.trim()).map((x, i) => ({ id: `row_${i + 1}`, title: x.title.trim(), ...(x.description?.trim() && { description: x.description.trim() }) })) }],
    },
  }
}

/** How the message reads in the chat: the text, then its choices. */
export const interactiveText = (r: InteractiveReply) =>
  `${r.body.trim()} [${(r.type === 'button' ? r.buttons.map((b) => b.trim()) : r.rows.map((x) => x.title.trim())).filter(Boolean).join(' · ')}]`
