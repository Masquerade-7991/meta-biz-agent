import { compileRichReplySentence } from './richReplies'
import type {
  ActionMethod,
  AgentEventRow,
  AgentEventStatus,
  AgentEventTypeDef,
  BusinessHourRow,
  BusinessState,
  ApiKeyEntry,
  CarouselCard,
  Connection,
  ConnectionAction,
  ConnectionStatus,
  ConnectorTool,
  ConnectorType,
  ConversationTurn,
  Day,
  FaqRow,
  FollowUpInterval,
  FollowUpMaxAttempts,
  IntegrationDef,
  IntentRow,
  MenuOption,
  PersonaId,
  RichReply,
  RichReplyType,
  StepMeta,
  ToneId,
  ValueLocation,
  ValueSource,
  ValueType,
  WabaNumber,
  WizardState,
} from './types'

export const STEP_ORDER: StepMeta[] = [
  { id: 'agent', index: 1, label: 'Your agent' },
  { id: 'knowledge', index: 2, label: 'Knowledge' },
  { id: 'connections', index: 3, label: 'Connections', optionalTag: true },
  { id: 'safety', index: 4, label: 'Safety & handoff' },
  { id: 'publish', index: 5, label: 'Test & publish' },
]

export const MOCK_WABAS: WabaNumber[] = [
  {
    id: 'waba_1',
    phoneNumber: '+91 98765 43210',
    displayName: 'Aurora Home Goods',
    vertical: 'Retail',
    status: 'eligible',
    registered: true,
    billingAttached: true,
  },
  {
    id: 'waba_2',
    phoneNumber: '+91 91234 56780',
    displayName: 'Aurora Home Goods — Support',
    vertical: 'Retail',
    status: 'eligible',
    registered: true,
    billingAttached: false,
  },
  {
    id: 'waba_3',
    phoneNumber: '+91 90000 11122',
    displayName: 'Aurora Wellness Clinic',
    vertical: 'Health',
    status: 'ineligible',
    registered: true,
    billingAttached: true,
  },
  {
    id: 'waba_4',
    phoneNumber: '+91 99887 76655',
    displayName: 'Aurora Fresh Grocer',
    vertical: 'E-commerce',
    status: 'needs_registration',
    registered: false,
    billingAttached: false,
  },
]

export const CAPABILITY_STARTER_SET = [
  'Answer questions',
  'Provide business hours',
  'Share return policy',
  'Track an order',
]

export const CAPABILITY_FROM_CONNECTORS: Record<string, string[]> = {
  shopify: ['Check order status', 'Create a cart', 'Track a shipment'],
  woocommerce: ['Check order status', 'Track a shipment'],
  custom_rest: ['Run a custom action'],
}

export const PAYMENT_METHOD_OPTIONS: { id: string; label: string }[] = [
  { id: 'cod', label: 'Cash on delivery' },
  { id: 'upi', label: 'UPI' },
  { id: 'cards', label: 'Cards' },
  { id: 'netbanking', label: 'Net banking' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'other', label: 'Other' },
]

const DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Rows start unset — no shortcut or manual entry has touched them yet.
export const DEFAULT_BUSINESS_HOURS: BusinessHourRow[] = DAYS.map((day) => ({
  day,
  closed: false,
  open: '',
  close: '',
}))

// 30-minute steps, 00:00 through 23:30.
export const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const hours = String(Math.floor(i / 2)).padStart(2, '0')
  const minutes = i % 2 === 0 ? '00' : '30'
  return `${hours}:${minutes}`
})

// Business categories whose Section 2 leads with "How customers buy or book" (appointments,
// bookings) rather than returns/shipping. Drawn from the same category set as the Agent Identity
// step's "Demo: business category" control.
export const SERVICES_TYPE_CATEGORIES = ['Services', 'Health']

export const SAMPLE_BUSINESS_PROFILE: Partial<BusinessState> = {
  businessDescription:
    'We are a family run home decor and textiles shop, serving customers across India since 2015. Known for hand block printed bedsheets, cushion covers and curtains.',
  paymentMethods: ['cod', 'upi', 'cards'],
  paymentOtherText: '',
  paymentSource: 'chips',
  paymentPlainText: '',
  returnPolicy:
    '7 day returns on unused items with original packaging. Refunds go back to the original payment method within 5 working days. No returns on innerwear or customised items.',
  purchaseInfo:
    'Order on our website or right here on WhatsApp. Share the product name and your address, and we will confirm price and delivery time before you pay.',
  deliveryAndShipping:
    'We deliver across India. Metro cities in 2 to 3 days, everywhere else in 5 to 7 days. Free delivery on orders above Rs 999, otherwise Rs 49.',
  contactEmail: 'support@aurorahome.com',
  businessAddress: 'Shop 4, Link Road, Bandra West, Mumbai 400050',
  businessHours: [
    { day: 'Mon', closed: false, open: '09:00', close: '18:00' },
    { day: 'Tue', closed: false, open: '09:00', close: '18:00' },
    { day: 'Wed', closed: false, open: '09:00', close: '18:00' },
    { day: 'Thu', closed: false, open: '09:00', close: '18:00' },
    { day: 'Fri', closed: false, open: '09:00', close: '18:00' },
    { day: 'Sat', closed: false, open: '10:00', close: '14:00' },
    { day: 'Sun', closed: true, open: '', close: '' },
  ],
  businessHoursEnabled: true,
}

export const SAMPLE_PAYMENT_TEXT_FROM_ELSEWHERE =
  'We accept UPI, Google Pay and cash on delivery for orders under Rs 5000.'

export const TONE_PRESETS: {
  id: ToneId
  label: string
  description: string
}[] = [
  { id: 'professional', label: 'Professional', description: 'Polished, precise, minimal small talk.' },
  { id: 'enthusiastic', label: 'Enthusiastic', description: 'Warm and upbeat, still on-topic.' },
  { id: 'informal', label: 'Informal', description: 'Casual, conversational, brand-friendly.' },
  { id: 'custom', label: 'Custom', description: 'Write your own tone instructions.' },
]

// Leads with the languages relevant to this market, in the required order, before the rest of
// the world's languages alphabetically. Hinglish is deliberately excluded — mixing is handled by
// the "allow mixed-language replies" checkbox, not a separate language entry.
export const LANGUAGE_OPTIONS = [
  'English',
  'Hindi',
  'Tamil',
  'Telugu',
  'Marathi',
  'Bengali',
  'Kannada',
  'Gujarati',
  'Malayalam',
  'Punjabi',
  'Odia',
  'Urdu',
  'Arabic',
  'Chinese',
  'Dutch',
  'French',
  'German',
  'Indonesian',
  'Italian',
  'Japanese',
  'Korean',
  'Portuguese',
  'Russian',
  'Spanish',
  'Thai',
  'Turkish',
  'Vietnamese',
]


// ---- Personality and Skills, Section B: custom skills ----

// Placeholder templates for the prototype. `retailSuggested` drives which group ("Suggested for
// your business" vs "All templates") a card lands in under a retail-type vs services-type
// business category — see SERVICES_TYPE_CATEGORIES.
export const SKILL_TEMPLATES: { name: string; instruction: string; retailSuggested: boolean }[] = [
  {
    name: 'Handling discount requests',
    instruction:
      'When a customer asks for a discount, explain that prices are fixed for [product category], but let them know about any current promotion if one is running.',
    retailSuggested: true,
  },
  {
    name: 'Out of stock requests',
    instruction:
      'When a product is out of stock, apologise, say when it is expected back if known, and offer [a similar product] instead.',
    retailSuggested: true,
  },
  {
    name: 'Order cancellation requests',
    instruction:
      'When a customer wants to cancel an order, check if it has shipped, and if not, cancel it and confirm the refund will be processed within [refund timeframe].',
    retailSuggested: true,
  },
  {
    name: 'Handling delivery complaints',
    instruction:
      'When a customer reports a late or damaged delivery, apologise, ask for the order number, and offer [a replacement or refund] depending on the situation.',
    retailSuggested: true,
  },
  {
    name: 'Handling warranty questions',
    instruction:
      'When a customer asks about warranty, explain that products carry a [warranty period] warranty and ask for their order number.',
    retailSuggested: false,
  },
  {
    name: 'Angry customer handling',
    instruction:
      'When a customer is upset, acknowledge their frustration, apologise for the experience, and offer to connect them with [a person or the support team] if you cannot resolve it.',
    retailSuggested: false,
  },
  {
    name: 'Asking for reviews',
    instruction:
      'After confirming an order is delivered and the customer is happy, ask if they would leave a review on [review platform].',
    retailSuggested: false,
  },
  {
    name: 'Appointment rescheduling',
    instruction:
      'When a customer wants to reschedule, ask for their preferred new date and time, and confirm availability before offering [alternative slots].',
    retailSuggested: false,
  },
]

