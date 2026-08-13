export type StepId = 'agent' | 'knowledge' | 'connections' | 'safety' | 'publish'

// ---- Agent studio shell (persistent sidebar, free navigation instead of a forced stepper) ----
// Parallel to StepId above: StepId still drives the per-slice save-on-Next/pendingStepFocus
// machinery, while StudioSectionId drives which studio page is showing. See studioNav.ts.
export type StudioSectionId =
  | 'overview'
  | 'identity'
  | 'personality'
  | 'skills'
  | 'richReplies'
  | 'knowledge'
  | 'connections'
  | 'safety'
  | 'publish'
  | 'activity'

export interface StepMeta {
  id: StepId
  index: number
  label: string
  /** Small grey label shown next to the nav item — only "Connections" has one. */
  optionalTag?: boolean
}

// ---- Step 1.0 Gate ----
export interface WabaNumber {
  id: string
  phoneNumber: string
  displayName: string
  vertical: string
  status: 'eligible' | 'ineligible' | 'needs_registration'
  registered: boolean
  billingAttached: boolean
}

export interface GateState {
  selectedWabaId: string | null
  /** Phone number and WABA name, captured directly so display doesn't depend on a MOCK_WABAS lookup
   *  (needed since the Create Agent modal draws from its own WABA directory). */
  selectedPhoneNumber: string | null
  selectedWabaName: string | null
  pin: string
  pinAttempted: boolean
  pinError: string | null
  registrationComplete: boolean
  billingAttached: boolean
  gatePassed: boolean
}

// ---- Step 1.1 Agent Identity ----
/** Set by the setup front door's "Who is this for?" screen — a light preference, Helo-side only,
 *  never sent to Meta. See mockData.ts's PERSONA_OPTIONS/ADVANCED_PERSONAS for what it affects. */
export type PersonaId = 'owner' | 'support_ops' | 'client_setup' | 'developer' | 'exploring'

export interface IdentityState {
  agentName: string
  companyName: string
  agentRole: string
  capabilities: string[]
  exclusionsOpen: boolean
  exclusions: string
  avatarDataUrl: string | null
  persona: PersonaId | null
}

// ---- Step 1.2 Business Profile ----
export type PaymentMethodId = 'cod' | 'upi' | 'cards' | 'netbanking' | 'wallets' | 'other'
export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

export interface BusinessHourRow {
  day: Day
  /** Explicitly marked closed. */
  closed: boolean
  /** '' means unset — a row that hasn't been touched by a shortcut or manual entry yet. */
  open: string
  close: string
}

/** Where the saved payment text came from: our own chips, or plain text saved elsewhere with no
 *  chip record to restore. `null` means no prior data — behaves like 'chips' with nothing selected. */
export type PaymentSource = 'chips' | 'text' | null

export interface BusinessState {
  businessDescription: string
  paymentMethods: PaymentMethodId[]
  paymentOtherText: string
  paymentSource: PaymentSource
  /** Only meaningful when paymentSource === 'text'. */
  paymentPlainText: string
  returnPolicy: string
  purchaseInfo: string
  deliveryAndShipping: string
  contactEmail: string
  businessAddress: string
  businessHours: BusinessHourRow[]
  businessHoursEnabled: boolean
}

// ---- Prototype-only demo controls, shared across steps ----
export interface DemoState {
  businessCategory: string
  /** One-shot: the next simulated async action (any step) fails, then this resets itself. */
  forceNextFailure: boolean
  /** Persistent (not one-shot), unlike forceNextFailure — Rich replies saves immediately rather
   *  than on Next, so it needs a toggle that stays on across multiple saves. Kept in global state
   *  (not local component state) so the floating Demo controls popover reflects it live: a
   *  sibling component's local state change never re-renders the popover while it stays open. */
  richRepliesForceSaveFailure: boolean
  /** Lets the Safety & handoff step's multi-language warning be demoed without actually
   *  configuring more than one language back on the Personality tab. */
  simulateMultipleLanguages: boolean
}

// ---- Step 1.3 Knowledge Base ----
export interface FaqRow {
  id: string
  question: string
  answer: string
  createdAt: number
  /** Which CSV import produced this row, if any — lets "Undo this import" remove exactly those rows. */
  importBatchId?: string
}

