// server/tickets.ts: tickets, response targets, support settings, notifications and team analytics.
import { area, d, o } from './helpers.ts'

const SCOPE = 'When agents are restricted, an agent only reaches tickets assigned to them or unassigned (403 “This chat is assigned to someone else.”).'
const GONE = (n = 'n') => `Ticket #${n} doesn’t exist.`

export const tickets = area('Tickets & support', {
  '/api/tickets': {
    get: {
      id: 'listTickets',
      summary: 'List tickets',
      description: `500 at most. ${SCOPE}`,
      query: {
        status: d('open|pending|resolved|all', 'Default: open and pending.'),
        assignee: d('me|none', 'Mine, or unassigned.'),
        priority: 'urgent|high|normal|low',
        phone: 'string',
        q: d('string', 'Subject, name or number.'),
      },
      ok: 'Ticket[]',
    },
    post: {
      id: 'createTicket',
      summary: 'Open a ticket by hand',
      description: 'Tickets also open on their own when the AI hands off, a teammate takes over, or the team replies. One open ticket per chat.',
      body: o({ 'phone*': 'string', subject: 'string', priority: d('urgent|high|normal|low', 'Default normal.') }),
      ok: 'Ticket',
      errors: { 404: 'No chat with this number yet.', 409: 'This chat already has an open ticket.' },
    },
  },
  '/api/tickets/bulk': {
    post: {
      id: 'bulkTickets',
      summary: 'Change many tickets at once',
      description: 'Up to 200 ticket numbers. Each change is checked as if made one by one; ones you can’t change are skipped.',
      body: {
        oneOf: [
          o({ 'numbers*': 'integer[]', 'action*': 'resolve', askFeedback: d('boolean', 'Send the satisfaction question.'), handBack: d('boolean', 'Give the chat back to the AI agent.') }),
          o({ 'numbers*': 'integer[]', 'patch*': o({ status: 'open|pending', priority: 'urgent|high|normal|low', assigneeId: 'string?' }) }),
        ],
      },
      ok: o({ 'ok*': 'boolean', 'count*': 'integer' }),
    },
  },
  '/api/tickets/{n}': {
    get: { id: 'getTicket', summary: 'One ticket', ok: 'Ticket', errors: { 404: GONE() } },
    patch: {
      id: 'updateTicket',
      summary: 'Change a ticket',
      description: `Moving it to someone else needs \`tickets.reassign\` (supervisor+). ${SCOPE}`,
      body: o({ status: d('open|pending', 'Use /resolve to close.'), priority: 'urgent|high|normal|low', assigneeId: 'string?', subject: 'string', tags: 'string[]' }),
      ok: 'Ticket',
      errors: {
        400: 'Use Resolve to close a ticket. / Priority must be urgent, high, normal or low. / That person isn’t in this workspace.',
        403: 'Only supervisors, admins and owners move work that belongs to someone else.',
        404: GONE(),
        409: 'This chat already has an open ticket (#n). Continue there.',
      },
    },
  },
  '/api/tickets/{n}/resolve': {
    post: {
      id: 'resolveTicket',
      summary: 'Resolve a ticket',
      body: o({ resolution: d('string', 'What was done.'), askFeedback: d('boolean', 'Send the satisfaction question (if enabled).'), handBack: d('boolean', 'Give the chat back to the AI agent.') }),
      ok: 'Ticket',
      errors: { 400: 'Ticket #n is already resolved.', 404: GONE() },
    },
  },
  '/api/support/settings': {
    get: { id: 'getSupportSettings', summary: 'Hours, response targets, routing and teams', ok: 'SupportSettings' },
    put: {
      id: 'saveSupportSettings',
      summary: 'Save support settings',
      who: 'settings.manage',
      body: { $ref: '#/components/schemas/SupportSettings' },
      ok: 'SupportSettings',
      errors: {
        400: 'X isn’t a time zone we recognise. / Check the hours for mon: closing must be after opening (HH:MM). / Check the urgent targets… / Every team needs a name. / Pick who gets every new ticket.',
        403: 'Only owners and admins can change support settings.',
      },
    },
  },
  '/api/support/notifications': {
    get: {
      id: 'listNotices',
      summary: 'Your notifications',
      description: 'Ticket events, your reminders, and (owners and admins, `alerts.receive`) account alerts. 30 at most.',
      ok: 'Notice[]',
    },
  },
  '/api/support/notifications/reminder:{id}/dismiss': {
    post: { id: 'dismissReminder', summary: 'Dismiss a reminder' },
  },
  '/api/support/notifications/alert:{key}/dismiss': {
    post: { id: 'dismissAlert', summary: 'Dismiss an alert', params: { key: d('string', 'The alert’s key (URL-encoded).') } },
  },
  '/api/support/analytics': {
    get: {
      id: 'supportAnalytics',
      summary: 'Team analytics',
      description: 'Tickets created and resolved, reply and resolve times, response targets met, satisfaction, AI-only vs team chats, per-person numbers, broadcast replies.',
      query: { days: { type: 'integer', enum: [7, 30, 90], default: 7 } },
      ok: 'SupportAnalytics',
      errors: { 400: 'days must be 7, 30 or 90.' },
    },
  },
})
