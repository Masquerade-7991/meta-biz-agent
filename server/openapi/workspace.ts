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
    get: { id: 'getBilling', summary: 'WhatsApp spend this month', description: 'From Meta’s pricing analytics, synced every 6 hours, plus AI usage. The month runs in the workspace’s support time zone (`timezone`); Meta’s spend comes per UTC day. `updatedAt` / `updatedBy` say when the budget was last set.', who: 'billing.view', ok: 'Billing', errors: { 403: 'Billing is for owners and admins.' } },
    put: {
      id: 'setBudget',
      summary: 'Set the monthly budget alert',
      who: 'billing.manage',
      description: 'Send `If-Unmodified-Since: <updatedAt>` from the last read to refuse overwriting someone else’s change (409); without the header the save always wins.',
      headers: { 'If-Unmodified-Since': d('date-time', 'The `updatedAt` you read.') },
      body: o({ 'budget*': d('number?', 'Amount in the account currency, 0 to 1,000,000,000. 0 or null means no budget. Strings are refused.') }),
      ok: 'Billing',
      errors: {
        400: 'The budget must be an amount from 0 to 1,000,000,000, or null for none (0 also means none).',
        403: 'Only owners can set the budget.',
        409: 'Someone else changed this just now. Reload to see their changes.',
      },
    },
  },
  '/api/billing/sync': {
    post: {
      id: 'syncBilling',
      summary: 'Refresh spend from Meta now',
      description: 'Spend also refreshes on its own every 6 hours. Once a minute per workspace.',
      who: 'billing.manage',
      ok: 'Billing',
      errors: { 403: 'Only owners can update spend now.', 429: 'Spend was updated a moment ago. Try again in a minute.', 502: 'WhatsApp didn’t answer.' },
    },
  },
})
