// server/analytics.ts: the central Analytics page (all agents or some) and the logs behind it.
import { area, d, o } from './helpers.ts'

const FILTER = {
  from: d('string', 'First day (YYYY-MM-DD) in the support hours’ time zone. Default: 29 days before `to`.'),
  to: d('string', 'Last day, inclusive. Default: today. At most 366 days in all.'),
  numbers: d('string', 'Comma-separated WhatsApp number ids (one agent per number). Default: all. Ids not in this workspace are ignored.'),
  team: d('string', 'Ticket figures for one team (`none` = tickets in no team).'),
  person: d('string', 'Ticket figures for one person (`none` = unassigned).'),
}
const WHO = 'reports.view' as const

export const analytics = area('Analytics', {
  '/api/analytics/overview': {
    get: {
      id: 'getAnalyticsOverview',
      summary: 'Everything on the Analytics page',
      description:
        'Headline numbers with the same-length period before, a series per day, customer messages by weekday and hour, per agent, people, teams, escalations, tools (Meta’s insights) and consumption: WhatsApp spend by category, the Business Agent’s usage, service replies against the 1,000 free per number each month, and the budget. Rows stored before numbers were stamped count as the default number.',
      who: WHO,
      query: FILTER,
      ok: d(o({ 'range*': 'object', 'currency*': 'string?', 'agents*': 'object[]', 'kpis*': 'object', 'series*': 'object[]', 'heatmap*': 'object[]', 'byAgent*': 'object[]', 'consumption*': 'object' }), 'See src/app/analytics/types.ts `Overview` for every field.'),
      errors: { 400: 'from and to must be dates (YYYY-MM-DD), from not after to. / Pick 366 days or fewer.', 403: 'Analytics are for supervisors, admins and owners.' },
    },
  },
  '/api/analytics/logs/{kind}': {
    get: {
      id: 'getAnalyticsLog',
      summary: 'Rows behind the charts',
      description: '`kind`: tickets, handovers, escalations, charges (one row per message status with pricing) or agent_usage (per hour). Newest first; columns say how to show each field.',
      who: WHO,
      query: { ...FILTER, skip: d('integer', 'Rows to skip. Default 0.'), limit: d('integer', '1–200. Default 50.') },
      ok: o({ 'kind*': 'string', 'columns*': d('object[]', '{key, label, numeric?}'), 'rows*': 'object[]', 'total*': 'integer' }),
      errors: { 404: 'No log called X.' },
    },
  },
})

const SCHEDULE = o({
  'name*': d('string', 'Up to 80 characters.'),
  'reports*': d('string[]', 'Report ids from GET /api/reports.'),
  'cadence*': d('daily|weekly|monthly', 'daily: yesterday · weekly: Mondays, the last 7 days · monthly: the 1st, last month.'),
  'hour*': d('integer', '0–23, in the support hours’ time zone.'),
  numbers: d('string[]', 'WhatsApp number ids; empty = all agents.'),
  team: 'string?',
  'userIds*': d('string[]', 'Workspace members to email.'),
  emails: d('string[]', 'Anyone else (needs settings.manage).'),
  enabled: 'boolean',
})
const SCHEDULE_ID = { id: d('string', 'Schedule id (UUID).', { format: 'uuid' }) }
const SCHEDULE_ERRORS = {
  400: 'Give the schedule a name. / Pick at least one report. / Add at least one person to send it to. / X isn’t an email address.',
  403: 'Only owners and admins send reports outside the workspace.',
}

