import type { WizardState } from './types'
import { composeBusinessHoursSentence, composePaymentSentence } from './format'

export interface SkillDoc {
  title: string
  description: string
  skill: string
  channel: 'whatsapp'
}

export interface CompiledConfig {
  skills: SkillDoc[]
  business_info: {
    payment_method: string
    return_policy: string
    purchase_info: string
    delivery_and_shipping: string
    business_description: string
    contact_info: {
      email: string
      hours_of_operation: string
      address: string
    }
  }
  settings: {
    handoff: { enabled: boolean; message: string } | null
    followup: { enabled: boolean; followup_interval_in_seconds: number; message: string } | null
    ai_audience: 'ALLOWLISTED_ONLY' | 'EVERYONE'
    never_say_phrases: string[]
    rollout: { enabled: boolean }
  }
  allowlist: { consumer_phone_number: string }[]
}

// Fixed, not user-editable — included on every agent regardless of what Section 1 says.
const IDENTITY_BOUNDARY_STATEMENT =
  'What you are NOT: a general-purpose assistant. Do not answer questions unrelated to this business. Do not make promises about timelines, stock, or pricing you cannot verify. If asked directly whether you are a human, be honest: you are an AI assistant for this business.'

function buildIdentitySkill(state: WizardState): SkillDoc {
  const { identity, personalization } = state
  const lines: string[] = []
  lines.push(identity.agentRole.trim() || '[agent role]')
  lines.push('')
  lines.push(IDENTITY_BOUNDARY_STATEMENT)
  lines.push('')
  lines.push(
    personalization.matchCustomerLanguage
      ? "You communicate primarily in MATCH_CUSTOMER_LANGUAGE. If the customer writes in a language they are more comfortable in, switch fluently."
      : `Primary language: ${personalization.defaultLanguage}.`,
  )
  return {
    title: 'identity',
    description: 'Apply at the start of every new conversation, before any other skill.',
    skill: lines.join('\n'),
    channel: 'whatsapp',
  }
}

// Fixed, not user-editable — included on every agent regardless of tone choice.
const COMMUNICATION_STYLE_FORMATTING_RULES = [
  '## Formatting',
  '- Use hyphens for inline breaks. Never use em dashes or en dashes.',
  '- Use straight quotes, not curly quotes.',
  '- Prefer plain ASCII characters where possible; WhatsApp renders',
  '  other characters inconsistently across devices.',
  '- Never use markdown headings (# or ##); they do not render on',
  '  WhatsApp.',
  "- Match the customer's energy: a terse customer gets a terse reply.",
].join('\n')

function buildCommunicationStyleSkill(state: WizardState): SkillDoc {
  const { personalization } = state
  const lines: string[] = []
  lines.push(COMMUNICATION_STYLE_FORMATTING_RULES)
  lines.push('')
  if (personalization.tone === 'custom') {
    lines.push(personalization.customToneInstructions.trim() || '[custom tone instructions]')
  } else {
    lines.push(`Use a ${personalization.tone} tone in every reply.`)
  }
  lines.push('')
  lines.push(`## Answer length`)
  lines.push(`Default to ${personalization.answerLength} answers.`)
  lines.push('')
  lines.push('## Emoji use')
  if (personalization.emojiUse === 'never') {
    lines.push('Do not use emojis.')
  } else if (personalization.emojiUse === 'freely') {
    lines.push('Emojis may be used freely where they fit the tone.')
  } else {
    lines.push('Use emojis sparingly.')
  }
  if (personalization.nameIntroduction) {
    lines.push('')
    lines.push('## Introduction')
    lines.push(`Introduce yourself by name (${state.identity.agentName || '[agent name]'}) at the start of a new conversation.`)
  }
  return {
    title: 'communication-style',
    description: 'Apply to every outgoing message to set tone, formatting, and length.',
    skill: lines.join('\n'),
    channel: 'whatsapp',
  }
}

/** Automatic, not user-editable — appears only once Connections has at least one configured
 *  action, and disappears again (rather than being left empty) once none remain. */
function buildCapabilityDisclaimerSkill(state: WizardState): SkillDoc | null {
  const { actions } = state.connections
  if (actions.length === 0) return null
  const lines: string[] = []
  lines.push('# Capability Disclaimer')
  lines.push('Be explicit and immediate about what you cannot do.')
  lines.push('')
  lines.push('## What you CAN do')
  actions.forEach((action) => lines.push(`${action.name}, ${action.description}`))
  lines.push('')
  lines.push('## What you CANNOT do')
  lines.push(
    'When asked for anything else, say plainly that you cannot do it and offer the alternative already configured (a human handoff, or a contact detail from Business details). Never pretend a capability exists, and never promise a future action unless a real handoff is being triggered.',
  )
  return {
    title: 'capability-disclaimer',
    description: 'Apply when a customer asks for something outside your configured tools.',
    skill: lines.join('\n'),
    channel: 'whatsapp',
  }
}

