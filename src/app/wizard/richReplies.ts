// Rich replies = Meta "UI skills". Meta stores only title, component_type, status and a
// plain-language instruction; the structured `blanks` live here and compile into that instruction.
// Limits: PRD Appendix C, cross-checked with Meta's writing-ui-skills guide.
import type { ImageSource, RichReply, RichReplyType } from './types'

export const RICH_REPLY_LIMITS = {
  bodyMax: 1024,
  listBodyMax: 4096,
  labelMax: 20,
  footerMax: 60,
  rowTitleMax: 24,
  rowDescriptionMax: 72,
  rowIdMax: 188,
  rowsMin: 1,
  rowsMax: 10,
  buttonsMin: 1,
  buttonsMax: 3,
  cardsMin: 2,
  cardsMax: 10,
  cardTextMax: 160,
} as const
const L = RICH_REPLY_LIMITS

export interface RichReplyIssue {
  field: string
  message: string
}

// Plain `Pick` collapses a union into one flat shape (losing the type<->blanks correlation) —
// distributing over a naked type parameter keeps each variant separate, so switches narrow.
type DistributivePick<T, K extends keyof T> = T extends unknown ? Pick<T, K> : never
export type RichReplyDraft = DistributivePick<RichReply, 'type' | 'trigger' | 'blanks'>

const isHttps = (s: string | undefined) => {
  try {
    return new URL((s ?? '').trim()).protocol === 'https:'
  } catch {
    return false
  }
}

/** Issue `field` paths, so the UI can map each error to its input:
 *  messageText, buttonLabel, link, footer, headerMedia, image, caption, menuButtonLabel, flowName,
 *  latitude, longitude,
 *  options (row count), options.<optionId>.rowId | .title | .description,
 *  buttons (button count), buttons.<index> (0-based),
 *  cards (card count), cards.<cardId>.image | .cardText | .buttonLabel | .link.
 *  Returns [] when blanks is null (a Meta-only row with raw instruction text). */