export const reports = area('Analytics', {
  '/api/reports': {
    get: { id: 'listReports', summary: 'Reports you can download or schedule', description: 'Each with an id, title, description and whether it comes from the overview or a log.', who: WHO, ok: 'object[]' },
  },
  '/api/reports/{id}.csv': {
    get: {
      id: 'downloadReport',
      summary: 'Download a report as CSV',
      description: 'UTF-8 with a byte-order mark so Excel reads it right; cells that start with = + - @ are quoted as text. Logs give up to 50,000 rows. Answers text/csv as an attachment.',
      who: WHO,
      params: { id: d('string', 'Report id from GET /api/reports (e.g. business_review, tickets).', { pattern: '^[a-z_]+$' }) },
      query: FILTER,
      ok: 'string',
      okType: 'text/csv',
      okDescription: 'The report as a CSV attachment (content-disposition: attachment).',
      errors: { 404: 'No report called X.' },
    },
  },
  '/api/reports/schedules': {
    get: { id: 'listReportSchedules', summary: 'Scheduled report emails', who: WHO, ok: 'object[]' },
    post: { id: 'createReportSchedule', summary: 'Schedule a report email', description: '20 per workspace at most. The email carries the headline numbers; each report is attached as CSV.', who: WHO, body: SCHEDULE, ok: 'object', errors: SCHEDULE_ERRORS },
  },
  '/api/reports/schedules/{id}': {
    put: { id: 'updateReportSchedule', params: SCHEDULE_ID, summary: 'Change a schedule', who: WHO, body: SCHEDULE, ok: 'object', errors: { ...SCHEDULE_ERRORS, 404: 'That schedule no longer exists.' } },
    delete: { id: 'deleteReportSchedule', params: SCHEDULE_ID, summary: 'Delete a schedule', who: WHO, errors: { 404: 'That schedule no longer exists.' } },
  },
  '/api/reports/schedules/{id}/send': {
    post: { id: 'sendReportSchedule', params: SCHEDULE_ID, summary: 'Send a schedule now', description: 'Covers the period its cadence would; doesn’t change when it next goes out.', who: WHO, ok: o({ 'sent*': d('integer', 'People emailed.') }), errors: { 404: 'That schedule no longer exists.', 502: 'Email not sent.' } },
  },
})

const ACTIVITY_FILTER = {
  entity: d('ticket|agent|number', 'One item’s history. Readable by anyone who can see the item (a restricted agent: only their own or unassigned tickets; a number: supervisors and up). Without it, the whole workspace’s log: owners and admins.'),
  entityId: d('string', 'The ticket number, or the number id (`PHONE_NUMBER_ID` = the workspace’s default number).'),
  area: d('tickets|chats|agent|people|contacts|broadcasts|reports|settings|whatsapp', 'One area. Default: all of them.'),
  userId: d('string', 'One person, or `system` for what happened on its own (webhooks, timers, the AI agent).'),
  from: d('string', 'From this date (YYYY-MM-DD) or time (ISO).'),
  to: d('string', 'Up to and including this date, or up to this time.'),
  ref: d('string', 'An error reference (the 8 characters after “Reference:”): everything behind that error, including plumbing events the areas leave out.'),
}
export const activity = area('Workspace', {
  '/api/activity': {
    get: {
      id: 'listActivity',
      summary: 'Activity log',
      description: 'Who did what, newest first, 50 at a time: kind, who, the item, and for edits each changed field as [before, after]. Kept two years. `names` maps the people (and `team:<id>` teams) named in the changes. Sentences for each kind are in src/app/activity/activityText.ts.',
      who: { text: 'Any member for one ticket, the AI agent or a number they can see; owners and admins for the whole workspace.' },
      query: { ...ACTIVITY_FILTER, before: d('string', 'The id of the last row seen, for the next page.') },
      ok: o({ 'events*': d('object[]', '{id, at, kind, userId, actor, entity, entityId, data, changes?, traceId}'), 'more*': 'boolean', 'names*': 'object' }),
      errors: { 403: 'Only owners and admins see the workspace’s activity.', 404: 'That ticket no longer exists.' },
    },
  },
  '/api/activity.csv': {
    get: {
      id: 'downloadActivity',
      summary: 'Download the activity log as CSV',
      description: 'The same filters, up to 10,000 rows: when (UTC), who, what (as a sentence), the item and the error reference.',
      who: { text: 'As GET /api/activity.' },
      query: ACTIVITY_FILTER,
      ok: 'string',
      okType: 'text/csv',
      okDescription: 'The log as a CSV attachment.',
      errors: { 403: 'Only owners and admins see the workspace’s activity.' },
    },
  },
})
