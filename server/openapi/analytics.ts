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
