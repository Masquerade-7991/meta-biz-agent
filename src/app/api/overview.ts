// The central Analytics page's data (server/analytics.ts): all agents or a subset, with the period
// before, and the logs behind the charts. Dummy mode answers in this browser.
import { jsonClient } from './client'
import { dummyAnalytics } from '../analytics/dummyOverview'
import type { AnalyticsFilter, LogKind, LogPage, Overview } from '../analytics/types'

const call = jsonClient(dummyAnalytics)

export const filterQuery = (f: AnalyticsFilter) => {
  const q = new URLSearchParams({ from: f.from, to: f.to })
  if (f.numbers.length) q.set('numbers', f.numbers.join(','))
  if (f.team) q.set('team', f.team)
  if (f.person) q.set('person', f.person)
  return q.toString()
}

export const getOverview = (f: AnalyticsFilter) => call<Overview>(`/api/analytics/overview?${filterQuery(f)}`)
export const getLog = (kind: LogKind, f: AnalyticsFilter, skip = 0, limit = 50) => call<LogPage>(`/api/analytics/logs/${kind}?${filterQuery(f)}&skip=${skip}&limit=${limit}`)