function buildIntentRouterSkill(state: WizardState): SkillDoc {
  const { routing } = state
  const lines: string[] = []
  lines.push('# Intent Router')
  lines.push('')
  lines.push(`Journey profile: ${routing.journeyProfile ?? 'not set'}`)
  lines.push('')
  if (routing.intents.length > 0) {
    lines.push('| Intent | Trigger phrases | Eligible states | Action |')
    lines.push('|---|---|---|---|')
    routing.intents.forEach((intent) => {
      lines.push(
        `| ${intent.name} | ${intent.triggerPhrases.join(', ')} | ${intent.eligibleStates.join(', ')} | ${intent.action} |`,
      )
    })
  } else {
    lines.push('No intents configured yet.')
  }
  lines.push('')
  lines.push(`## Fallback`)
  lines.push(
    `If no intent matches: ${routing.fallbackBehaviour.replace('_', ' ')}.`,
  )
  return {
    title: 'intent-router',
    description: 'Apply when deciding which conversation path a customer message belongs to.',
    skill: lines.join('\n'),
    channel: 'whatsapp',
  }
}

function buildSystemRepliesSkill(state: WizardState): SkillDoc {
  const { replies, business } = state
  const lines: string[] = []
  lines.push('# System Replies')
  lines.push('')
  lines.push(`## Greeting`)
  lines.push(replies.greetingReply)
  lines.push('')
  lines.push(`## Wrap-up (helpful)`)
  lines.push(replies.wrapUpHelpful)
  lines.push('')
  lines.push(`## Wrap-up (unhelpful)`)
  lines.push(
    replies.offerHumanHandover
      ? `${replies.wrapUpUnhelpful} Offer to connect the customer with a person.`
      : replies.wrapUpUnhelpful,
  )
  lines.push('')
  lines.push(`## Fallback`)
  lines.push(replies.fallbackReply)
  if (business.businessHoursEnabled) {
    lines.push('')
    lines.push(`## Out of hours`)
    lines.push(replies.outOfHoursReply)
  }
  lines.push('')
  lines.push(`## Unsupported media`)
  lines.push(replies.unsupportedMediaReply)
  return {
    title: 'system-replies',
    description: 'Apply for greetings, wrap-ups, fallbacks, and unsupported input.',
    skill: lines.join('\n'),
    channel: 'whatsapp',
  }
}

function buildGroundingSkill(state: WizardState): SkillDoc {
  const { guardrails } = state
  const lines: string[] = []
  lines.push('# Grounding and Safety')
  lines.push('')
  lines.push(
    guardrails.groundingMode === 'strict'
      ? 'Only answer from configured knowledge and tools. If the answer is not grounded in what you have been told, hand off to a person instead of guessing.'
      : 'Some natural conversation is allowed within your role, but stay within the business context you have been given.',
  )
  return {
    title: 'grounding-and-safety',
    description: 'Apply to every response to control how much the agent may improvise.',
    skill: lines.join('\n'),
    channel: 'whatsapp',
  }
}

function buildCustomSkills(state: WizardState): SkillDoc[] {
  // Layer 2 skills: user-authored, separate records from the single combined Layer-1 skill above.
  return state.personalization.customSkills.map((skill) => ({
    title: skill.title,
    description: `Custom skill: ${skill.name}.`,
    skill: skill.instruction,
    channel: 'whatsapp',
  }))
}

export function compileConfig(state: WizardState): CompiledConfig {
  const capabilityDisclaimerSkill = buildCapabilityDisclaimerSkill(state)
  const skills = [
    buildIdentitySkill(state),
    buildCommunicationStyleSkill(state),
    ...(capabilityDisclaimerSkill ? [capabilityDisclaimerSkill] : []),
    buildIntentRouterSkill(state),
    buildGroundingSkill(state),
    buildSystemRepliesSkill(state),
    ...buildCustomSkills(state),
  ]

  const business_info = {
    payment_method:
      state.business.paymentSource === 'text'
        ? state.business.paymentPlainText
        : composePaymentSentence(state.business.paymentMethods, state.business.paymentOtherText),
    return_policy: state.business.returnPolicy,
    purchase_info: state.business.purchaseInfo,
    delivery_and_shipping: state.business.deliveryAndShipping,
    business_description: state.business.businessDescription,
    contact_info: {
      email: state.business.contactEmail,
      hours_of_operation: state.business.businessHoursEnabled
        ? composeBusinessHoursSentence(state.business.businessHours)
        : '',
      address: state.business.businessAddress,
    },
  }

  const settings = {
    handoff: state.guardrails.handoffMessageEnabled
      ? { enabled: true, message: state.guardrails.handoffMessage }
      : null,
    followup: state.replies.followUpEnabled
      ? {
          enabled: true,
          followup_interval_in_seconds: state.replies.followUpInterval,
          message: state.replies.followUpMessage,
        }
      : null,
    ai_audience: (state.publish.audienceMode === 'allowlisted'
      ? 'ALLOWLISTED_ONLY'
      : 'EVERYONE') as 'ALLOWLISTED_ONLY' | 'EVERYONE',
    never_say_phrases: state.guardrails.neverSayPhrases,
    rollout: { enabled: state.publish.activated },
  }

  const allowlist = state.publish.allowlistNumbers.map((number) => ({
    consumer_phone_number: number,
  }))

  return { skills, business_info, settings, allowlist }
}