export interface DocumentFile {
  id: string
  fileName: string
  sizeBytes: number
  type: string
  uploadedAt: number
}

export type WebsiteStatus = 'waiting' | 'reading' | 'done' | 'failed'

export interface WebsiteSource {
  id: string
  url: string
  status: WebsiteStatus
  pagesRead: number
  updatedAt: number
  /** Sub-level navigation paths found under this URL once the crawl finishes. */
  subpages: string[]
}

export interface KnowledgeState {
  faqs: FaqRow[]
  documents: DocumentFile[]
  websites: WebsiteSource[]
  /** The most recent CSV import, kept only for the lifetime of this step so "Undo this import" can appear. */
  lastFaqImport: { id: string; count: number } | null
}

// ---- Step 1.4 Personalization ----
export type ToneId = 'professional' | 'enthusiastic' | 'informal' | 'custom'
export type AnswerLength = 'concise' | 'standard' | 'detailed'
export type EmojiUse = 'never' | 'sparingly' | 'freely'

export interface PersonalizationState {
  tone: ToneId
  customToneInstructions: string
  emojiUse: EmojiUse
  nameIntroduction: boolean
  answerLength: AnswerLength
  defaultLanguage: string
  additionalLanguages: string[]
  matchCustomerLanguage: boolean
  allowMixedLanguage: boolean
  /** Layer 2: user-authored skills, separate from the combined Layer-1 skill. Each saves on its own. */
  customSkills: CustomSkill[]
  lastSkillImport: { id: string; count: number } | null
}

export interface CustomSkill {
  id: string
  /** The plain name as the user typed it — shown in the UI. */
  name: string
  /** Generated from name: lowercase, hyphenated, <=64 chars, collision-suffixed. Never shown to the user. */
  title: string
  instruction: string
  createdAt: number
  importBatchId?: string
}

// ---- Step 1 Rich replies (the system underneath calls these "UI skills") ----
export type RichReplyType =
  | 'cta_url'
  | 'image'
  | 'interactive_list'
  | 'carousel_url'
  | 'carousel_quick_reply'
  | 'location'
  | 'location_request'
  | 'flow'

export interface CtaUrlBlanks {
  messageText: string
  buttonLabel: string
  link: string
}

export interface ImageBlanks {
  imageUrl: string
  caption: string
}

export interface MenuOption {
  id: string
  title: string
  description: string
  /** Which named group this option sits under — only meaningful when groupsEnabled is true. */
  group: string
}

export interface InteractiveListBlanks {
  messageText: string
  menuButtonLabel: string
  groupsEnabled: boolean
  options: MenuOption[]
}

export interface CarouselCard {
  id: string
  imageUrl: string
  cardText: string
  buttonLabel: string
  /** Present for carousel_url cards; ignored (kept empty) for carousel_quick_reply cards. */
  link: string
}

export interface CarouselUrlBlanks {
  messageText: string
  cards: CarouselCard[]
}

export interface CarouselQuickReplyBlanks {
  messageText: string
  cards: CarouselCard[]
}

export interface LocationBlanks {
  placeName: string
  address: string
  latitude: string
  longitude: string
}

export interface LocationRequestBlanks {
  messageText: string
}

export interface FlowBlanks {
  /** One of the canned WhatsApp Flow names, or null if none is available/selected. */
  flowName: string | null
  messageText: string
  buttonLabel: string
}

interface RichReplyBase {
  id: string
  name: string
  trigger: string
  enabled: boolean
  /** Regenerated in full from `blanks` on every save — never parsed back into blanks. */
  instructionSentence: string
  createdAt: number
}

/** `blanks` is null only for a row the system has with no structured record on our side (created
 *  elsewhere) — the row then shows `instructionSentence` as raw text and offers "Rebuild as a
 *  form" instead of "Edit". */