export const SAMPLE_CUSTOM_SKILLS: { name: string; instruction: string }[] = [
  {
    name: 'Handling warranty questions',
    instruction: 'When a customer asks about warranty, explain that all products carry a 1 year warranty and ask for their order number.',
  },
  {
    name: 'Out of stock requests',
    instruction: 'When a product is out of stock, apologise, say when it is expected back if known, and offer a similar product.',
  },
  {
    name: 'Handling discount requests',
    instruction: 'When a customer asks for a discount, explain that prices are fixed, but mention the current loyalty program.',
  },
  {
    name: 'Angry customer handling',
    instruction: 'When a customer is upset, acknowledge their frustration, apologise for the experience, and offer to connect them with a person.',
  },
]

export const USE_CASE_TEMPLATES: {
  id: string
  label: string
  description: string
  journeys: Array<'support' | 'commerce'>
  intents: Omit<IntentRow, 'id' | 'fromTemplate'>[]
}[] = [
  {
    id: 'order_tracking',
    label: 'Order tracking',
    description: 'Let customers check the status of an existing order.',
    journeys: ['commerce'],
    intents: [
      {
        name: 'Track order',
        triggerPhrases: ['where is my order', 'track my order', 'order status'],
        eligibleStates: ['Order placed', 'Shipped', 'Out for delivery'],
        action: 'Call: Check order status',
      },
    ],
  },
  {
    id: 'returns_refunds',
    label: 'Returns and refunds',
    description: 'Guide customers through a return or refund request.',
    journeys: ['commerce'],
    intents: [
      {
        name: 'Start a return',
        triggerPhrases: ['i want to return', 'refund my order', 'return this item'],
        eligibleStates: ['Delivered'],
        action: 'Reply: Share return policy',
      },
    ],
  },
  {
    id: 'address_change',
    label: 'Address change',
    description: 'Handle a request to update a delivery address.',
    journeys: ['commerce'],
    intents: [
      {
        name: 'Change delivery address',
        triggerPhrases: ['change my address', 'wrong delivery address', 'update shipping address'],
        eligibleStates: ['Order placed'],
        action: 'Escalate: Address change needed',
      },
    ],
  },
  {
    id: 'product_search',
    label: 'Product search',
    description: 'Help customers find a product from the catalog.',
    journeys: ['commerce'],
    intents: [
      {
        name: 'Find a product',
        triggerPhrases: ['do you have', 'looking for', 'in stock'],
        eligibleStates: ['Any'],
        action: 'Call: Search products',
      },
    ],
  },
  {
    id: 'appointment_booking',
    label: 'Appointment booking',
    description: 'Let customers book, reschedule, or cancel a visit.',
    journeys: ['support'],
    intents: [
      {
        name: 'Book an appointment',
        triggerPhrases: ['book an appointment', 'schedule a visit', 'reschedule'],
        eligibleStates: ['Any'],
        action: 'Reply: Share booking link',
      },
    ],
  },
]

export const CONNECTOR_TOOL_TEMPLATES: Record<Exclude<ConnectorType, null | 'custom_rest' | 'none'>, Omit<ConnectorTool, 'id' | 'enabled' | 'testStatus' | 'lastResponse'>[]> = {
  shopify: [
    { name: 'Check order status', description: 'Looks up an order by ID or customer phone number.' },
    { name: 'Create a cart', description: 'Creates a new cart and returns a checkout link.' },
    { name: 'Track a shipment', description: 'Returns carrier and tracking details for a shipped order.' },
  ],
  woocommerce: [
    { name: 'Check order status', description: 'Looks up an order by ID or customer phone number.' },
    { name: 'Track a shipment', description: 'Returns carrier and tracking details for a shipped order.' },
  ],
}

export const FOLLOW_UP_INTERVALS: { value: FollowUpInterval; label: string }[] = [
  { value: 0, label: 'Never follow up' },
  { value: 300, label: '5 minutes of silence' },
  { value: 900, label: '15 minutes of silence' },
  { value: 1800, label: '30 minutes of silence' },
  { value: 3600, label: '1 hour of silence' },
  { value: 7200, label: '2 hours of silence' },
  { value: 28800, label: '8 hours of silence' },
  { value: 86400, label: '24 hours of silence' },
]

export const FOLLOW_UP_ATTEMPT_OPTIONS: { value: FollowUpMaxAttempts; label: string }[] = [
  { value: 1, label: 'Once' },
  { value: 2, label: 'Twice, spacing out each attempt' },
  { value: 3, label: 'Up to 3 times, spacing out each attempt' },
]

export const DEFAULT_REPLIES = {
  greetingReply: "Hi! I'm here to help with orders, returns, and any questions about our products.",
  wrapUpHelpful: 'Glad I could help. Is there anything else you need?',
  wrapUpUnhelpful: "I'm sorry I couldn't fully resolve that. I can connect you with a team member if you'd like.",
  fallbackReply: "I didn't quite catch that. Could you rephrase, or ask about orders, returns, or products?",
  outOfHoursReply: "Thanks for reaching out. We're currently closed, but I can still help with common questions, and the team will follow up during business hours.",
  unsupportedMediaReply: "I can't read that file type yet. Could you describe what you need in text?",
  followUpMessage: "Just checking in, are you still there? Happy to help whenever you're ready.",
}

export const ALWAYS_PROTECTED_RULES = [
  'The agent will never claim to be human when directly asked.',
  'The agent will never request full payment card numbers, passwords, or OTPs in chat.',
  'The agent will never provide medical, legal, or financial advice beyond what is configured.',
  'The agent will always honour an explicit request to speak with a person.',
  'The agent will never disclose another customer\'s data.',
]

export const MOCK_APPROVERS = ['Priya Sharma', 'Rahul Mehta', 'Ananya Iyer']

export const DEFAULT_HANDOFF_MESSAGE =
  "You're being connected with a member of our team. They'll be with you shortly."

export const NEVER_SAY_EXAMPLES = [
  'guaranteed cure',
  'risk-free investment',
  'no side effects',
]

export const INJECTION_PATTERNS = [
  /ignore (all |any |previous |the )*instructions/i,
  /you are now/i,
  /system\s*:/i,
  /act as (a|an)/i,
  /disregard (your |the )*(rules|guidelines|prompt|instructions)/i,
  /reveal (your |the )*(prompt|system prompt|instructions)/i,
  /pretend (you are|to be)/i,
]

export function looksLikeInstruction(text: string): boolean {
  if (!text) return false
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text))
}

export const ACCEPTED_DOCUMENT_TYPES = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.csv', '.xlsx']
export const MAX_DOCUMENT_BYTES = 100_000_000

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

// ---- Step 1.3 Knowledge Base ----

// FAQ starter suggestions shown in the empty state, driven by the same "Demo: business category"
// control used on step 1. Services-type categories (see SERVICES_TYPE_CATEGORIES) get the services
// set; every other category, including "no category", falls back to the retail set.
export const FAQ_STARTER_SUGGESTIONS = {
  retail: [
    'What is your return policy?',
    'Do you deliver to my area?',
    'How do I track my order?',
    'What payment methods do you accept?',
  ],
  services: [
    'How do I book an appointment?',
    'What are your prices?',
    'Can I cancel or reschedule?',
    'Where are you located?',
  ],
}

export const SAMPLE_FAQS: { question: string; answer: string }[] = [
  { question: 'What is your return policy?', answer: '7 day returns on unused items with original packaging.' },
  { question: 'Do you deliver to my area?', answer: 'We deliver across India — metro cities in 2 to 3 days, everywhere else in 5 to 7 days.' },
  { question: 'How do I track my order?', answer: 'Share your order number here and we will look it up for you.' },
  { question: 'What payment methods do you accept?', answer: 'Cash on delivery, UPI, cards, and net banking.' },
  { question: 'Do you offer cash on delivery?', answer: 'Yes, cash on delivery is available on all orders under Rs 5000.' },
  { question: 'Can I change my delivery address after ordering?', answer: 'Yes, as long as the order has not shipped yet. Message us with the new address.' },
  { question: 'Do you have a physical store?', answer: 'Yes, our store is at Shop 4, Link Road, Bandra West, Mumbai.' },
  { question: 'What are your store timings?', answer: 'We are open Monday to Saturday, 9am to 6pm.' },
  { question: 'Is gift wrapping available?', answer: 'Yes, gift wrapping is free on all orders above Rs 999.' },
  { question: 'Do you ship internationally?', answer: 'Not yet — we currently only deliver within India.' },
  { question: 'How do I cancel my order?', answer: 'Message us with your order number within 2 hours of placing it and we will cancel it for you.' },
  { question: 'Do you offer bulk or wholesale pricing?', answer: 'Yes, message us with the quantity you need and we will share a quote.' },
]

