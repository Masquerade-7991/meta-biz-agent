// Sample customers and chats for demos: loaded into a workspace by "Load sample data" (server) and
// shown by dummy mode (browser). Pure data, so both sides import it. Numbers are fake (+91 99000…).
export interface SampleMessage {
  /** Minutes before now. */
  ago: number
  author: 'customer' | 'ai' | 'agent' | 'note'
  body: string
}
export interface SampleChat {
  phone: string
  name: string
  owner: 'ai' | 'human'
  tags: string[]
  messages: SampleMessage[]
}

export const SAMPLE_CHATS: SampleChat[] = [
  {
    phone: '919900000101',
    name: 'Priya Sharma',
    owner: 'human',
    tags: ['billing'],
    messages: [
      { ago: 52, author: 'customer', body: 'Hi, I was charged twice for my Helo Messaging plan this month.' },
      { ago: 51, author: 'ai', body: 'Sorry about that, Priya. I can see two payments on your account. I’m passing this to our billing team so they can refund the extra charge.' },
      { ago: 51, author: 'note', body: 'Duplicate charge of ₹4,999 on 2 Oct. Refund needs finance approval.' },
      { ago: 18, author: 'customer', body: 'Any update on the refund?' },
    ],
  },
  {
    phone: '919900000102',
    name: 'Rahul Verma',
    owner: 'ai',
    tags: ['sales'],
    messages: [
      { ago: 240, author: 'customer', body: 'What does Helo Convo cost for a 20-person support team?' },
      { ago: 239, author: 'ai', body: 'Helo Convo starts at ₹9,999 a month and includes AI chat on WhatsApp, web and app. For 20 agents, our team can share a custom quote. Shall I book a quick demo?' },
      { ago: 236, author: 'customer', body: 'Yes, tomorrow after 3 pm works.' },
      { ago: 236, author: 'ai', body: 'Done. You’re booked for tomorrow at 3:30 pm. You’ll get a calendar invite on your email shortly.' },
    ],
  },
  {
    phone: '919900000103',
    name: 'Ananya Iyer',
    owner: 'human',
    tags: ['technical', 'priority'],
    messages: [
      { ago: 1620, author: 'customer', body: 'Our WhatsApp templates keep getting rejected. Can someone help?' },
      { ago: 1619, author: 'ai', body: 'Template rejections usually come from formatting or policy issues. Let me connect you with a specialist who can review them with you.' },
      { ago: 1560, author: 'agent', body: 'Hi Ananya, I’m Soumik from Helo.ai. Could you share the template names that were rejected?' },
      { ago: 1530, author: 'customer', body: 'order_update_v2 and festive_offer_oct' },
    ],
  },
  {
    phone: '919900000104',
    name: 'Mohit Kapoor',
    owner: 'ai',
    tags: [],
    messages: [
      { ago: 8, author: 'customer', body: 'Is Helo.ai data hosted in India?' },
      { ago: 8, author: 'ai', body: 'Yes. Data is hosted in India on Helo.ai’s own infrastructure, and we are SOC 2 Type II and ISO 27001 certified.' },
    ],
  },
]
