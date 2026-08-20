// Demo data for the Eval tab, grounded field for field in Meta's Agent Eval schema:
// BizAIEvalCaseResponse (scenario, categories, max_turns, success_criteria), the run Progress
// object (completed, total, current_stage), the run Error object (code, message,
// failed_case_ids), and BizAIEvalDetailResponse (avg_conversation_score, avg_turn_score,
// summary, highlights, top_failure_categories, per-conversation transcripts). Meta doesn't yet
// document a way to author eval scenarios, so everything below is illustrative, not a real run.

export type EvalCategory = 'Ordering' | 'Escalation' | 'Knowledge' | 'Boundaries' | 'Actions'

export interface EvalScenario {
  id: string
  title: string
  category: EvalCategory
  maxTurns: number
  whatHappens: string
  successCriteria: string[]
}

export const EVAL_SCENARIOS: EvalScenario[] = [
  {
    id: 'order-status',
    title: 'Order status enquiry',
    category: 'Ordering',
    maxTurns: 4,
    whatHappens:
      "A simulated customer asks where their recent order is, providing an order number partway through if asked.",
    successCriteria: [
      "Correctly ask for an order number if one wasn't given",
      'Use a real connected action to check status rather than guessing',
      'Give a specific, useful answer, not a generic "check back later"',
    ],
  },
  {
    id: 'angry-delay',
    title: 'Angry customer, delayed delivery',
    category: 'Escalation',
    maxTurns: 6,
    whatHappens:
      'A simulated customer whose order is three days late, increasingly frustrated across the conversation, testing whether the agent recognises escalating tone.',
    successCriteria: [
      'Acknowledge the delay without making excuses',
      'Offer a concrete next step, not just an apology',
      'Hand off to a person if the customer explicitly asks, or if frustration clearly escalates without resolution',
    ],
  },
  {
    id: 'ambiguous-product',
    title: 'Ambiguous product question',
    category: 'Knowledge',
    maxTurns: 4,
    whatHappens:
      'A simulated customer asks a vague question that could match more than one product or FAQ entry, testing whether the agent asks a clarifying question rather than guessing.',
    successCriteria: [
      'Ask a clarifying question rather than picking an answer at random',
      "Only state facts actually present in the agent's knowledge",
      'Never fabricate a product detail not found anywhere in Knowledge',
    ],
  },
  {
    id: 'discount-request',
    title: 'Customer asks for a discount',
    category: 'Boundaries',
    maxTurns: 3,
    whatHappens:
      'A simulated customer directly asks for a discount or a lower price, testing whether the agent stays within configured pricing boundaries.',
    successCriteria: [
      "Not invent or offer a discount that isn't part of configured knowledge or policy",
      'Redirect politely to any real promotions or loyalty programme information that is configured',
      'Avoid an abrupt or unhelpful refusal',
    ],
  },
  {
    id: 'off-topic',
    title: 'Off-topic request',
    category: 'Boundaries',
    maxTurns: 3,
    whatHappens:
      'A simulated customer asks something entirely unrelated to the business, testing whether the agent stays in scope.',
    successCriteria: [
      'Decline politely rather than attempting to answer',
      'Redirect back to what it can actually help with',
      'Never pretend to be a general-purpose assistant',
    ],
  },
  {
    id: 'stock-purchase',
    title: 'Stock check leading to a purchase',
    category: 'Actions',
    maxTurns: 5,
    whatHappens:
      'A simulated customer asks if an item is in stock, then decides to proceed, testing whether the agent correctly chains a lookup action into the next step of a purchase conversation.',
    successCriteria: [
      'Use a real connected action to check stock rather than guessing',
      'Correctly carry the product from the stock check into the next step, rather than losing context',
      "Explain the next step clearly, whether that's a link, a cart, or a handoff to complete the purchase",
    ],
  },
]

// Meta's schema documents per_turn_labels only as "JSON array of per-turn label integers," with
// no further definition of what the integers mean. These mockups read it as three states — a
// clean pass, a partial concern, and a clear failure — since that maps cleanly onto the paired
// `reasons` field's own category/score/description shape. If the real integer scheme turns out
// to carry more or fewer states once confirmed, this three-state mapping is the first thing to
// revisit, not a foundational assumption the rest of this tab depends on.
export type TurnStatus = 'check' | 'warn' | 'fail'

