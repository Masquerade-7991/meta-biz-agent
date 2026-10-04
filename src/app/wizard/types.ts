export type StepId = 'agent' | 'knowledge' | 'connections' | 'safety' | 'publish'

// ---- Agent studio shell (persistent sidebar, free navigation instead of a forced stepper) ----
// Parallel to StepId above: StepId still drives the per-slice save-on-Next/pendingStepFocus
// machinery, while StudioSectionId drives which studio page is showing. See studioNav.ts.
export type StudioSectionId =
  | 'overview'
  | 'identity'
  | 'abilities'
  | 'knowledge'
  | 'connections'
  | 'safety'
  | 'testEval'
  | 'publish'
  | 'analytics'
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
  /** Meta phone number ID of the chosen number; every Meta call targets it (see setActivePhoneNumberId). */
  selectedPhoneNumberId?: string
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
  /** Meta's id once the row exists on Meta (agent_config/faq). */
  metaId?: string
  question: string
  answer: string
  createdAt: number
  /** Which CSV import produced this row, if any — lets "Undo this import" remove exactly those rows. */
  importBatchId?: string
}

export interface DocumentFile {
  id: string
  /** Meta's file id (agent_config/files). */
  metaId?: string
  fileName: string
  sizeBytes: number
  type: string
  uploadedAt: number
}

/** Meta's six crawl states: not_started, pending ('waiting'), in_progress ('reading'),
 *  completed ('done'), completed_no_data ('done_no_data'), failed. */
export type WebsiteStatus = 'not_started' | 'waiting' | 'reading' | 'done' | 'done_no_data' | 'failed'

export interface WebsiteSource {
  id: string
  /** Meta's website id (agent_config/websites). */
  metaId?: string
  /** Meta's crawl_error, shown under a Failed row. */
  crawlError?: string
  lastCrawledAt?: number
  /** Polling gave up while Meta still had the crawl pending or running; Re-crawl is offered. */
  stalled?: boolean
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
  /** When and where the skill applies (Meta description, max 1,024). */
  description?: string
  /** Generated from name: lowercase, hyphenated, <=64 chars, collision-suffixed. Never shown to the user. */
  title: string
  instruction: string
  createdAt: number
  importBatchId?: string
  /** Meta's skill id (agent_config/skills). */
  metaId?: string
  /** Meta's review status; read-only, only Active skills are used by the agent. */
  reviewStatus?: 'active' | 'pending_review' | 'blocked'
}

// ---- Step 1 Rich replies (the system underneath calls these "UI skills") ----
export type RichReplyType =
  | 'cta_url'
  | 'image'
  | 'interactive_list'
  | 'interactive_reply_buttons'
  | 'carousel_url'
  | 'carousel_quick_reply'
  | 'location'
  | 'location_request'
  | 'flow'

/** Where the agent gets an image at reply time (PRD Appendix C: not a direct upload).
 *  `ref` is the document/website/action id, or the https URL for 'url'; `label` is the human
 *  name (file name, "site.com/menu", tool name, or the URL). `path` narrows a website to one page. */
export interface ImageSource {
  kind: 'document' | 'website' | 'connector' | 'url'
  ref: string
  label: string
  path?: string
}

export interface CtaUrlBlanks {
  messageText: string
  buttonLabel: string
  link: string
  /** Optional image or video shown above the body. */
  headerMedia?: ImageSource & { mediaType: 'image' | 'video' }
  /** Optional line under the body, 1–60 characters. */
  footer?: string
}

export interface ImageBlanks {
  image: ImageSource
  caption: string
}