export type RichReply =
  | (RichReplyBase & { type: 'cta_url'; blanks: CtaUrlBlanks | null })
  | (RichReplyBase & { type: 'image'; blanks: ImageBlanks | null })
  | (RichReplyBase & { type: 'interactive_list'; blanks: InteractiveListBlanks | null })
  | (RichReplyBase & { type: 'carousel_url'; blanks: CarouselUrlBlanks | null })
  | (RichReplyBase & { type: 'carousel_quick_reply'; blanks: CarouselQuickReplyBlanks | null })
  | (RichReplyBase & { type: 'location'; blanks: LocationBlanks | null })
  | (RichReplyBase & { type: 'location_request'; blanks: LocationRequestBlanks | null })
  | (RichReplyBase & { type: 'flow'; blanks: FlowBlanks | null })

export interface RichRepliesState {
  richReplies: RichReply[]
}

// ---- Step 1.5 Journeys and Routing ----
export type JourneyProfile = 'support' | 'commerce' | 'both' | null

export interface IntentRow {
  id: string
  name: string
  triggerPhrases: string[]
  eligibleStates: string[]
  action: string
  fromTemplate: string | null
}

export interface RoutingState {
  journeyProfile: JourneyProfile
  selectedTemplateIds: string[]
  intents: IntentRow[]
  fallbackBehaviour: 'escalate' | 'retry_prompt' | 'fallback_reply'
}

// ---- Step 1.6 Connectors ----
export type ConnectorType = 'shopify' | 'woocommerce' | 'custom_rest' | 'none' | null
export type TestStatus = 'untested' | 'testing' | 'success' | 'failed'

export interface ConnectorTool {
  id: string
  name: string
  description: string
  enabled: boolean
  testStatus: TestStatus
  lastResponse: string | null
}

export interface CustomTool {
  id: string
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  paramsJson: string
}

export interface ConnectorsState {
  connectorType: ConnectorType
  apiKey: string
  clientId: string
  clientSecret: string
  connectionStatus: TestStatus
  tools: ConnectorTool[]
  customTools: CustomTool[]
  skipped: boolean
}

// ---- New Step 3 Connections ----
// A connection is one outside system (base address + auth). Actions are the individual things
// the agent can do there. Kept as a separate slice from the old, unused ConnectorsState above.
export type AuthMethod = 'api_key' | 'client_credentials' | 'none'
export type ApiKeyLocation = 'header' | 'query'
export type ConnectionStatus = 'working' | 'waiting_signin' | 'key_rejected' | 'having_problems' | 'not_tested'

/** One row of the repeatable API key list — most systems need one, some need more. */
export interface ApiKeyEntry {
  id: string
  value: string
  location: ApiKeyLocation
  fieldName: string
  prefix: string
}

export interface Connection {
  id: string
  name: string
  description: string
  baseUrl: string
  authMethod: AuthMethod
  // authMethod === 'api_key'
  apiKeys?: ApiKeyEntry[]
  // authMethod === 'client_credentials'
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  scopes?: string[]
  createdFromRecipe?: string
  createdAt: number
  /** Prototype-only: drives the status shown on the card, chosen from the card's own dropdown. */
  demoStatus: ConnectionStatus
}

export type ActionMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type ValueType = 'text' | 'number' | 'integer' | 'boolean'
/** 'conversation_memory' ("a value from earlier in this conversation"): grounded in a real
 *  conversation-memory mechanism, but its exact compiled binding was not independently verified
 *  this session (the real system reportedly uses a `$stored.<name>` variable namespace — see
 *  reference docs/postman collection, skill "state-and-variables"). The prototype stores the
 *  user's selection and, for demo purposes only, treats it identically to 'conversation'. FLAG
 *  FOR TECHNICAL REVIEW before any real compiled representation is built for this source. */
export type ValueSource = 'conversation' | 'whatsapp_number' | 'fixed' | 'conversation_memory'
export type ValueLocation = 'path' | 'query' | 'header' | 'body'

export interface ActionValue {
  id: string
  name: string
  type: ValueType
  required: boolean
  location: ValueLocation
  source: ValueSource
  fixedValue?: string
  /** Only meaningful (and near-mandatory) when source === 'conversation'. */
  description: string
}

export interface ConnectionAction {
  id: string
  connectionId: string
  name: string
  description: string
  method: ActionMethod
  path: string
  values: ActionValue[]
  createdAt: number
}

