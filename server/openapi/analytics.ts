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
      query: FILTER,
      errors: { 404: 'No report called X.' },
    },
  },
  '/api/reports/schedules': {
    get: { id: 'listReportSchedules', summary: 'Scheduled report emails', who: WHO, ok: 'object[]' },
    post: { id: 'createReportSchedule', summary: 'Schedule a report email', description: '20 per workspace at most. The email carries the headline numbers; each report is attached as CSV.', who: WHO, body: SCHEDULE, ok: 'object', errors: SCHEDULE_ERRORS },
  },
  '/api/reports/schedules/{id}': {
    put: { id: 'updateReportSchedule', summary: 'Change a schedule', who: WHO, body: SCHEDULE, ok: 'object', errors: { ...SCHEDULE_ERRORS, 404: 'That schedule no longer exists.' } },
    delete: { id: 'deleteReportSchedule', summary: 'Delete a schedule', who: WHO, errors: { 404: 'That schedule no longer exists.' } },
  },
  '/api/reports/schedules/{id}/send': {
    post: { id: 'sendReportSchedule', summary: 'Send a schedule now', description: 'Covers the period its cadence would; doesn’t change when it next goes out.', who: WHO, ok: o({ 'sent*': d('integer', 'People emailed.') }), errors: { 404: 'That schedule no longer exists.', 502: 'Email not sent.' } },
  },
})