export function validateRichReply(draft: { type: RichReplyType; blanks: unknown }): RichReplyIssue[] {
  const d = draft as DistributivePick<RichReply, 'type' | 'blanks'>
  const issues: RichReplyIssue[] = []
  const add = (field: string, message: string) => issues.push({ field, message })
  const text = (field: string, value: string | undefined, name: string, max: number, required = true) => {
    const v = (value ?? '').trim()
    if (!v) {
      if (required) add(field, `${name} is required.`)
    } else if (v.length > max) add(field, `${name} must be ${max} characters or fewer (now ${v.length}).`)
  }
  const url = (field: string, value: string | undefined, name: string) => {
    if (!(value ?? '').trim()) add(field, `${name} is required.`)
    else if (!isHttps(value)) add(field, `${name} must be a full https:// link.`)
  }
  const image = (field: string, src: ImageSource | undefined, name: string) => {
    if (!src || !src.ref?.trim()) add(field, `${name} is required.`)
    else if (src.kind === 'url' && !isHttps(src.ref)) add(field, `${name} link must be a full https:// link.`)
  }
  const cards = (list: { id: string; image: ImageSource; cardText: string; buttonLabel: string; link: string }[], withLink: boolean) => {
    if (list.length < L.cardsMin || list.length > L.cardsMax) add('cards', `Add ${L.cardsMin} to ${L.cardsMax} cards (now ${list.length}).`)
    list.forEach((c, i) => {
      const p = `cards.${c.id}`
      image(`${p}.image`, c.image, `Card ${i + 1} image`)
      text(`${p}.cardText`, c.cardText, `Card ${i + 1} text`, L.cardTextMax)
      text(`${p}.buttonLabel`, c.buttonLabel, `Card ${i + 1} button label`, L.labelMax)
      if (withLink) url(`${p}.link`, c.link, `Card ${i + 1} button URL`)
    })
  }
  if (!d.blanks) return issues
  switch (d.type) {
    case 'cta_url': {
      const b = d.blanks
      text('messageText', b.messageText, 'Body text', L.bodyMax)
      text('buttonLabel', b.buttonLabel, 'Button label', L.labelMax)
      url('link', b.link, 'Button URL')
      if (b.headerMedia) image('headerMedia', b.headerMedia, 'Header media')
      text('footer', b.footer, 'Footer text', L.footerMax, false)
      break
    }
    case 'image':
      image('image', d.blanks.image, 'Image source')
      text('caption', d.blanks.caption, 'Caption', L.bodyMax, false)
      break
    case 'interactive_list': {
      const b = d.blanks
      text('messageText', b.messageText, 'Body text', L.listBodyMax)
      text('menuButtonLabel', b.menuButtonLabel, 'Button text', L.labelMax)
      if (b.options.length < L.rowsMin || b.options.length > L.rowsMax) add('options', `Add ${L.rowsMin} to ${L.rowsMax} rows (now ${b.options.length}).`)
      const seen = new Set<string>()
      b.options.forEach((o, i) => {
        const p = `options.${o.id}`
        const rowId = (o.rowId ?? '').trim()
        text(`${p}.rowId`, rowId, `Row ${i + 1} ID`, L.rowIdMax)
        if (rowId && seen.has(rowId)) add(`${p}.rowId`, `Row ${i + 1} ID "${rowId}" is already used by another row.`)
        seen.add(rowId)
        text(`${p}.title`, o.title, `Row ${i + 1} title`, L.rowTitleMax)
        text(`${p}.description`, o.description, `Row ${i + 1} description`, L.rowDescriptionMax, false)
      })
      break
    }
    case 'interactive_reply_buttons': {
      const b = d.blanks
      text('messageText', b.messageText, 'Body text', L.bodyMax)
      if (b.buttons.length < L.buttonsMin || b.buttons.length > L.buttonsMax) add('buttons', `Add ${L.buttonsMin} to ${L.buttonsMax} buttons (now ${b.buttons.length}).`)
      const seen = new Set<string>()
      b.buttons.forEach((title, i) => {
        text(`buttons.${i}`, title, `Button ${i + 1} title`, L.labelMax)
        const key = title.trim().toLowerCase()
        if (key && seen.has(key)) add(`buttons.${i}`, `Button ${i + 1} title must be different from the other buttons.`)
        seen.add(key)
      })
      break
    }
    case 'carousel_url':
    case 'carousel_quick_reply':
      text('messageText', d.blanks.messageText, 'Body text', L.bodyMax)
      cards(d.blanks.cards, d.type === 'carousel_url')
      break
    case 'location': {
      const coord = (field: 'latitude' | 'longitude', max: number, name: string) => {
        const raw = (d.blanks as { latitude: string; longitude: string })[field].trim()
        const n = Number(raw)
        if (!raw) add(field, `${name} is required.`)
        else if (!Number.isFinite(n) || n < -max || n > max) add(field, `${name} must be a number between -${max} and ${max}.`)
      }
      coord('latitude', 90, 'Latitude')
      coord('longitude', 180, 'Longitude')
      break
    }
    case 'location_request':
      text('messageText', d.blanks.messageText, 'Body text', L.bodyMax)
      break
    case 'flow':
      if (!d.blanks.flowName) add('flowName', 'Pick a WhatsApp form.')
      text('messageText', d.blanks.messageText, 'Body text', L.bodyMax)
      text('buttonLabel', d.blanks.buttonLabel, 'Button label', L.labelMax)
      break
  }
  return issues
}

/** A stable snake_case row ID from the row title, unique among `existing` (e.g. "gift_sets", "gift_sets_2"). */
export function rowIdFromTitle(title: string, existing: string[]): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'option'
  let id = base
  for (let n = 2; existing.includes(id); n++) id = `${base}_${n}`
  return id
}

export function describeImageSource(src: ImageSource): string {
  switch (src.kind) {
    case 'document':
      return `the image from the knowledge document "${src.label}"`
    case 'website':
      return src.path ? `the image on the page "${src.path}" of the website "${src.label}"` : `the image on the website page "${src.label}"`
    case 'connector':
      return `the image returned by the "${src.label}" tool`
    case 'url':
      return `the image at ${src.ref}`
  }
}