export const SAMPLE_DOCUMENTS: { fileName: string; sizeBytes: number; type: string; daysAgo: number }[] = [
  { fileName: 'product-catalogue.pdf', sizeBytes: 4_200_000, type: '.pdf', daysAgo: 1 },
  { fileName: 'returns-policy.pdf', sizeBytes: 340_000, type: '.pdf', daysAgo: 3 },
  { fileName: 'store-locations.docx', sizeBytes: 88_000, type: '.docx', daysAgo: 12 },
]

export const SAMPLE_WEBSITES: { url: string; status: 'done' | 'failed'; pagesRead: number; daysAgo: number }[] = [
  { url: 'https://aurorahome.com', status: 'done', pagesRead: 47, daysAgo: 2 },
  { url: 'https://aurorahome.com/wholesale', status: 'failed', pagesRead: 0, daysAgo: 1 },
]

// ---- Step 3 Connections ----

export const CONNECTION_STATUS_META: Record<ConnectionStatus, { label: string; dot: 'success' | 'warning' | 'muted' }> = {
  // Meta connection_status: ACTIVE, PENDING_OAUTH, EXPIRED, ERROR (PRD AC-a13 labels).
  working: { label: 'Active', dot: 'success' },
  waiting_signin: { label: 'OAuth Pending', dot: 'warning' },
  key_rejected: { label: 'Expired', dot: 'warning' },
  having_problems: { label: 'Error', dot: 'warning' },
  not_tested: { label: 'Not tested yet', dot: 'muted' },
}

export interface RecipeValue {
  name: string
  type: ValueType
  location: ValueLocation
  source: ValueSource
  description: string
}

export interface RecipeAction {
  name: string
  description: string
  method: ActionMethod
  path: string
  values: RecipeValue[]
  setupSentence: string
}

export interface ConnectionRecipe {
  id: string
  name: string
  summary: string
  connectionName: string
  connectionDescription: string
  baseUrlPlaceholder: string
  actions: RecipeAction[]
}

// ---- Connections tab: Integrations sub-tab catalog ----
// Fifteen tools across four named categories (CRM, database and data, commerce, documentation)
// plus payments, support, and logistics — kept from the original pass since both are genuinely
// common needs for Helo's Retail and Services client base. Each entry's authPattern and setup
// steps reflect how that real vendor's API actually works, not a single copy-pasted OAuth
// template: Salesforce/HubSpot/Zoho/Google/Notion/Shopify redirect to the vendor's own login;
// self-hosted or dashboard-issued tools (WooCommerce, Magento, Razorpay, Stripe, Zendesk,
// Shiprocket, Airtable) generate a key the user pastes in; PostgreSQL takes connection details
// directly since there's no vendor to redirect to or key to generate.
export const INTEGRATION_CATALOG: IntegrationDef[] = [
  {
    id: 'salesforce',
    authFields: [],
    name: 'Salesforce',
    category: 'CRM',
    authPattern: 'oauth',
    description: 'Let your agent look up contacts, check case status, and create leads directly in your Salesforce org.',
    setupSteps: ['Click Install Integration', 'Sign in to Salesforce', 'Approve access for Helo'],
    tools: [
      { name: 'Find Contact', description: 'search by name, email, or phone' },
      { name: 'Create Lead', description: 'capture a new lead from the conversation' },
      { name: 'Get Case Status', description: 'check an existing support case' },
      { name: 'Update Opportunity', description: 'add a note or change stage on a deal' },
    ],
  },
  {
    id: 'hubspot',
    authFields: [],
    name: 'HubSpot',
    category: 'CRM',
    authPattern: 'oauth',
    description: 'Let your agent find contacts, log new leads, and open support tickets in HubSpot.',
    setupSteps: ['Click Install Integration', 'Sign in to HubSpot', 'Approve access for Helo'],
    tools: [
      { name: 'Find Contact', description: 'search the CRM by name or email' },
      { name: 'Create Contact', description: 'add a new contact from the conversation' },
      { name: 'Get Deal', description: 'check the stage of an existing deal' },
      { name: 'Create Support Ticket', description: 'log a new ticket' },
    ],
  },
  {
    id: 'zoho_crm',
    authFields: [],
    name: 'Zoho CRM',
    category: 'CRM',
    authPattern: 'oauth',
    description: 'Let your agent search leads, capture new ones, and check deal progress in Zoho CRM.',
    setupSteps: ['Click Install Integration', 'Sign in to Zoho', 'Approve access for Helo'],
    tools: [
      { name: 'Search Lead', description: 'find an existing lead' },
      { name: 'Create Lead', description: 'capture a new one from the conversation' },
      { name: 'Get Contact', description: 'retrieve contact details' },
      { name: 'Update Deal Stage', description: 'move a deal forward' },
    ],
  },
  {
    id: 'airtable',
    authFields: [{ id: 'token', label: 'Personal access token', type: 'password' }],
    name: 'Airtable',
    category: 'Database and data',
    authPattern: 'api_key',
    description: 'Let your agent look up, add, and update records in your Airtable bases.',
    setupSteps: [
      'Click Install Integration',
      'Generate a personal access token in your Airtable account settings',
      'Paste it in and choose which base to connect',
    ],
    tools: [
      { name: 'List Records', description: 'browse a table' },
      { name: 'Get Record', description: 'retrieve one record by ID' },
      { name: 'Search Records', description: 'find records matching a value' },
      { name: 'Create Record', description: 'add a new row' },
      { name: 'Update Record', description: 'change an existing one' },
    ],
  },
  {
    // ponytail: deliberately no general-purpose query tool here — free-form customer text turned
    // into raw SQL by the agent is a real injection/data-exposure risk. Scoped lookups only. When
    // this becomes a real integration, setup should also ask which tables/columns are allowed
    // before any tool is enabled — not built in this prototype pass.
    id: 'postgresql',
    authFields: [
      { id: 'host', label: 'Host', type: 'text', placeholder: 'db.yourbusiness.com' },
      { id: 'port', label: 'Port', type: 'text', placeholder: '5432' },
      { id: 'database', label: 'Database name', type: 'text' },
      { id: 'username', label: 'Username', type: 'text' },
      { id: 'password', label: 'Password', type: 'password' },
    ],
    name: 'PostgreSQL',
    category: 'Database and data',
    authPattern: 'direct_credentials',
    description: 'Let your agent look up information stored in your own database.',
    setupSteps: ['Click Install Integration', 'Enter your database host, port, name, and a username and password', 'Test the connection'],
    tools: [
      { name: 'Look Up Record', description: 'find one record by a known field, for example an order number or customer ID' },
      { name: 'Search a Table', description: 'find records matching a value in one named table' },
      { name: 'Get Table Structure', description: 'see what fields a table has' },
    ],
  },
  {
    id: 'google_sheets',
    authFields: [],
    name: 'Google Sheets',
    category: 'Database and data',
    authPattern: 'oauth',
    description: 'Let your agent read and update rows in a spreadsheet, a common lightweight way small businesses track orders or inventory.',
    setupSteps: ['Click Install Integration', 'Sign in to Google', 'Choose which spreadsheet to connect'],
    tools: [
      { name: 'Search Rows', description: 'find rows matching a value' },
      { name: 'Get Row', description: 'retrieve one row by its position or a key value' },
      { name: 'Append Row', description: 'add a new row' },
      { name: 'Update Row', description: 'change an existing one' },
    ],
  },
  {
    id: 'shopify',
    authFields: [{ id: 'domain', label: 'Store domain', type: 'text', placeholder: 'yourstore.myshopify.com' }],
    name: 'Shopify',
    category: 'Commerce',
    authPattern: 'oauth',
    description: 'Let your agent look up products, check stock, and manage carts directly from your Shopify store.',
    setupSteps: ['Click Install Integration', 'Enter your store domain', 'Authorise access'],
    tools: [
      { name: 'Search Products', description: 'search the catalog by keyword' },
      { name: 'Get Product', description: 'retrieve a product by name or ID' },
      { name: 'Check Stock', description: 'check current stock for a product' },
      { name: 'Create Cart', description: 'start a cart for a customer' },
    ],
  },
  {
    id: 'woocommerce',
    authFields: [
      { id: 'key', label: 'Consumer key', type: 'password' },
      { id: 'secret', label: 'Consumer secret', type: 'password' },
    ],
    name: 'WooCommerce',
    category: 'Commerce',
    authPattern: 'api_key',
    description: 'Let your agent look up products, check order status, and answer stock questions for your WooCommerce store.',
    setupSteps: ['Click Install Integration', 'Generate a REST API key pair in your WordPress WooCommerce settings', 'Paste the key and secret in'],
    tools: [
      { name: 'Search Products', description: 'search the catalog' },
      { name: 'Get Product', description: 'retrieve product details' },
      { name: 'Check Stock', description: 'check current stock' },
      { name: 'Get Order Status', description: 'look up an order by number' },
    ],
  },
  {
    id: 'magento',
    authFields: [{ id: 'token', label: 'Integration token', type: 'password' }],
    name: 'Magento',
    category: 'Commerce',
    authPattern: 'api_key',
    description: 'Let your agent search products, check inventory, and answer order questions for your Magento store.',
    setupSteps: ['Click Install Integration', 'Generate an integration token in your Magento admin panel', 'Paste it in'],
    tools: [
      { name: 'Search Products', description: 'search the catalog' },
      { name: 'Get Product Details', description: 'retrieve full product information' },
      { name: 'Check Inventory', description: 'check current stock' },
      { name: 'Get Order Status', description: 'look up an order by number' },
    ],
  },
  {
    id: 'google_docs',
    authFields: [],
    name: 'Google Docs',
    category: 'Documentation',
    authPattern: 'oauth',
    description: "Let your agent search and read from documents you've written, for example an FAQ or a policy document kept outside this wizard.",
    setupSteps: ['Click Install Integration', 'Sign in to Google', 'Choose which documents or folder to connect'],
    tools: [
      { name: 'Search Documents', description: 'find documents by title or content' },
      { name: 'Get Document Contents', description: 'retrieve the text of one document' },
    ],
  },
  {
    id: 'notion',
    authFields: [],
    name: 'Notion',
    category: 'Documentation',
    authPattern: 'oauth',
    description: 'Let your agent search and read pages from your Notion workspace.',
    setupSteps: ['Click Install Integration', 'Sign in to Notion', 'Choose which pages or workspace to share'],
    tools: [
      { name: 'Search Pages', description: 'find pages by title or content' },
      { name: 'Get Page Contents', description: 'retrieve the text of one page' },
    ],
  },
  {
    id: 'razorpay',
    authFields: [
      { id: 'keyId', label: 'Key ID', type: 'text' },
      { id: 'keySecret', label: 'Key secret', type: 'password' },
    ],
    name: 'Razorpay',
    category: 'Payments',
    authPattern: 'api_key',
    description: 'Let your agent check payment and refund status for customer orders.',
    setupSteps: ['Click Install Integration', 'Generate a key ID and key secret in your Razorpay dashboard', 'Paste them in'],
    tools: [
      { name: 'Get Payment Status', description: 'check whether a payment succeeded' },
      { name: 'Get Order Details', description: 'retrieve order and payment information' },
      { name: 'Get Refund Status', description: 'check on a refund already issued' },
    ],
  },
  {
    id: 'stripe',
    authFields: [{ id: 'secretKey', label: 'Secret key', type: 'password' }],
    name: 'Stripe',
    category: 'Payments',
    authPattern: 'api_key',
    description: 'Let your agent check payment status and look up customer billing details.',
    setupSteps: ['Click Install Integration', 'Generate a secret key in your Stripe dashboard', 'Paste it in'],
    tools: [
      { name: 'Get Payment Status', description: 'check whether a charge succeeded' },
      { name: 'Get Customer', description: 'retrieve billing details' },
      { name: 'Get Invoice', description: 'look up an invoice by ID' },
    ],
  },
  {
    id: 'zendesk',
    authFields: [
      { id: 'subdomain', label: 'Zendesk subdomain', type: 'text', placeholder: 'acmecorp' },
      { id: 'token', label: 'API token', type: 'password' },
    ],
    name: 'Zendesk',
    category: 'Support',
    authPattern: 'api_key',
    description: 'Let your agent check ticket status and log new support requests.',
    setupSteps: ['Click Install Integration', 'Generate an API token in your Zendesk admin settings', 'Enter your subdomain and paste the token in'],
    tools: [
      { name: 'Search Tickets', description: 'find tickets by customer or keyword' },
      { name: 'Get Ticket Status', description: 'check where a ticket stands' },
      { name: 'Create Ticket', description: 'open a new one from the conversation' },
      { name: 'Add Comment to Ticket', description: 'update an existing one' },
    ],
  },
  {
    id: 'shiprocket',
    authFields: [
      { id: 'email', label: 'Account email', type: 'text' },
      { id: 'password', label: 'Account password', type: 'password' },
    ],
    name: 'Shiprocket',
    category: 'Logistics',
    authPattern: 'api_key',
    description: 'Let your agent track shipments and answer delivery questions.',
    setupSteps: ['Click Install Integration', 'Enter your Shiprocket account email and password to generate an access token', 'Confirm the connection'],
    tools: [
      { name: 'Track Shipment', description: 'get current status by tracking number' },
      { name: 'Get Shipping Rate', description: 'estimate delivery cost and time' },
      { name: 'Get Order Status', description: 'check where an order stands in fulfilment' },
    ],
  },
]

