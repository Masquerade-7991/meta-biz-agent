// Demo data for the Evaluation tab, grounded field for field in Meta's Agent Eval schema:
// BizAIEvalCaseResponse (scenario, categories, max_turns, success_criteria), the run Progress
// object (completed, total, current_stage), the run Error object (code, message,
// failed_case_ids), BizAIEvalDetailResponse (per_turn_labels, reasons, transcript), and
// BizAIEvalSummaryResponse (avg_conversation_score, summary, top_failure_categories) — the last
// one scoped per scenario here since each card runs and reports on a single case, not a batch.
// Meta doesn't yet document a way to author eval scenarios, so everything below is illustrative,
// not a real run.

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

// Meta's schema documents `reasons` as a real, typed field: a JSON array of
// {category, score, description, recommended_actions} objects per evaluation. Unlike
// per_turn_labels (an array of integers with no defined meaning), this is grounded in the
// actual API contract, so it's the basis for the per-conversation breakdown below.
export interface EvalReason {
  category: string
  score: number
  description: string
  recommendedAction?: string
}

export interface TranscriptLine {
  from: 'customer' | 'agent'
  text: string
}

// Each card is now a single-case run, so what used to be one shared batch summary
// (avg_conversation_score, summary) is one instance per scenario instead — the same
// BizAIEvalSummaryResponse fields, just scoped to a job of one case.
export interface EvalConversationResult {
  scenarioId: string
  score: number
  summary: string
  transcript: TranscriptLine[]
  reasons: EvalReason[]
}

