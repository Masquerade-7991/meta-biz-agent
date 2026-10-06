// Product help shown on Home in every state. One list so links can be swapped without touching the page.
export interface HelpLink {
  title: string
  description: string
  href: string
}
export interface HelpGroup {
  title: string
  links: HelpLink[]
}

const MBA = 'https://developers.facebook.com/documentation/meta-business-agent'

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: 'Your AI agent',
    links: [
      { title: 'Get started with Meta Business Agent', description: 'Tokens, billing, webhook fields and your first agent.', href: `${MBA}/get-started` },
      { title: 'What the agent can do', description: 'Knowledge, skills, connectors, handoff and testing.', href: `${MBA}/capabilities` },
      { title: 'Write rich replies', description: 'Buttons, lists and carousels the agent can send.', href: `${MBA}/usage-guides/writing-ui-skills` },
      { title: 'Example: a post-purchase support agent', description: 'Bookings, refunds and a clean handoff to people.', href: `${MBA}/usage-guides/post-purchase-support-agent` },
      { title: 'Fix common problems', description: 'Agent not replying, allowlist, thread control and error codes.', href: `${MBA}/troubleshooting` },
    ],
  },
  {
    title: 'WhatsApp',
    links: [
      { title: 'WhatsApp Manager', description: 'Phone numbers, display names, quality rating and templates.', href: 'https://business.facebook.com/wa/manage/home/' },
      { title: 'Message templates', description: 'How templates work and how Meta reviews them.', href: 'https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates' },
      { title: 'WhatsApp Cloud API basics', description: 'How a WhatsApp Business number sends and receives.', href: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started' },
      { title: 'Business settings', description: 'People, partners and assets in your Meta Business portfolio.', href: 'https://business.facebook.com/settings' },
      { title: 'Billing Hub', description: 'Add a payment method so the agent can answer everyone.', href: 'https://business.facebook.com/latest/billing_hub/' },
    ],
  },
  {
    title: 'Helo.ai',
    links: [
      { title: 'Helo.ai WhatsApp', description: 'What Helo.ai offers on the WhatsApp Business Platform.', href: 'https://helo.ai/products/whatsapp' },
      { title: 'Helo Convo', description: 'AI chat and voice agents across channels.', href: 'https://helo.ai/products/helo-convo' },
      { title: 'Talk to Helo.ai support', description: 'Connecting a number, onboarding and account help.', href: 'https://helo.ai/contact-us' },
    ],
  },
]

/** Keyboard shortcuts, listed in the help menu. */
export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: '⌘K / Ctrl K', what: 'Search and jump anywhere' },
  { keys: 'J / K', what: 'Inbox: next or previous chat' },
  { keys: 'R', what: 'Inbox: reply to the open chat' },
  { keys: 'T', what: 'Inbox: take over or hand back to AI' },
]