// Curated public MCP servers relevant to this audience — content is a later decision (see the
// Connections redesign spec), left empty so the gallery section renders structurally ready to
// populate without fabricating specific server URLs here.
export const KNOWN_MCP_SERVERS: { name: string; description: string; url: string }[] = []

export const CONNECTION_RECIPES: ConnectionRecipe[] = [
  {
    id: 'order_lookup',
    name: 'Order lookup (store system)',
    summary: "Look up an order's status and details by its order number.",
    connectionName: 'Our store system',
    connectionDescription: 'The store system that holds order records.',
    baseUrlPlaceholder: 'https://yourstore.example.com',
    actions: [
      {
        name: 'Look up an order',
        description: 'Use when a customer asks where their order is. Looks up the order by its number and returns its status.',
        method: 'GET',
        path: '/orders/{order_number}',
        values: [
          { name: 'order_number', type: 'text', location: 'path', source: 'conversation', description: 'The order number, which looks like ORD-12345.' },
        ],
        setupSentence: 'Look up an order using the order number a customer gives.',
      },
    ],
  },
  {
    id: 'delivery_status',
    name: 'Delivery status (courier)',
    summary: 'Check where a delivery is and when it will arrive.',
    connectionName: 'Our courier',
    connectionDescription: 'The courier system that tracks shipments.',
    baseUrlPlaceholder: 'https://api.yourcourier.example.com',
    actions: [
      {
        name: 'Check delivery status',
        description: 'Use when a customer asks about their delivery. Looks up the shipment by tracking number and returns its status.',
        method: 'GET',
        path: '/shipments/{tracking_number}',
        values: [
          { name: 'tracking_number', type: 'text', location: 'path', source: 'conversation', description: 'The tracking number the customer shares.' },
        ],
        setupSentence: 'Check delivery status using the tracking number a customer gives.',
      },
    ],
  },
  {
    id: 'stock_check',
    name: 'Stock check (inventory)',
    summary: 'Check whether a product is in stock and how many are left.',
    connectionName: 'Our inventory system',
    connectionDescription: 'The system that tracks product stock levels.',
    baseUrlPlaceholder: 'https://inventory.yourbusiness.example.com',
    actions: [
      {
        name: 'Check stock',
        description: 'Use when a customer asks if a product is available. Looks up stock by product code and returns how many are left.',
        method: 'GET',
        path: '/products/{product_code}/stock',
        values: [
          { name: 'product_code', type: 'text', location: 'path', source: 'conversation', description: 'The product code or name the customer mentions.' },
        ],
        setupSentence: 'Check stock using the product code a customer mentions.',
      },
    ],
  },
  {
    id: 'booking_check',
    name: 'Booking check (appointments)',
    summary: "Check an existing appointment's date, time and status.",
    connectionName: 'Our booking system',
    connectionDescription: 'The system that holds appointment bookings.',
    baseUrlPlaceholder: 'https://yourbookings.example.com',
    actions: [
      {
        name: 'Check a booking',
        description: 'Use when a customer asks about an appointment. Looks up the booking by its reference and returns its details.',
        method: 'GET',
        path: '/bookings/{booking_reference}',
        values: [
          { name: 'booking_reference', type: 'text', location: 'path', source: 'conversation', description: 'The booking reference the customer gives.' },
        ],
        setupSentence: 'Check a booking using the reference number a customer gives.',
      },
    ],
  },
  {
    id: 'customer_lookup',
    name: 'Customer account lookup (CRM)',
    summary: "Look up a customer's account details from their phone number.",
    connectionName: 'Our CRM',
    connectionDescription: 'The customer records system.',
    baseUrlPlaceholder: 'https://crm.yourbusiness.example.com',
    actions: [
      {
        name: 'Look up a customer',
        description: "Use at the start of a conversation to recognise a returning customer. Looks up the customer's account by their WhatsApp number.",
        method: 'GET',
        path: '/customers/{phone_number}',
        values: [
          { name: 'phone_number', type: 'text', location: 'path', source: 'whatsapp_number', description: '' },
        ],
        setupSentence: "Look up a customer's account using their WhatsApp number automatically.",
      },
    ],
  },
  {
    id: 'lead_capture',
    name: 'Lead capture (CRM)',
    summary: "Save a new lead's name and contact details when a customer shows interest.",
    connectionName: 'Our CRM',
    connectionDescription: 'The customer records system.',
    baseUrlPlaceholder: 'https://crm.yourbusiness.example.com',
    actions: [
      {
        name: 'Save a new lead',
        description: "Use when a customer shows interest in a product or service and shares their name and contact details. Saves them as a new lead.",
        method: 'POST',
        path: '/leads',
        values: [
          { name: 'customer_name', type: 'text', location: 'body', source: 'conversation', description: "The customer's name." },
          { name: 'contact_detail', type: 'text', location: 'body', source: 'conversation', description: 'A phone number or email the customer shares.' },
        ],
        setupSentence: 'Save a new lead using the name and contact details a customer shares.',
      },
    ],
  },
  {
    id: 'payment_status',
    name: 'Payment status (payments)',
    summary: 'Check whether a payment or invoice has been received.',
    connectionName: 'Our payments system',
    connectionDescription: 'The system that records payments and invoices.',
    baseUrlPlaceholder: 'https://payments.yourbusiness.example.com',
    actions: [
      {
        name: 'Check payment status',
        description: 'Use when a customer asks if their payment went through. Looks up the payment by its reference and returns its status.',
        method: 'GET',
        path: '/payments/{reference}',
        values: [
          { name: 'reference', type: 'text', location: 'path', source: 'conversation', description: 'The payment or invoice reference the customer gives.' },
        ],
        setupSentence: 'Check payment status using the reference a customer gives.',
      },
    ],
  },
  {
    id: 'abandoned_cart_recovery',
    name: 'Abandoned cart recovery (store system)',
    summary: "Check what is still sitting in a customer's cart so you can help them finish checking out.",
    connectionName: 'Our store system',
    connectionDescription: 'The store system that holds order records and stock levels.',
    baseUrlPlaceholder: 'https://yourstore.example.com',
    actions: [
      {
        name: 'Check an abandoned cart',
        description: 'Use when a customer asks about items they were about to buy. Looks up their cart and returns what is in it.',
        method: 'GET',
        path: '/carts/{cart_reference}',
        values: [
          { name: 'cart_reference', type: 'text', location: 'path', source: 'conversation', description: 'The cart or checkout reference, if the customer has one.' },
        ],
        setupSentence: 'Check an abandoned cart using its reference number.',
      },
    ],
  },
]

