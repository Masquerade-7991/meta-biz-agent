import type { Flow } from '@/app/api/whatsapp'

/** The three ways into Meta's signup that the connect dialog offers: what to know, and what to confirm
 *  before Connect. A number already with another provider isn't moved (Meta's account model no longer
 *  supports moving numbers between providers); the business shares its WhatsApp account through Meta's
 *  standard (new number) flow. Every line is something Meta states; nothing here promises more than its
 *  signup does. */
export interface ConnectKind {
  id: 'new' | 'app' | 'move'
  flow: Flow
  title: string
  line: string
  know: string[]
  confirm: string[]
}

export const CONNECT_KINDS: ConnectKind[] = [
  {
    id: 'new',
    flow: 'new',
    title: 'New number',
    line: 'A number that isn’t on WhatsApp yet.',
    know: ['This number must not be active on WhatsApp.', 'You’ll get a code by SMS or call to verify it.', 'You’ll log in with Facebook as an admin of your business.'],
    confirm: ['I confirm this number isn’t using WhatsApp', 'I’m ready to receive a code'],
  },
  {
    id: 'app',
    flow: 'coexistence',
    title: 'WhatsApp Business app number',
    line: 'Keep using the app on your phone; chats sync here.',
    know: ['The WhatsApp Business app keeps working on your phone.', 'Your chats and contacts sync here.', 'Meta’s signup shows a code. You confirm it in the app and paste it back.'],
    confirm: ['This number is on the WhatsApp Business app', 'I have my phone with me'],
  },
  {
    id: 'move',
    flow: 'new',
    title: 'Already with another provider',
    line: 'Your number works with another WhatsApp provider today.',
    know: [
      'In Meta’s signup, use the number you already have. It doesn’t move and your chats carry on.',
      'Your current provider can stay on the number. Removing them is up to you.',
      'Templates stay with your current provider. Helo.ai gets its own messaging account.',
      'A WhatsApp account can be shared with up to 5 providers.',
    ],
    confirm: ['This number works with another provider today', 'I’ll use this number in Meta’s signup'],
  },
]