export interface ActivityLogRow {
  id: string
  connectionId: string
  actionId: string
  actionName: string
  timestamp: number
  outcome: 'worked' | 'failed'
  errorText?: string
}

export interface ConnectionsPageState {
  connections: Connection[]
  actions: ConnectionAction[]
  activity: ActivityLogRow[]
}

// ---- Connections tab: Integrations sub-tab ----
// A catalog card's real auth pattern — mirrors the three-way distinction already built into the
// Connections tab's custom setup form (api key / client credentials / none), named for what this
// tab actually shows the user rather than reusing that union directly, since "direct credentials"
// (e.g. PostgreSQL host/user/password) isn't the same shape as "no authentication".
export type IntegrationAuthPattern = 'oauth' | 'api_key' | 'direct_credentials'

export interface IntegrationTool {
  name: string
  description: string
}

export interface IntegrationAuthField {
  id: string
  label: string
  type: 'text' | 'password'
  placeholder?: string
}

export interface IntegrationDef {
  id: string
  name: string
  category: string
  authPattern: IntegrationAuthPattern
  description: string
  setupSteps: string[]
  tools: IntegrationTool[]
  /** What the user actually types in before connecting: empty for a pure OAuth redirect (nothing
   *  to enter), one or more fields for api_key/direct_credentials, or a pre-redirect field an
   *  OAuth integration still needs (Shopify's store domain, entered before the vendor redirect). */
  authFields: IntegrationAuthField[]
}

export interface InstalledIntegration {
  integrationId: string
  installedAt: number
  /** Installing and connecting are two different actions — this stays null until the user
   *  completes a separate Connect step, even though the integration already shows as installed.
   *  A plausible stand-in for what this integration would show once connected — a store domain
   *  for commerce tools, an account/workspace name for CRMs, databases, and the rest. */
  connectedAs: string | null
  connectedAt: number | null
}

export interface IntegrationsState {
  installed: InstalledIntegration[]
}

// ---- Connections tab: MCP sub-tab ----
export interface McpDiscoveredTool {
  name: string
  description: string
  enabled: boolean
}

export interface McpServerConnection {
  serverUrl: string
  hasAccessKey: boolean
  connectedAt: number
  tools: McpDiscoveredTool[]
}

export interface McpState {
  connection: McpServerConnection | null
}

// ---- Step 1.7 Guardrails ----
export interface GuardrailsState {
  groundingMode: 'strict' | 'assisted'
  neverSayPhrases: string[]
  topicsToAvoid: string[]
  handoffMessageEnabled: boolean
  handoffMessage: string
}

// ---- Step 1.8 System Replies ----
export type FollowUpInterval = 0 | 300 | 900 | 1800 | 3600 | 7200 | 28800 | 86400

export interface RepliesState {
  greetingReply: string
  wrapUpHelpful: string
  wrapUpUnhelpful: string
  offerHumanHandover: boolean
  fallbackReply: string
  outOfHoursReply: string
  unsupportedMediaReply: string
  followUpEnabled: boolean
  followUpInterval: FollowUpInterval
  followUpMessage: string
}

// ---- Step 1.9 Review, Test, Publish ----
export interface TestConversationResult {
  id: string
  title: string
  category: 'safety' | 'faq' | 'routing'
  passed: boolean
  transcript: { from: 'customer' | 'agent'; text: string }[]
}

export interface MetaEvalResult {
  available: boolean
  avgConversationScore: number
  avgTurnScore: number
  summary: string
  failureCategories: { category: string; count: number }[]
}

export interface PublishState {
  versionNote: string
  approverRequired: boolean
  /** Set by "Submit for approval" on this screen (Helo-side only, never sent to Meta). */
  pendingApproval: boolean
  /** Self-ticked by the user on this screen — we cannot verify Meta billing/compliance setup
   *  from here, so this is an honest checkbox, never an automatic status check. */
  billingConfirmed: boolean
  /** Kept for AgentsListPage.tsx's existing status/eval-score columns, but no longer written to
   *  by this screen — the new "standard checks" run is local, per-visit UI state (see
   *  ReviewPublishStep.tsx), not persisted wizard state. */
  testRunStatus: 'idle' | 'running' | 'done'
  testResults: TestConversationResult[]
  testsStaleSince: number | null
  metaEval: MetaEvalResult
  allowlistNumbers: string[]
  audienceMode: 'allowlisted' | 'everyone'
  activated: boolean
  activatedChannels: string[]
}