function recipeById(id: string): ConnectionRecipe {
  const recipe = CONNECTION_RECIPES.find((r) => r.id === id)
  if (!recipe) throw new Error(`Unknown recipe id: ${id}`)
  return recipe
}

export interface SampleConnectionSeed {
  name: string
  description: string
  baseUrl: string
  demoStatus: ConnectionStatus
  actions: RecipeAction[]
  withActivity: boolean
}

export const SAMPLE_CONNECTIONS: SampleConnectionSeed[] = [
  {
    name: 'Our store system',
    description: 'The store system that holds order records and stock levels.',
    baseUrl: 'https://yourstore.example.com',
    demoStatus: 'working',
    actions: [recipeById('order_lookup').actions[0], recipeById('stock_check').actions[0]],
    withActivity: true,
  },
  {
    name: 'Our CRM',
    description: 'The customer records system.',
    baseUrl: 'https://crm.yourbusiness.example.com',
    demoStatus: 'key_rejected',
    actions: [recipeById('customer_lookup').actions[0]],
    withActivity: false,
  },
]

// ---- Connections step: interactive "try a message" preview (see connections-step-spec addendum) ----

/** 2-3 canned reply lines per ready-made setup category, plus a generic fallback for actions that
 *  don't map to any known category (a custom-built action whose wording doesn't match a keyword). */
export const CONNECTION_PREVIEW_REPLIES: Record<string, string[]> = {
  order_lookup: [
    "Let me check your order... it shipped yesterday and should arrive by Thursday.",
    "Checking now... your order is being packed and should ship within 24 hours.",
    "Found it — your order is out for delivery today.",
  ],
  delivery_status: [
    "Let me check... your delivery is on its way and should arrive by tomorrow evening.",
    "Checking the courier now... it's currently at the local depot, out for delivery today.",
    "Your delivery was marked as delivered this morning.",
  ],
  stock_check: [
    "Let me check... yes, we have that in stock.",
    "Checking now... we have a few left in stock.",
    "That one's currently out of stock, but more is expected next week.",
  ],
  booking_check: [
    "Let me check... your appointment is confirmed for Thursday at 2pm.",
    "Checking now... you're booked in for tomorrow morning.",
    "Found your booking — it's confirmed and all set.",
  ],
  customer_lookup: [
    "Let me pull up your account... found you! You've got two previous orders with us.",
    "Checking your account now... everything looks up to date.",
    "Found your details — happy to help with anything on your account.",
  ],
  lead_capture: [
    "Thanks for your interest! I've saved your details and someone will follow up shortly.",
    "Got it — I've noted your details, we'll be in touch soon.",
    "Thanks! I've passed your details along to the team.",
  ],
  payment_status: [
    "Let me check... your payment went through successfully.",
    "Checking now... that invoice was paid yesterday.",
    "Your payment is showing as received on our end.",
  ],
  abandoned_cart_recovery: [
    "Let me check... you still have a couple of items waiting in your cart.",
    "Checking now... your cart is saved — want help finishing checkout?",
    "Found your cart — everything's still there whenever you're ready.",
  ],
  generic: [
    "Let me check... yes, that's sorted for you.",
    "Checking now... all good on that.",
  ],
}

/** Trigger words used two ways: matching a customer message to an action, and (for actions on a
 *  custom-built connection with no recipe origin) guessing which reply category applies. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  order_lookup: ['order'],
  delivery_status: ['delivery', 'shipment', 'shipping', 'tracking', 'courier'],
  stock_check: ['stock', 'inventory', 'available'],
  booking_check: ['book', 'booking', 'appointment', 'schedule'],
  customer_lookup: ['account', 'customer', 'crm'],
  lead_capture: ['lead', 'interested', 'contact', 'signup'],
  payment_status: ['payment', 'invoice', 'paid'],
  abandoned_cart_recovery: ['cart', 'checkout'],
}

const PREVIEW_STOPWORDS = new Set([
  'this', 'that', 'have', 'your', 'with', 'from', 'want', 'need', 'does', 'they', 'them',
  'what', 'when', 'will', 'about', 'there', 'been', 'were', 'which', 'could', 'would',
  'should', 'also', 'just', 'like', 'please', 'know', 'here', 'still',
])

function previewMessageKeywords(message: string): string[] {
  return Array.from(
    new Set(
      message
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !PREVIEW_STOPWORDS.has(w)),
    ),
  )
}

export interface PreviewActionMatch {
  action: ConnectionAction
  connection: Connection
}

/** Simple keyword matching for the prototype: a message matches an action if any word in the
 *  message also appears in that action's name or description. */
export function matchConnectionPreviewMessage(
  message: string,
  connections: Connection[],
  actions: ConnectionAction[],
): PreviewActionMatch[] {
  const words = previewMessageKeywords(message)
  if (words.length === 0) return []
  const matches: PreviewActionMatch[] = []
  for (const action of actions) {
    const connection = connections.find((c) => c.id === action.connectionId)
    if (!connection) continue
    const haystack = `${action.name} ${action.description}`.toLowerCase()
    if (words.some((w) => haystack.includes(w))) matches.push({ action, connection })
  }
  return matches
}