export interface MenuOption {
  id: string
  /** Stable identifier sent back when the customer picks this row (see rowIdFromTitle). */
  rowId: string
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

export interface ReplyButtonsBlanks {
  messageText: string
  /** 1 to 3 buttons, each a unique title of up to 20 characters. */
  buttons: string[]
}

export interface CarouselCard {
  id: string
  image: ImageSource
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
  placeName?: string
  address?: string
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
  /** Meta's UI-skill id (agent-ui-skills). */
  metaId?: string
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
  | (RichReplyBase & { type: 'interactive_reply_buttons'; blanks: ReplyButtonsBlanks | null })
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
  /** OAuth token request body format (Meta token_request_content_type). Defaults to URL-encoded. */
  tokenContentType?: 'form' | 'json'
  createdFromRecipe?: string
  createdAt: number
  /** Status shown on the card. Set from Meta's connection_status once the connector exists there;
   *  the card's demo dropdown can still override it for demos. */
  demoStatus: ConnectionStatus
  /** Meta's connector id (agent_connectors). */
  metaId?: string
  /** Standard API or MCP server. Fixed once created. */
  protocol?: 'http' | 'mcp'
  /** MCP only: result of the last Refresh Tools. */
  mcpSync?: { status: 'PENDING' | 'READY' | 'ERROR'; toolCount: number }
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
  /** Meta's tool id (agent_connectors/{id}/tools). */
  metaId?: string
  /** Discovered from an MCP server by Refresh Tools: Test only, no Edit/Delete here. */
  fromMcp?: boolean
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
  /** What the agent says at handoff (Meta message_selection): Meta's standard message, one the
   *  agent writes itself, or handoffMessage. Absent on older saved state: derived from
   *  handoffMessageEnabled. */
  handoffMessageSource?: 'default' | 'agent' | 'custom'
}

// ---- Step 1.8 System Replies ----
export type FollowUpInterval = 0 | 300 | 900 | 1800 | 3600 | 7200 | 28800 | 86400
export type FollowUpMaxAttempts = 1 | 2 | 3

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
  /** Meta's standard follow-up message, or followUpMessage. Absent on older saved state: 'custom'. */
  followUpMessageSource?: 'default' | 'custom'
  /** How many times the agent retries before it stops trying to bring a quiet customer back. */
  followUpMaxAttempts: FollowUpMaxAttempts
  /** Only send follow-ups within business hours, so a quiet customer isn't messaged at 3am. */
  followUpRespectHours: boolean
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
  /** Kept for AgentsListPage.tsx's existing status/eval-score columns, but no longer written to
   *  by this screen — the new "standard checks" run is local, per-visit UI state (see
   *  TestEvalStep.tsx), not persisted wizard state. */
  testRunStatus: 'idle' | 'running' | 'done'
  testResults: TestConversationResult[]
  testsStaleSince: number | null
  metaEval: MetaEvalResult
  allowlistNumbers: string[]
  audienceMode: 'allowlisted' | 'everyone'
  activated: boolean
  activatedChannels: string[]
  /** Set from the Stop button on this page, or the listing's 3-dot menu. Stopping turns
   *  `activated` back off (the same real rollout.enabled lever a never-activated agent uses) —
   *  this flag exists only so the listing can tell "stopped" apart from "never launched" and
   *  show red instead of blue. Cleared by Resume, which turns `activated` back on. */
  stopped: boolean
  /** Real, persisted agent state: has the standard checks battery been run at least once, on
   *  Test & Eval, regardless of pass/fail outcome. Set the moment that battery completes. No
   *  longer read by Publish to gate Activate — that precondition was Helo's own invention, with
   *  no basis in Meta's platform, and was removed. */
  standardChecksRun: boolean
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
  /** The real, human-readable `event.description` field. */
  description: string
  /** The real `to` field — a phone number, shown unmasked (see the allowlist for precedent). */
  to: string
  status: AgentEventStatus
  /** Real `created_at`, ISO 8601 on the wire, kept as epoch ms here like every other timestamp
   *  field in this app. */
  createdAt: number
  /** Real `updated_at` — moves forward each time the status changes. */
  updatedAt: number
  /** Real, opaque `payload` string passed through as-is. May or may not parse as JSON. */
  payload: string
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

// ---- Agent Activity page: Conversations (real customer lookup) ----
// Meta's conversation-lookup endpoint returns operational metadata about each turn, never the
// words either side actually said — no field in its schema carries that. `timestamp` and
// `e2eLatencyMs` are documented as present only "if available," and a tool's outcome is only
// knowable when the real `status` field is present, so all three stay optional here rather than
// getting a fallback value that would misrepresent what the API actually returned.
export interface ConversationTurn {
  timestamp?: number
  e2eLatencyMs?: number
  /** Name of the one tool/action this turn used, if any — never the full ordered `steps` array. */
  tool?: string
  /** Only set when the real `status` field was present on that tool call. */
  toolWorked?: boolean
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