// ---- Agent Activity page: quality checks history ----
// A frozen copy of a past Test & publish standard-checks run, so the Agent Activity page can list
// history without ever calling Meta's Agent Eval endpoint. 'pending' never appears here — only
// finished runs are recorded.
export interface QualityCheckItem {
  id: string
  situation: string
  sent: string
  reply: string
  status: 'normal' | 'warn'
}

export interface QualityCheckRun {
  id: string
  timestamp: number
  items: QualityCheckItem[]
}

export interface QualityChecksState {
  runs: QualityCheckRun[]
}

// ---- Agent Activity page: inbound business events (Agent Event) ----
export interface AgentEventTypeDef {
  id: string
  name: string
  description: string
}

/** Meta's real status values for a submitted event, polled by agentEventId. */
export type AgentEventStatus = 'request_received' | 'processing' | 'sent' | 'success' | 'failed' | 'skipped'

export interface AgentEventRow {
  id: string
  agentEventId: string
  eventType: string
  status: AgentEventStatus
  timestamp: number
  errorMessage?: string
  skippedReason?: string
}

export interface AgentEventsState {
  configured: boolean
  webhookUrl: string
  secretKey: string
  secretRevealed: boolean
  eventTypes: AgentEventTypeDef[]
  events: AgentEventRow[]
}

export interface WizardState {
  gate: GateState
  currentStep: StepId
  completedSteps: Record<StepId, boolean>
  identity: IdentityState
  business: BusinessState
  knowledge: KnowledgeState
  personalization: PersonalizationState
  richReplies: RichRepliesState
  routing: RoutingState
  connectors: ConnectorsState
  connections: ConnectionsPageState
  integrations: IntegrationsState
  mcp: McpState
  guardrails: GuardrailsState
  replies: RepliesState
  publish: PublishState
  qualityChecks: QualityChecksState
  agentEvents: AgentEventsState
  demo: DemoState
  /** Keyed by data slice (not step) — several steps now span more than one slice. */
  lastEditedAt: Record<SliceKey, number>
  /** Cross-step navigation signal: "Customise handoff rules" on Safety & handoff sets this and
   *  jumps to Step 1, where the Skills tab consumes it to pre-fill (not save) a new custom skill.
   *  Kept outside the slice system so it never marks saved tests stale — it's pure UI intent,
   *  not agent configuration. */
  pendingSkillPrefill: { name: string; instruction: string } | null
  /** Cross-step navigation signal: the Test & publish step's "Compiled configuration" tabs link
   *  back to the step (and, where that step has its own inner tabs, the specific tab) that owns
   *  each piece of read-only data shown there. Kept outside the slice system for the same reason
   *  as pendingSkillPrefill above — pure UI intent, not agent configuration. */
  pendingStepFocus: { step: StepId; tab?: string } | null
  /** Which studio sidebar page is showing. Pure UI navigation state, not agent configuration. */
  currentSection: StudioSectionId
}

export type SliceKey = Exclude<
  keyof WizardState,
  | 'currentStep'
  | 'completedSteps'
  | 'lastEditedAt'
  | 'pendingSkillPrefill'
  | 'pendingStepFocus'
  | 'currentSection'
>

// ---- AI Agents listing (Helo-side summary of a configured agent instance) ----
export type AgentRolloutStatus = 'live' | 'needs_testing' | 'draft' | 'paused'

export interface AgentInstanceSummary {
  id: string
  name: string
  companyName: string
  phoneNumber: string
  status: AgentRolloutStatus
  connector: 'Shopify' | 'WooCommerce' | 'Custom REST' | 'None'
  journeyProfile: 'Support' | 'Commerce' | 'Both' | '—'
  audienceMode: 'Everyone' | 'Allowlisted'
  allowlistCount: number
  evalScore: number | null
  updatedAt: string
  isCurrent?: boolean
}