function previewCategoryFor(match: PreviewActionMatch): string {
  if (match.connection.createdFromRecipe && CONNECTION_PREVIEW_REPLIES[match.connection.createdFromRecipe]) {
    return match.connection.createdFromRecipe
  }
  const haystack = `${match.action.name} ${match.action.description}`.toLowerCase()
  const found = Object.entries(CATEGORY_KEYWORDS).find(([, keywords]) => keywords.some((k) => haystack.includes(k)))
  return found?.[0] ?? 'generic'
}

export function pickConnectionPreviewReply(match: PreviewActionMatch): string {
  const lines = CONNECTION_PREVIEW_REPLIES[previewCategoryFor(match)] ?? CONNECTION_PREVIEW_REPLIES.generic
  return lines[Math.floor(Math.random() * lines.length)]
}

/** Single canonical "what would the agent say" simulator, shared by the Preview page and the
 *  Simulations standard-checks runner — checks knowledge (FAQs) first, then connections/tools,
 *  then falls back to a greeting or the configured fallback reply. No real system is contacted. */
export function simulateAgentReply(
  state: Pick<WizardState, 'knowledge' | 'connections' | 'replies'>,
  message: string,
): string {
  const faqMatches = matchFaqPreviewMessage(message, state.knowledge.faqs)
  if (faqMatches.length > 0) return faqMatches[0].answer
  const connMatches = matchConnectionPreviewMessage(message, state.connections.connections, state.connections.actions)
  if (connMatches.length > 0) return pickConnectionPreviewReply(connMatches[0])
  if (/\b(hi|hello|hey)\b/i.test(message)) return state.replies.greetingReply
  return state.replies.fallbackReply
}

/** A real agent answers from its knowledge base as well as its connections, and that knowledge
 *  persists across the whole wizard (it's just wizard state), so the try-it preview checks FAQs
 *  too — matched against the question a customer would actually ask, not the answer text.
 *
 *  Whole-word matching, not substring: action matching intentionally treats "book" as matching
 *  "booking", but FAQ questions are full sentences a customer might quote closely, and substring
 *  matching there causes false hits between unrelated words that merely share a root — e.g. a
 *  message word "deliver" substring-matching a different FAQ's "delivery", turning an exact
 *  question match into a confusing three-way "did you mean". */
export function matchFaqPreviewMessage(message: string, faqs: FaqRow[]): FaqRow[] {
  const words = previewMessageKeywords(message)
  if (words.length === 0) return []
  return faqs.filter((faq) => {
    const questionWords = new Set(faq.question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/))
    return words.some((w) => questionWords.has(w))
  })
}

// ---- Step 1: Rich replies (the system underneath calls these "UI skills") ----

const RICH_REPLY_TYPES: { type: RichReplyType; name: string; description: string }[] = [
  { type: 'cta_url', name: 'Button with a link', description: 'One tappable button that opens a web page.' },
  { type: 'interactive_reply_buttons', name: 'Reply buttons', description: 'Up to three tap-to-answer buttons under a message.' },
  { type: 'image', name: 'Image', description: 'Sends a picture, with an optional caption.' },
  { type: 'interactive_list', name: 'Menu of choices', description: 'A tappable list the customer picks one option from.' },
  { type: 'carousel_url', name: 'Card carousel with links', description: 'Swipeable cards, each with a picture and a link button.' },
  { type: 'carousel_quick_reply', name: 'Card carousel with quick replies', description: 'Swipeable cards, each with a picture and a tap-to-answer button.' },
  { type: 'location', name: 'Your location on a map', description: 'Sends a map pin of where you are.' },
  { type: 'location_request', name: 'Ask for their location', description: 'Asks the customer to share where they are.' },
  { type: 'flow', name: 'WhatsApp form (Flow)', description: 'Opens a structured form the customer fills in, like a booking or survey.' },
]

/** WhatsApp Flows are out of scope for rich replies (PRD §4), so Flow is not offered for new
 *  replies; its label stays for any existing Flow row. */
export const RICH_REPLY_TYPE_GALLERY = RICH_REPLY_TYPES.filter((t) => t.type !== 'flow')

export const RICH_REPLY_TYPE_LABEL: Record<RichReplyType, string> = Object.fromEntries(
  RICH_REPLY_TYPES.map((t) => [t.type, t.name]),
) as Record<RichReplyType, string>

/** Canned WhatsApp Flows already "set up on this number" — the prototype has no real Flows API. */
export const CANNED_FLOWS = ['Book an appointment', 'Delivery feedback']

export function newMenuOption(): MenuOption {
  return { id: newId('option'), rowId: '', title: '', description: '', group: '' }
}

export function newCarouselCard(): CarouselCard {
  return { id: newId('card'), image: { kind: 'url', ref: '', label: '' }, cardText: '', buttonLabel: '', link: '' }
}

export function newApiKeyEntry(): ApiKeyEntry {
  return { id: newId('key'), value: '', location: 'header', fieldName: '', prefix: '' }
}

// Moved to richReplies.ts; re-exported so existing imports keep working.
export { compileRichReplySentence }

const SAMPLE_RR_1_TRIGGER = 'When someone asks where to buy online'
const SAMPLE_RR_1_BLANKS = {
  messageText: 'You can order directly from our website.',
  buttonLabel: 'Shop now',
  link: 'https://example.com/shop',
  footer: 'Free delivery over ₹999',
}

const SAMPLE_RR_2_TRIGGER = 'When someone asks what we sell'
const SAMPLE_RR_2_BLANKS = {
  messageText: "Here's what we offer:",
  menuButtonLabel: 'See options',
  groupsEnabled: false,
  options: [
    { id: newId('option'), rowId: 'candles', title: 'Candles', description: 'Scented and unscented', group: '' },
    { id: newId('option'), rowId: 'gift_sets', title: 'Gift sets', description: '', group: '' },
  ],
}

export const SAMPLE_RICH_REPLIES: RichReply[] = [
  {
    id: 'sample-rr-1',
    type: 'cta_url',
    name: 'Product page button',
    trigger: SAMPLE_RR_1_TRIGGER,
    enabled: true,
    createdAt: Date.now(),
    blanks: SAMPLE_RR_1_BLANKS,
    instructionSentence: compileRichReplySentence({ type: 'cta_url', trigger: SAMPLE_RR_1_TRIGGER, blanks: SAMPLE_RR_1_BLANKS }),
  },
  {
    id: 'sample-rr-2',
    type: 'interactive_list',
    name: 'Product categories menu',
    trigger: SAMPLE_RR_2_TRIGGER,
    enabled: false,
    createdAt: Date.now() - 1000,
    blanks: SAMPLE_RR_2_BLANKS,
    instructionSentence: compileRichReplySentence({ type: 'interactive_list', trigger: SAMPLE_RR_2_TRIGGER, blanks: SAMPLE_RR_2_BLANKS }),
  },
  {
    id: 'sample-rr-3',
    type: 'image',
    name: 'Product photo (legacy)',
    trigger: '',
    enabled: true,
    createdAt: Date.now() - 2000,
    blanks: null,
    instructionSentence: 'If a customer asks to see the product, send an image at https://example.com/product-photo.jpg',
  },
]

// ---- Step 4: Safety & handoff ----

/** A small built-in list of common near-variants (plurals, comparative/superlative forms, and a
 *  short list of close synonyms) for words businesses commonly want to avoid — maintained here
 *  rather than computed, since generic morphology guesses too wrong too often to be useful. */
export const WORD_VARIANT_SUGGESTIONS: Record<string, string[]> = {
  cheap: ['cheaper', 'cheapest'],
  guarantee: ['guaranteed', 'guarantees'],
  guaranteed: ['guarantee', 'guarantees'],
  free: ['freebie', 'freebies'],
  cure: ['cures', 'cured'],
  cures: ['cure', 'cured'],
  safe: ['safer', 'safest'],
  best: ['better'],
  discount: ['discounts', 'discounted'],
  sale: ['sales'],
  fast: ['faster', 'fastest'],
  easy: ['easier', 'easiest'],
  risky: ['riskier', 'riskiest'],
  promise: ['promised', 'promises'],
  miracle: ['miraculous'],
}