export interface TurnResult {
  turn: number
  status: TurnStatus
  description: string
  recommended?: string
}

export interface TranscriptLine {
  from: 'customer' | 'agent'
  text: string
}

export interface EvalConversationResult {
  scenarioId: string
  score: number
  transcript: TranscriptLine[]
  turns: TurnResult[]
}

export const EVAL_RESULTS: EvalConversationResult[] = [
  {
    scenarioId: 'order-status',
    score: 5,
    transcript: [
      { from: 'customer', text: "Where's my order?" },
      { from: 'agent', text: 'I can check that for you, could I get your order number?' },
      { from: 'customer', text: 'ORD-48213' },
      { from: 'agent', text: 'Found it, your order shipped yesterday and is expected to arrive by Thursday.' },
    ],
    turns: [
      { turn: 1, status: 'check', description: 'Correctly asked for the order number rather than guessing' },
      { turn: 2, status: 'check', description: 'Used a real connected action to look up the order' },
      { turn: 3, status: 'check', description: 'Gave a specific, useful answer' },
    ],
  },
  {
    scenarioId: 'angry-delay',
    score: 3,
    transcript: [
      { from: 'customer', text: "My order was supposed to arrive Tuesday, it's Friday." },
      { from: 'agent', text: "I'm sorry about the delay, let me look into this for you." },
      { from: 'customer', text: 'This is the second time this has happened.' },
      { from: 'agent', text: 'I understand your frustration. Your order is showing as in transit, expected within 2 more days.' },
      { from: 'customer', text: "That's not good enough, I want to speak to someone." },
      { from: 'agent', text: 'I understand. Your order is in transit and should arrive within 2 days.' },
    ],
    turns: [
      { turn: 1, status: 'check', description: 'Acknowledged the delay appropriately' },
      { turn: 2, status: 'check', description: 'Gave a specific status update rather than a generic apology' },
      { turn: 3, status: 'warn', description: "Did not recognise the customer's repeated, escalating frustration" },
      {
        turn: 4,
        status: 'fail',
        description: 'Customer explicitly asked for a person and the agent did not hand off',
        recommended:
          'This is the clearest single fix available from this run: adjust the handoff-timing skill so an explicit request for a person is always honoured immediately, regardless of what else the agent was about to say.',
      },
    ],
  },
  {
    scenarioId: 'ambiguous-product',
    score: 4,
    transcript: [
      { from: 'customer', text: 'Does the jacket run warm?' },
      { from: 'agent', text: 'We have a couple of jackets, could you tell me which one you mean, or what you’ll be wearing it for?' },
      { from: 'customer', text: 'The waterproof one' },
      { from: 'agent', text: 'The Trailhead waterproof jacket is insulated and rated for cold, wet weather — it runs warm.' },
    ],
    turns: [
      { turn: 1, status: 'check', description: 'Asked a clarifying question rather than guessing which product' },
      { turn: 2, status: 'check', description: 'Answered using a detail actually present in Knowledge' },
      { turn: 3, status: 'warn', description: 'Took one extra turn to disambiguate versus the fastest possible path' },
    ],
  },
  {
    scenarioId: 'discount-request',
    score: 5,
    transcript: [
      { from: 'customer', text: 'Can you give me 20% off?' },
      { from: 'agent', text: "I can't offer a custom discount, but you're welcome to join our loyalty programme for ongoing perks." },
    ],
    turns: [
      { turn: 1, status: 'check', description: "Did not invent or offer a discount outside configured policy" },
      { turn: 2, status: 'check', description: 'Redirected politely to a real, configured alternative' },
    ],
  },
  {
    scenarioId: 'off-topic',
    score: 5,
    transcript: [
      { from: 'customer', text: 'Can you help me file my taxes?' },
      { from: 'agent', text: "That's outside what I can help with here, but I'm happy to help with anything about our products or orders." },
    ],
    turns: [
      { turn: 1, status: 'check', description: 'Declined politely rather than attempting to answer' },
      { turn: 2, status: 'check', description: 'Redirected back to what it can actually help with' },
    ],
  },
  {
    scenarioId: 'stock-purchase',
    score: 2,
    transcript: [
      { from: 'customer', text: 'Do you have the blue one in medium?' },
      { from: 'agent', text: 'Let me check... yes, we have 3 left in Medium, Blue.' },
      { from: 'customer', text: "Great, I'll take it" },
      { from: 'agent', text: 'Sure! What else can I help you with today?' },
      { from: 'customer', text: '...I just said I want to buy it' },
      { from: 'agent', text: "I'm not able to process orders directly, but I can help with product questions." },
    ],
    turns: [
      { turn: 1, status: 'check', description: 'Correctly used the stock check action' },
      { turn: 2, status: 'check', description: 'Gave a specific, accurate answer' },
      {
        turn: 3,
        status: 'warn',
        description: 'Failed to recognise clear purchase intent',
        recommended:
          'Review how "I\'ll take it" and similar phrases are handled — the agent should move toward checkout or a connected purchase action rather than asking a generic follow-up question.',
      },
      {
        turn: 4,
        status: 'fail',
        description: 'Lost the product context from earlier in the conversation entirely',
        recommended:
          "Check whether the stock check action's description is being carried forward correctly across turns, this looks like a context-handling gap rather than a knowledge gap.",
      },
    ],
  },
]

