// server/assist.ts (AI writing help, unanswered questions) and server/billing.ts (WhatsApp spend).
import { area, d, o } from './helpers.ts'

export const assist = area('AI help', {
  '/api/assist/write': {
    post: {
      id: 'assistWrite',
      summary: 'Draft or improve agent setup text',
      description: 'Uses Claude (needs ANTHROPIC_API_KEY on the server). `draft_role`: the agent’s description; `improve`: rewrite `text`; `draft_skill`: a skill instruction.',
      who: 'agent.edit',
      body: o({
        'task*': 'draft_role|improve|draft_skill',
        text: d('string', 'Required for `improve`; up to 4000 characters are used.'),
        context: o({ agentName: 'string', business: 'string', category: 'string', goal: d('string', 'What the skill should cover.') }),
      }),
      ok: o({ 'text*': 'string' }),
      errors: {
        400: 'Writing help needs an Anthropic API key in the server settings (ANTHROPIC_API_KEY). / Write something first, then ask to improve it.',
        403: 'Only owners and admins change the AI agent.',
        502: 'Couldn’t write that right now. Try again.',
      },
    },
  },
  '/api/assist/gaps': {
    get: {
      id: 'unansweredQuestions',
      summary: 'Questions the agent couldn’t answer',
      description: 'Customer and test questions answered with Meta’s fallback or handed to a person, grouped by question, most asked first (20 at most). Each can become an FAQ.',
      query: { days: { type: 'integer', enum: [7, 30], default: 7 } },
      ok: 'Gap[]',
      errors: { 400: 'days must be 7 or 30.' },
    },
  },
})

export const billing = area('Billing', {
  '/api/billing': {
    get: { id: 'getBilling', summary: 'WhatsApp spend this month', description: 'From Meta’s pricing analytics, synced daily, plus AI usage.', who: 'billing.view', ok: 'Billing', errors: { 403: 'Billing is for owners and admins.' } },
    put: {
      id: 'setBudget',
      summary: 'Set the monthly budget alert',
      who: 'billing.manage',
      body: o({ 'budget*': d('number?', 'Positive amount in the account currency, or null for none.') }),
      ok: 'Billing',
      errors: { 400: 'The budget must be a positive amount, or empty for none.', 403: 'Only owners can set the budget.' },
    },
  },
  '/api/billing/sync': {
    post: { id: 'syncBilling', summary: 'Refresh spend from Meta now', who: 'billing.view', ok: 'Billing', errors: { 403: 'Connect a WhatsApp account first.', 502: 'WhatsApp didn’t answer.' } },
  },
})