/** "a", "a and b", "a, b, and c" */
const list = (parts: string[]) =>
  parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`

/** The UI-skill instruction, regenerated in full from `blanks` on every save (never parsed back).
 *  Follows Meta's writing-ui-skills guide: trigger first, then every element with its exact value;
 *  optional parts appear only when set. Deterministic. */
export function compileRichReplySentence(draft: RichReplyDraft): string {
  const t = draft.trigger.trim().replace(/^(if|when)\s+/i, '').replace(/[.\s]+$/, '') || '…'
  if (!draft.blanks) return ''
  const has = (s: string | undefined) => !!s?.trim()
  switch (draft.type) {
    case 'cta_url': {
      const b = draft.blanks
      const parts = [`the body text "${b.messageText}"`, `the button label "${b.buttonLabel}"`, `the URL ${b.link}`]
      if (b.headerMedia && has(b.headerMedia.ref)) parts.push(`a header ${b.headerMedia.mediaType}: ${describeImageSource(b.headerMedia).replace(/^the image/, `the ${b.headerMedia.mediaType}`)}`)
      if (has(b.footer)) parts.push(`the footer text "${b.footer}"`)
      return `If ${t}, send a button message with ${list(parts)}.`
    }
    case 'image': {
      const b = draft.blanks
      const caption = has(b.caption) ? ` with the caption "${b.caption}"` : ''
      return `If ${t}, send an image message with ${describeImageSource(b.image)}${caption}. Do not use any other image.`
    }
    case 'interactive_list': {
      const b = draft.blanks
      const rows = b.options.map((o) => {
        let row = `row ID "${o.rowId}" titled "${o.title}"`
        if (has(o.description)) row += ` with the description "${o.description}"`
        if (b.groupsEnabled && has(o.group)) row += ` in the section "${o.group}"`
        return row
      })
      return `If ${t}, send a list message with the body text "${b.messageText}", the button text "${b.menuButtonLabel}", and ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}: ${rows.join('; ')}.`
    }
    case 'interactive_reply_buttons': {
      const b = draft.blanks
      const buttons = b.buttons.filter(has).map((x) => `"${x}"`)
      return `If ${t}, send a reply buttons message with the body text "${b.messageText}" and ${buttons.length} ${buttons.length === 1 ? 'button' : 'buttons'}: ${list(buttons)}.`
    }
    case 'carousel_url':
    case 'carousel_quick_reply': {
      const b = draft.blanks
      const url = draft.type === 'carousel_url'
      const cards = b.cards.map(
        (c, i) =>
          `Card ${i + 1}: ${describeImageSource(c.image)}, the card text "${c.cardText}", ` +
          (url ? `the button label "${c.buttonLabel}", and the button URL ${c.link}.` : `and the quick-reply button "${c.buttonLabel}".`),
      )
      const kind = url ? 'a carousel with URL buttons' : 'a carousel with quick-reply buttons'
      return `If ${t}, send ${kind} with the body text "${b.messageText}" and ${b.cards.length} cards. ${cards.join(' ')}`
    }
    case 'location': {
      const b = draft.blanks
      const parts = [`the latitude ${b.latitude.trim()}`, `the longitude ${b.longitude.trim()}`]
      if (has(b.placeName)) parts.push(`the name "${b.placeName}"`)
      if (has(b.address)) parts.push(`the address "${b.address}"`)
      return `If ${t}, send a location message with ${list(parts)}. These coordinates are verified by the business; use them exactly and never invent or change coordinates.`
    }
    case 'location_request':
      return `If ${t}, send a location request message with the body text "${draft.blanks.messageText}".`
    case 'flow': {
      const b = draft.blanks
      return `If ${t}, open the WhatsApp form "${b.flowName}" with the body text "${b.messageText}" and the button label "${b.buttonLabel}".`
    }
    default:
      return ''
  }
}

const urlSource = (url: unknown): ImageSource => ({ kind: 'url', ref: String(url ?? ''), label: String(url ?? '') })

/** Saved rows from before image sources and row IDs: `imageUrl` strings become url sources, and
 *  menu options without a rowId get one from their title. Already-migrated rows pass through. */
export function migrateRichReply(r: any): RichReply {
  const b = r?.blanks
  if (!b) return r
  if (r.type === 'image' && !b.image) {
    const { imageUrl, ...rest } = b
    return { ...r, blanks: { ...rest, image: urlSource(imageUrl) } }
  }
  if ((r.type === 'carousel_url' || r.type === 'carousel_quick_reply') && Array.isArray(b.cards)) {
    const cards = b.cards.map(({ imageUrl, ...c }: { imageUrl?: string; image?: ImageSource }) => ({ ...c, image: c.image ?? urlSource(imageUrl) }))
    return { ...r, blanks: { ...b, cards } }
  }
  if (r.type === 'interactive_list' && Array.isArray(b.options)) {
    const used: string[] = b.options.map((o: { rowId?: string }) => o.rowId).filter(Boolean)
    const options = b.options.map((o: { rowId?: string; title?: string }) => {
      if (o.rowId) return o
      const rowId = rowIdFromTitle(o.title ?? '', used)
      used.push(rowId)
      return { ...o, rowId }
    })
    return { ...r, blanks: { ...b, options } }
  }
  return r
}