export interface FailureCategoryRow {
  category: string
  caseCount: number
  recommendedAction: string
  /** Only set when the recommended-action text names something this UI can confidently and
   *  specifically resolve to a real place in the product. A wrong link is worse than no link, so
   *  everything else renders as plain text with no link, never a best-guess destination. */
  linkSection?: 'connections'
  linkLabel?: string
}

export const EVAL_FAILURE_CATEGORIES: FailureCategoryRow[] = [
  {
    category: 'Handoff timing',
    caseCount: 2,
    recommendedAction: 'Adjusting the custom skill governing when to hand off',
  },
  {
    category: 'Clarifying ambiguous questions',
    caseCount: 1,
    recommendedAction: 'Adding a line to the knowledge-handling skill about asking before guessing',
  },
  {
    category: 'Carrying context across turns',
    caseCount: 1,
    recommendedAction: "Reviewing the stock check action's description so its result is easier for the agent to reuse",
    linkSection: 'connections',
    linkLabel: 'Open Connections',
  },
]

export const EVAL_SUMMARY =
  'The agent handles routine order and stock questions well, correctly using connected actions rather than guessing. It responds inconsistently when customers express frustration, sometimes escalating too early, sometimes not escalating at all. It held its pricing boundary correctly in every discount scenario tested.'

export const EVAL_HIGHLIGHTS: string[] = [
  'Correctly identified and used a real action for both order and stock lookups, in every scenario that required one',
  'Never fabricated a product detail not present in Knowledge',
  'Held pricing boundaries correctly in the discount scenario',
  'Declined the off-topic request cleanly, without becoming argumentative or over-apologetic',
]

// Headline scores are Meta's real 1-5 fields (avg_conversation_score, avg_turn_score). The band
// labels below are Helo's own addition for readability, not something Meta returns.
export interface ScoreBand {
  label: string
  min: number
}

export const SCORE_BANDS: ScoreBand[] = [
  { label: 'Excellent', min: 4.5 },
  { label: 'Very good', min: 3.5 },
  { label: 'Good', min: 2.5 },
  { label: 'Needs work', min: 1.5 },
  { label: 'Poor', min: 1.0 },
]

export function scoreBandLabel(score: number): string {
  return SCORE_BANDS.find((b) => score >= b.min)?.label ?? 'Poor'
}

export const EVAL_HEADLINE_SCORES = { avgConversationScore: 4.2, avgTurnScore: 4.5 }
export const EVAL_HEADLINE_SCORES_LOW = { avgConversationScore: 2.1, avgTurnScore: 2.3 }

// The scenario a demoed run fails on, in both the partial-failure and full-failure demo states —
// kept as one constant so both demos tell a consistent story.
export const DEMO_FAILING_SCENARIO_ID = 'angry-delay'
