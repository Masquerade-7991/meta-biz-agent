import { createContext } from 'react'
import { CANNED_FLOWS, newCarouselCard, newMenuOption, type RichReplyStarter } from '@/app/wizard/mockData'
import { nameFromTrigger } from '@/app/wizard/richReplies'
import type { ImageSource, RichReplyType } from '@/app/wizard/types'

// The rich reply editor's state and the helpers its form shares.

/** What the editor holds: the draft, plus whether the name was typed (else it follows the trigger). */
export type EditorState = RichReplyStarter & {
  replyId?: string
  name: string
  nameEdited: boolean
  /** Opened from a reply made outside Helo.ai: Meta has only its instruction, so the form starts empty. */
  madeElsewhere?: boolean
}

export const effectiveName = (e: EditorState) => (e.nameEdited ? e.name : nameFromTrigger(e.trigger)).trim()

export const urlSource = (): ImageSource => ({ kind: 'url', ref: '', label: '' })

export function blankDraft(type: RichReplyType): RichReplyStarter {
  const t = { type, trigger: '' }
  switch (type) {
    case 'cta_url':
      return { ...t, type, blanks: { messageText: '', buttonLabel: '', link: '' } }
    case 'image':
      return { ...t, type, blanks: { image: urlSource(), caption: '' } }
    case 'interactive_list':
      return { ...t, type, blanks: { messageText: '', menuButtonLabel: '', groupsEnabled: false, options: [newMenuOption(), newMenuOption()] } }
    case 'carousel_url':
    case 'carousel_quick_reply':
      return { ...t, type, blanks: { messageText: '', cards: [newCarouselCard(), newCarouselCard()] } }
    case 'location':
      return { ...t, type, blanks: { placeName: '', address: '', latitude: '', longitude: '' } }
    case 'location_request':
      return { ...t, type, blanks: { messageText: '' } }
    case 'flow':
      return { ...t, type, blanks: { flowName: CANNED_FLOWS[0] ?? null, messageText: '', buttonLabel: '' } }
    case 'interactive_reply_buttons':
      return { ...t, type, blanks: { messageText: '', buttons: ['', ''] } }
  }
}


/** A new type keeps what the old one already said (message and button text), so switching is cheap. */
export function switchType(e: EditorState, type: RichReplyType): EditorState {
  const next = blankDraft(type)
  const old = e.blanks as Partial<Record<'messageText' | 'buttonLabel', string>>
  const blanks = { ...next.blanks } as Record<string, unknown>
  for (const k of ['messageText', 'buttonLabel'] as const) if (old[k] && k in blanks) blanks[k] = old[k]
  return { ...e, ...next, trigger: e.trigger, blanks } as unknown as EditorState
}


/** Which errors show: a field's own once it has been left, or every one after Save was pressed. */
export const FormContext = createContext<{ issue: (field: string) => string | undefined; touch: (field: string) => void }>({
  issue: () => undefined,
  touch: () => {},
})
