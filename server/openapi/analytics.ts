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
        'Headline numbers with the same-length period before, a series per day (weeks and months are rolled up from it by the client: counts and money add up, rates from their counts), customer messages by weekday and hour, per agent, people, teams, escalations, tools (Meta’s insights) and consumption: WhatsApp spend by category, the Business Agent’s usage, service replies against the 1,000 free per number each month, and the budget. Handovers count the AI handing over and someone taking over (the same rows as the handovers log). `kpis.openNow`, `overdueNow` and `peopleAvailable` are right now, whatever the dates; `byAgent[].serviceMessages` is for the chosen dates. WhatsApp spend is Meta’s per account, never per number: `spendWholeAccount` is true when the agents filter leaves some out (spend then still covers them all, and `costPerResolved` is null). Rows stored before numbers were stamped count as the default number.',
      who: WHO,
      query: FILTER,
      ok: d(o({ 'range*': 'object', 'currency*': 'string?', 'spendWholeAccount*': d('boolean', 'WhatsApp spend covers agents outside the filter.'), 'agents*': 'object[]', 'kpis*': 'object', 'series*': 'object[]', 'heatmap*': 'object[]', 'byAgent*': 'object[]', 'consumption*': 'object' }), 'See src/app/analytics/types.ts `Overview` for every field.'),
      errors: { 400: 'from and to must be dates (YYYY-MM-DD), from not after to. / Pick 366 days or fewer.', 403: 'Analytics are for supervisors, admins and owners.' },
    },
  },
  '/api/analytics/logs/{kind}': {
    get: {
      id: 'getAnalyticsLog',
      summary: 'Rows behind the charts',
      description:
        '`kind`: conversations (one row per chat in the dates: started, customer, agent, answeredBy `ai`|`team`|`none`, firstReplyMin, messages, its ticket and rating; team and person don’t apply), tickets, handovers (the AI handing over or someone taking over, with `how`), escalations, csat (one row per rating of a ticket resolved in the dates: when, customer, ticket, rating `good`|`okay`|`bad`, team, assignee, comment), charges (one row per message status with pricing) or agent_usage (per hour). Newest first unless `sort` says otherwise; columns say how to show each field and which can be sorted.',
      who: WHO,
      query: {
        ...FILTER,
        skip: d('integer', 'Rows to skip. Default 0.'),
        limit: d('integer', '1–200. Default 50.'),
        sort: d('string', 'A column key marked `sortable`. conversations: started, firstReplyMin, messages, answeredBy · tickets: opened, ticket, status, firstReplyMin, resolveMin, level · handovers: at, ticket, how, firstReplyMin, status · escalations: at, ticket, level · csat: when, ticket, rating · charges: at, category, type, billable, status · agent_usage: hour, messages, tokens, cost. Default: the first (the newest first).'),
        dir: d('asc|desc', 'Default desc.'),
      },
      ok: o({ 'kind*': 'string', 'columns*': d('object[]', '{key, label, numeric?, sortable?}'), 'rows*': 'object[]', 'total*': 'integer', sort: d('object', '{key, dir}: the order the rows are in.') }),
      errors: { 400: 'The X log can be sorted by … / dir must be asc or desc.', 404: 'No log called X.' },
    },
  },
})

const SCHEDULE = o({
  'name*': d('string', 'Up to 80 characters.'),
  'reports*': d('string[]', 'Report ids from GET /api/reports; old ids are saved as their new one. The email’s button opens the first.'),
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
    get: { id: 'listReports', summary: 'Reports you can download or schedule', description: 'Each with an id, title, description, its group (summary or records), whether it comes from the overview or a log, and the filters it applies besides the date (agents, team, person).', who: WHO, ok: 'object[]' },
  },
  '/api/reports/{id}.csv': {
    get: {
      id: 'downloadReport',
      summary: 'Download a report as CSV',
      description:
        'UTF-8 with a byte-order mark so Excel reads it right; cells that start with = + - @ are quoted as text. Summaries: business_review, ai_agent, conversations, team, response_sla, csat, spend (their first table, by day). Records: conversations_log, tickets, handovers, escalations, csat_responses, charges, agent_usage, up to 50,000 rows. Old ids still work and give their new report: daily → business_review, agents → ai_agent, people and teams → team, consumption → spend. Answers text/csv as an attachment.',
      who: WHO,
      params: { id: d('string', 'Report id from GET /api/reports (e.g. business_review, tickets), or an old one.', { pattern: '^[a-z_]+$' }) },
      query: { ...FILTER, sort: d('string', 'Records only: a sortable column of its log (see GET /api/analytics/logs/{kind}).'), dir: d('asc|desc', 'Records only. Default desc.') },
      ok: 'string',
      okType: 'text/csv',
      okDescription: 'The report as a CSV attachment (content-disposition: attachment).',
      errors: { 400: 'The X log can be sorted by … / dir must be asc or desc.', 404: 'No report called X.' },
    },
  },
  '/api/reports/schedules': {
    get: { id: 'listReportSchedules', summary: 'Scheduled report emails', description: 'Reports saved under an old id (daily, agents, people, teams, consumption) are listed, and sent, as their new one.', who: WHO, ok: 'object[]' },
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
  area: d('tickets|chats|agent|people|contacts|templates|reports|settings|whatsapp', 'One area. Default: all of them.'),
  userId: d('string', 'One person, or `system` for what happened on its own (webhooks, timers, the AI agent).'),
  from: d('string', 'From this date (YYYY-MM-DD, a whole day in the support hours’ time zone) or time (ISO).'),
  to: d('string', 'Up to and including this date (in the support hours’ time zone), or up to this time.'),
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
      description:
        'The same filters, up to 10,000 rows: when (UTC), who, what (as a sentence), the item and the error reference. When there are more, the file ends with the line `First 10000 rows of N; narrow the dates` and the response has the header `x-truncated: N`.',
      who: { text: 'As GET /api/activity.' },
      query: ACTIVITY_FILTER,
      ok: 'string',
      okType: 'text/csv',
      okDescription: 'The log as a CSV attachment.',
      errors: { 403: 'Only owners and admins see the workspace’s activity.' },
    },
  },
})