/** Suggestions for a just-added word/phrase, excluding anything already in the list
 *  (case-insensitive) — used to show the "Also add: X, Y?" row, never to add automatically. */
export function suggestWordVariants(word: string, existing: string[]): string[] {
  const key = word.toLowerCase().trim()
  const candidates = WORD_VARIANT_SUGGESTIONS[key] ?? []
  const existingNorm = new Set(existing.map((w) => w.toLowerCase().trim()))
  return candidates.filter((c) => !existingNorm.has(c))
}

export const SAMPLE_NEVER_SAY_WORDS = ['guaranteed', 'cheap', 'risk-free']
export const SAMPLE_TOPICS_TO_AVOID = ['Comparing us to specific competitors', 'Ongoing legal disputes']
export const SAMPLE_CUSTOM_HANDOFF_MESSAGE =
  "Let me get a member of our team to help you with this. They'll be with you shortly."

// ---- Shared category signal-matching mechanism ----
// Fixed, known list of things an agent can help with. Every composed sentence — whether from a
// business category default, a scanned document, or the setup front door's capability cards — is
// built only from these fragments. Nothing here is freely generated. Used by AgentIdentityStep's
// "Suggest for X" button and by the setup front door's role/description pre-fill.
export const SIGNAL_LIBRARY = {
  browse_products: 'browse products',
  check_stock: 'check stock',
  track_orders: 'track orders',
  start_return: 'start a return or exchange',
  book_appointments: 'book appointments',
  check_availability: 'check availability',
  services_pricing: 'answer questions about our services and pricing',
  browse_menu: 'browse the menu',
  todays_specials: "check today's specials",
  place_order: 'place an order',
  store_hours: 'find store hours',
  health_billing: 'get answers to common health and billing questions',
} as const

export type SignalId = keyof typeof SIGNAL_LIBRARY

export const CATEGORY_SUGGESTIONS: Record<string, SignalId[]> = {
  Retail: ['browse_products', 'check_stock', 'track_orders', 'start_return'],
  Services: ['book_appointments', 'check_availability', 'services_pricing'],
  'Food and Beverage': ['browse_menu', 'todays_specials', 'place_order', 'store_hours'],
  Health: ['book_appointments', 'health_billing'],
  'E-commerce': ['browse_products', 'track_orders', 'start_return'],
}

export const BUSINESS_CATEGORY_OPTIONS = ['Retail', 'Services', 'Food and Beverage', 'Health', 'E-commerce', 'No category']

export function composeSentence(signalIds: SignalId[]): string {
  const fragments = signalIds.map((id) => SIGNAL_LIBRARY[id])
  if (fragments.length === 0) return ''
  if (fragments.length === 1) return `Helps customers ${fragments[0]}.`
  if (fragments.length === 2) return `Helps customers ${fragments[0]} and ${fragments[1]}.`
  const head = fragments.slice(0, -1).join(', ')
  const tail = fragments[fragments.length - 1]
  return `Helps customers ${head}, and ${tail}.`
}

// Same honesty rule as composeSentence above: a fixed sentence per category, never freely
// generated. Used by the setup front door to pre-fill Business details' description field.
const BUSINESS_DESCRIPTION_TEMPLATES: Record<string, string> = {
  Retail: 'We sell products and help customers browse, order, and manage returns.',
  Services: 'We provide bookable services and help customers schedule appointments and get pricing information.',
  'Food and Beverage': 'We serve food and drink and help customers browse the menu, check specials, and place orders.',
  Health: 'We provide health services and help patients book appointments and answer billing questions.',
  'E-commerce': 'We sell products online and help customers browse, track orders, and manage returns.',
}

export function composeBusinessDescription(category: string): string {
  return BUSINESS_DESCRIPTION_TEMPLATES[category] ?? ''
}

// ---- Setup front door ----

export const PERSONA_OPTIONS: { id: PersonaId; title: string; helper: string }[] = [
  { id: 'owner', title: 'I run the business', helper: 'Show me the simple path first' },
  { id: 'support_ops', title: 'I handle support or operations', helper: 'Show me the day to day setup' },
  { id: 'client_setup', title: "I'm setting this up for a client", helper: 'Show me everything, I know my way around' },
  { id: 'developer', title: "I'm a developer", helper: 'Show me the technical options up front' },
  { id: 'exploring', title: 'Just exploring', helper: "Keep it light, I'll dig in later" },
]

/** Personas who want more control up front — Connections defaults to the custom-connection path
 *  and advanced fields default open, rather than tucked behind their "advanced" links. */
export const ADVANCED_PERSONAS: PersonaId[] = ['client_setup', 'developer']

export interface CapabilityCard {
  id: string
  title: string
  helper: string
  /** Contributes to the role-sentence composed by composeSentence, on top of the category default. */
  signalId?: SignalId
  /** Which FAQ_STARTER_SUGGESTIONS bucket this capability draws its starter questions from. */
  faqBucket?: 'retail' | 'services'
}

const RETAIL_CAPABILITY_CARDS: CapabilityCard[] = [
  {
    id: 'answer_questions',
    title: 'Answer common questions',
    helper: 'Starter FAQ questions and a knowledge section ready to fill in',
    faqBucket: 'retail',
  },
  {
    id: 'track_orders',
    title: 'Track orders',
    helper: 'A ready-made connection to your order system, once you add your details',
    signalId: 'track_orders',
  },
  {
    id: 'check_stock',
    title: 'Check stock',
    helper: 'A ready-made connection to your inventory, once you add your details',
    signalId: 'check_stock',
  },
  {
    id: 'delivery_returns',
    title: 'Explain delivery and returns',
    helper: 'Starter fields ready to fill in on your business details',
    signalId: 'start_return',
  },
]

const SERVICES_CAPABILITY_CARDS: CapabilityCard[] = [
  {
    id: 'answer_questions',
    title: 'Answer common questions',
    helper: 'Starter FAQ questions and a knowledge section ready to fill in',
    faqBucket: 'services',
  },
  {
    id: 'book_appointments',
    title: 'Book appointments',
    helper: 'A ready-made connection to your booking system, once you add your details',
    signalId: 'book_appointments',
  },
  {
    id: 'answer_pricing',
    title: 'Answer questions about pricing',
    helper: 'Starter FAQ questions about your pricing, ready to fill in',
    signalId: 'services_pricing',
    faqBucket: 'services',
  },
  {
    id: 'delivery_returns',
    title: 'Explain delivery and returns',
    helper: 'Starter fields ready to fill in on your business details',
    signalId: 'start_return',
  },
]

/** Same binary category logic already used for FAQ starters and the Business Profile layout —
 *  see SERVICES_TYPE_CATEGORIES. */
export function getCapabilityCards(category: string): CapabilityCard[] {
  return SERVICES_TYPE_CATEGORIES.includes(category) ? SERVICES_CAPABILITY_CARDS : RETAIL_CAPABILITY_CARDS
}

// ---- Agent Activity page ----

/** Meta's six real status values for a submitted business event, mapped to plain words and a
 *  Badge treatment. Never invented values — this is the full set the platform returns.
 *
 *  `sent` and `success` are genuinely different terminal-ish states (see agent-activity-page-spec
 *  override, section 1), not a redundant pair — so they get visually distinct success tones:
 *  `sent` a lighter tint ("dispatched, not yet confirmed"), `success` the full solid tone
 *  ("confirmed delivered"), rather than collapsing them into one look. */
export const AGENT_EVENT_STATUS_META: Record<AgentEventStatus, { label: string; badgeVariant: 'secondary' | 'destructive'; badgeClassName?: string }> = {
  request_received: { label: 'Received', badgeVariant: 'secondary' },
  processing: { label: 'Processing', badgeVariant: 'secondary' },
  sent: { label: 'Sent', badgeVariant: 'secondary', badgeClassName: 'bg-success/15 text-success' },
  success: { label: 'Delivered', badgeVariant: 'secondary', badgeClassName: 'bg-success text-success-foreground' },
  failed: { label: 'Failed', badgeVariant: 'destructive' },
  skipped: { label: 'Skipped', badgeVariant: 'secondary', badgeClassName: 'bg-warning/15 text-warning-foreground' },
}

export function formatFullTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** Table "Time" column: relative within the last day, short absolute after that — never shows a
 *  year, since these are recent operational events, not historical records. */
