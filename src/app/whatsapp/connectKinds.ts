import type { Flow } from '@/app/api/whatsapp'

/** The three ways into Meta's signup that the connect dialog offers: what to know, and what to confirm
 *  before Connect. Moving from another provider runs Meta's standard (new number) flow. Every line is
 *  something Meta states; nothing here promises more than its signup does. */
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
    know: ['The WhatsApp Business app keeps working on your phone.', 'Your chats and contacts sync here.', 'You’ll scan a QR code with the app.'],
    confirm: ['This number is on the WhatsApp Business app', 'I have my phone with me'],
  },
  {
    id: 'move',
    flow: 'new',
    title: 'Move from another provider',
    line: 'Bring a number you use with another WhatsApp provider.',
    know: [
      'Turn off two-step verification for the number first. Your current provider can do it.',
      'Its display name, quality rating and messaging limit stay. Message history doesn’t move.',
      'A number works with one provider at a time, so it stops working with your current one.',
    ],
    confirm: ['I’ve turned off two-step verification', 'I’m ready to receive a code'],
  },
]