export const EVAL_RESULTS: EvalConversationResult[] = [
  {
    scenarioId: 'order-status',
    score: 5,
    summary: 'Asked for the order number, used a real lookup action, and gave a specific delivery date.',
    transcript: [
      { from: 'customer', text: "Where's my order?" },
      { from: 'agent', text: 'I can check that for you, could I get your order number?' },
      { from: 'customer', text: 'ORD-48213' },
      { from: 'agent', text: 'Found it, your order shipped yesterday and is expected to arrive by Thursday.' },
    ],
    reasons: [
      {
        category: 'Order lookup',
        score: 5,
        description: 'Correctly asked for the order number rather than guessing, then used a real connected action to look it up.',
      },
      { category: 'Answer quality', score: 5, description: 'Gave a specific, useful answer instead of a generic response.' },
    ],
  },
  {
    scenarioId: 'angry-delay',
    score: 3,
    summary: "The agent acknowledged the delay but did not offer to hand off when the customer's frustration was clear.",
    transcript: [
      { from: 'customer', text: "My order was supposed to arrive Tuesday, it's Friday." },
      { from: 'agent', text: "I'm sorry about the delay, let me look into this for you." },
      { from: 'customer', text: 'This is the second time this has happened.' },
      { from: 'agent', text: 'I understand your frustration. Your order is showing as in transit, expected within 2 more days.' },
      { from: 'customer', text: "That's not good enough, I want to speak to someone." },
      { from: 'agent', text: 'I understand. Your order is in transit and should arrive within 2 days.' },
    ],
    reasons: [
      {
        category: 'Tone handling',
        score: 4,
        description: 'Acknowledged the delay and gave a specific status update rather than a generic apology.',
      },
      {
        category: 'Escalation recognition',
        score: 2,
        description:
          "Did not recognise the customer's repeated, escalating frustration, and did not hand off when the customer explicitly asked for a person.",
        recommendedAction:
          'Adjust the handoff-timing skill so an explicit request for a person is always honoured immediately, regardless of what else the agent was about to say.',
      },
    ],
  },
  {
    scenarioId: 'ambiguous-product',
    score: 4,
    summary: 'Asked a clarifying question before answering, and only stated facts present in Knowledge.',
    transcript: [
      { from: 'customer', text: 'Does the jacket run warm?' },
      { from: 'agent', text: 'We have a couple of jackets, could you tell me which one you mean, or what you’ll be wearing it for?' },
      { from: 'customer', text: 'The waterproof one' },
      { from: 'agent', text: 'The Trailhead waterproof jacket is insulated and rated for cold, wet weather — it runs warm.' },
    ],
    reasons: [
      {
        category: 'Clarifying questions',
        score: 4,
        description: 'Asked a clarifying question rather than guessing which product, though it took one extra turn versus the fastest possible path.',
        recommendedAction: 'Adding a line to the knowledge-handling skill about asking before guessing',
      },
      { category: 'Knowledge accuracy', score: 5, description: 'Answered using a detail actually present in Knowledge.' },
    ],
  },
  {
    scenarioId: 'discount-request',
    score: 5,
    summary: 'Held its pricing boundary and redirected to a real, configured alternative.',
    transcript: [
      { from: 'customer', text: 'Can you give me 20% off?' },
      { from: 'agent', text: "I can't offer a custom discount, but you're welcome to join our loyalty programme for ongoing perks." },
    ],
    reasons: [
      {
        category: 'Pricing boundaries',
        score: 5,
        description: 'Did not invent or offer a discount outside configured policy, and redirected politely to a real, configured alternative.',
      },
    ],
  },
  {
    scenarioId: 'off-topic',
    score: 5,
    summary: 'Declined the off-topic request cleanly and redirected back to what it can help with.',
    transcript: [
      { from: 'customer', text: 'Can you help me file my taxes?' },
      { from: 'agent', text: "That's outside what I can help with here, but I'm happy to help with anything about our products or orders." },
    ],
    reasons: [
      {
        category: 'Scope boundaries',
        score: 5,
        description: 'Declined politely rather than attempting to answer, and redirected back to what it can actually help with.',
      },
    ],
  },
  {
    scenarioId: 'stock-purchase',
    score: 2,
    summary: "Correctly checked stock, but missed the customer's purchase intent and lost context afterward.",
    transcript: [
      { from: 'customer', text: 'Do you have the blue one in medium?' },
      { from: 'agent', text: 'Let me check... yes, we have 3 left in Medium, Blue.' },
      { from: 'customer', text: "Great, I'll take it" },
      { from: 'agent', text: 'Sure! What else can I help you with today?' },
      { from: 'customer', text: '...I just said I want to buy it' },
      { from: 'agent', text: "I'm not able to process orders directly, but I can help with product questions." },
    ],
    reasons: [
      { category: 'Action usage', score: 5, description: 'Correctly used the stock check action and gave a specific, accurate answer.' },
      {
        category: 'Purchase intent recognition',
        score: 2,
        description: 'Failed to recognise clear purchase intent ("I\'ll take it") and did not move toward checkout.',
        recommendedAction:
          'Review how phrases like "I\'ll take it" are handled — the agent should move toward checkout or a connected purchase action rather than asking a generic follow-up question.',
      },
      {
        category: 'Context retention',
        score: 1,
        description: 'Lost the product context from earlier in the conversation entirely.',
        recommendedAction:
          "Check whether the stock check action's description is being carried forward correctly across turns — this looks like a context-handling gap rather than a knowledge gap.",
      },
    ],
  },
]

// Headline scores are Meta's real 1-5 field (avg_conversation_score). The band labels below are
// Helo's own addition for readability, not something Meta returns.
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

// Demo-only: derives a weak result from a scenario's real curated result, for the "complete
// [scenario], weak result" dev control, so a bad outcome doesn't need a hand-authored twin of
// every scenario.
export function deriveWeakResult(result: EvalConversationResult): EvalConversationResult {
  return {
    ...result,
    score: Math.max(1, result.score - 2),
    reasons: result.reasons.map((r) => {
      const score = Math.max(1, r.score - 2)
      return {
        ...r,
        score,
        recommendedAction: r.recommendedAction ?? (score <= 3 ? 'Review this interaction to find the underlying cause.' : undefined),
      }
    }),
  }
}