export function formatEventTime(timestamp: number): string {
  const diffMin = Math.floor((Date.now() - timestamp) / 60_000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  return new Date(timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

/** Detail panel's "Received" / "Last updated" — same short-absolute shape as formatEventTime but
 *  always absolute and down to the second, since this is where the precise time actually matters. */
export function formatEventTimestampPrecise(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

/** "Took 16 seconds" — a real, honestly computed duration between two real timestamps, never
 *  invented latency. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

export function newWebhookUrl(): string {
  return `https://hooks.helo.ai/agent-events/${Math.random().toString(36).slice(2, 10)}`
}

export function newSecretKey(): string {
  return `whsec_${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
}

export function buildDeveloperEventsChecklist(webhookUrl: string, secretKey: string, eventTypes: AgentEventTypeDef[]): string {
  return [
    'To send business events to our agent, please share this with your developer:',
    `- Webhook endpoint: ${webhookUrl}`,
    `- Secret key: ${secretKey}`,
    eventTypes.length > 0
      ? `- Event types we expect: ${eventTypes.map((t) => t.name).join(', ')}`
      : '- Event types we expect: none defined yet',
    '- Sign every request with the secret key so we can verify it came from you',
  ].join('\n')
}

export const SAMPLE_AGENT_EVENT_TYPES: { name: string; description: string }[] = [
  { name: 'payment_received', description: 'A customer completed payment for their order.' },
  { name: 'document_verified', description: 'A submitted document passed verification.' },
  { name: 'shipping_update', description: 'An order changed shipping status.' },
  { name: 'refund_issued', description: 'A refund was processed for an order.' },
  { name: 'appointment_reminder', description: 'An upcoming appointment needs a reminder sent.' },
]

const SAMPLE_EVENT_RECIPIENTS = ['+91 98765 43210', '+91 91234 56789', '+91 90000 11122', '+91 99887 76655', '+91 90011 22334']

const SAMPLE_FAILURE_REASONS = ['Signature verification failed.', "Could not reach the customer's conversation.", 'The payload was missing a required field.']
const SAMPLE_SKIP_REASONS = ['The conversation was already closed.', 'No matching customer found for this recipient.', 'This event arrived after the conversation window closed.']

/** One event-type's flavour text and a sample payload shape, for building a demo log that reads
 *  as real traffic rather than "Sample event 7". Weighted toward payment_received, same as most
 *  live agents actually see — not a flat/uniform distribution, so the "most common event types"
 *  chart has something real to show. */
const SAMPLE_EVENT_DEFS: { eventType: string; weight: number; describe: () => string; payload: () => string }[] = [
  {
    eventType: 'payment_received',
    weight: 10,
    describe: () => `Payment confirmed for order ${1000 + Math.floor(Math.random() * 9000)}`,
    payload: () => JSON.stringify({ order_id: String(1000 + Math.floor(Math.random() * 9000)), amount: (Math.random() * 5000).toFixed(2), currency: 'INR' }),
  },
  {
    eventType: 'document_verified',
    weight: 6,
    describe: () => 'Identity document verified',
    payload: () => JSON.stringify({ document_type: 'aadhaar', result: 'pass' }),
  },
  {
    eventType: 'shipping_update',
    weight: 6,
    describe: () => 'Order shipped',
    payload: () => `order_id=${1000 + Math.floor(Math.random() * 9000)};carrier=Delhivery;status=in_transit`,
  },
  {
    eventType: 'refund_issued',
    weight: 4,
    describe: () => `Refund issued for order ${1000 + Math.floor(Math.random() * 9000)}`,
    payload: () => JSON.stringify({ order_id: String(1000 + Math.floor(Math.random() * 9000)), refund_amount: (Math.random() * 2000).toFixed(2) }),
  },
  {
    eventType: 'appointment_reminder',
    weight: 4,
    describe: () => 'Appointment reminder due tomorrow',
    payload: () => `appointment_id=apt_${Math.random().toString(36).slice(2, 8)};when=tomorrow_10am`,
  },
]

/** ~30 events across all six real statuses, several real event types, spread over a two-week
 *  window — enough for every chart in the monitoring view to render meaningfully, per the demo
 *  controls this feature calls for. */
export function buildSampleAgentEventLog(): AgentEventRow[] {
  const typePool = SAMPLE_EVENT_DEFS.flatMap((def) => Array(def.weight).fill(def))
  // 30 slots across the six real statuses — success dominant (the common case), with at least a
  // few of the other five so every status renders somewhere in the sample.
  const statusPool: AgentEventStatus[] = [
    ...Array(13).fill('success'),
    ...Array(4).fill('sent'),
    ...Array(4).fill('processing'),
    ...Array(3).fill('request_received'),
    ...Array(3).fill('failed'),
    ...Array(3).fill('skipped'),
  ]

  const now = Date.now()
  return statusPool.map((status, i) => {
    const def = typePool[i % typePool.length]
    const createdAt = now - Math.floor(Math.random() * 14 * 86_400_000) - Math.floor(Math.random() * 86_400_000)
    const processedMs = status === 'request_received' ? 0 : Math.floor(2_000 + Math.random() * 60_000)
    const row: AgentEventRow = {
      id: newId('aevent'),
      agentEventId: newId('meta_evt'),
      eventType: def.eventType,
      description: def.describe(),
      to: SAMPLE_EVENT_RECIPIENTS[Math.floor(Math.random() * SAMPLE_EVENT_RECIPIENTS.length)],
      status,
      createdAt,
      updatedAt: createdAt + processedMs,
      payload: def.payload(),
    }
    if (status === 'failed') row.errorMessage = SAMPLE_FAILURE_REASONS[Math.floor(Math.random() * SAMPLE_FAILURE_REASONS.length)]
    if (status === 'skipped') row.skippedReason = SAMPLE_SKIP_REASONS[Math.floor(Math.random() * SAMPLE_SKIP_REASONS.length)]
    return row
  })
}

export const SAMPLE_QUALITY_CHECK_RUN: { situation: string; sent: string; reply: string; status: 'normal' | 'warn' }[] = [
  { situation: 'Greeting', sent: 'Hi', reply: 'Hi there! How can I help you today?', status: 'normal' },
  { situation: 'A question from your FAQ', sent: 'What is your return policy?', reply: '7 day returns on unused items with original packaging.', status: 'normal' },
  { situation: 'Something outside what you sell', sent: 'Can you help me file my taxes?', reply: "That's outside what I can help with here.", status: 'normal' },
  { situation: 'Asking for a person', sent: 'Can I talk to a real person?', reply: "I'll connect you with someone from our team.", status: 'warn' },
]

// ---- Agent Activity page: Conversations (real customer lookup) ----

/** "1.8s" — sub-second precision, unlike formatDuration's whole-unit rounding, since a response
 *  time this short is the whole point of showing it. */
export function formatLatencySeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/** "Today, 2:47 PM" for the current calendar day, "Aug 18, 2:47 PM" otherwise. */
export function formatConversationTurnTime(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return `Today, ${time}`
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

// Same recipient number used elsewhere in this sample data, so the two demo surfaces read as the
// same customer rather than unrelated placeholder numbers.
export const SAMPLE_CONVERSATION_NUMBER = '+91 98765 43210'

export function buildSampleConversationTurns(): ConversationTurn[] {
  const now = Date.now()
  return [
    { timestamp: now - 90_000, e2eLatencyMs: 1800, tool: 'check_stock', toolWorked: true },
    { tool: 'check_stock' },
  ]
}

// For "Demo: simulate a slow or failed turn" — appended to whatever conversation is currently
// shown, so the plain-language treatment of a bad turn can be reviewed without a fresh lookup.
export function buildSlowOrFailedTurn(): ConversationTurn {
  return { timestamp: Date.now(), e2eLatencyMs: 14_200, tool: 'check_stock', toolWorked: false }
}

const SUBPAGE_SEGMENTS = [
  'about', 'contact', 'products', 'services', 'faq', 'blog', 'pricing',
  'support', 'returns', 'shipping', 'privacy-policy', 'terms', 'careers',
  'reviews', 'help', 'locations', 'gallery', 'testimonials', 'catalog', 'store',
]

/** Fake sub-level navigation paths for a crawled site, one per page the mock crawl "read". */
export function generateFakeSubpages(baseUrl: string, count: number): string[] {
  const root = baseUrl.replace(/\/$/, '')
  return Array.from({ length: count }, (_, i) => {
    const segment = SUBPAGE_SEGMENTS[i % SUBPAGE_SEGMENTS.length]
    const suffix = i >= SUBPAGE_SEGMENTS.length ? `-${Math.floor(i / SUBPAGE_SEGMENTS.length) + 1}` : ''
    return `${root}/${segment}${suffix}`
  })
}
