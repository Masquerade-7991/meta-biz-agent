// Reports (server/reports.ts): CSV downloads and email schedules. Dummy mode builds the same CSV in
// the browser from the sample analytics, and keeps schedules in this tab.
import { jsonClient } from './client'
import { isDummyMode } from './dummy'
import { MetaError, parse } from './meta'
import { filterQuery, getLog, getOverview } from './overview'
import { isLogReport, nextRunDay, reportFile, reportTable, tableCsv, type ReportId, type ReportSchedule } from '../reports/catalog'
import type { AnalyticsFilter } from '../analytics/types'

let demoSchedules: ReportSchedule[] = [
  {
    id: 'demo-weekly',
    name: 'Weekly business review',
    reports: ['business_review', 'agents', 'consumption'],
    cadence: 'weekly',
    hour: 9,
    numbers: [],
    team: null,
    userIds: ['demo'],
    emails: [],
    enabled: true,
    lastSentAt: null,
    nextRunAt: new Date(nextRunDay('weekly', new Date().toISOString().slice(0, 10), true) + 'T09:00:00').toISOString(),
  },
]

async function dummy<T>(method: string, path: string, body: unknown): Promise<T> {
  const b = (body ?? {}) as ReportSchedule
  const check = () => {
    if (!b.name?.trim()) throw new MetaError(400, 'Check the details', 'Give the schedule a name.')
    if (!b.reports?.length) throw new MetaError(400, 'Check the details', 'Pick at least one report.')
    if (!b.userIds?.length && !b.emails?.length) throw new MetaError(400, 'Check the details', 'Add at least one person to send it to.')
  }
  const next = (s: ReportSchedule) => ({ ...s, nextRunAt: s.enabled ? new Date(nextRunDay(s.cadence, new Date().toISOString().slice(0, 10), true) + `T${String(s.hour).padStart(2, '0')}:00:00`).toISOString() : null })
  if (path === '/api/reports/schedules' && method === 'GET') return demoSchedules as T
  if (path === '/api/reports/schedules' && method === 'POST') {
    check()
    const s = next({ ...b, id: `demo-${Date.now()}`, lastSentAt: null })
    demoSchedules = [...demoSchedules, s]
    return s as T
  }
  const m = path.match(/^\/api\/reports\/schedules\/([^/]+)(\/send)?$/)
  if (m) {
    if (m[2]) {
      demoSchedules = demoSchedules.map((s) => (s.id === m[1] ? { ...s, lastSentAt: new Date().toISOString() } : s))
      return { sent: (demoSchedules.find((s) => s.id === m[1])?.userIds.length ?? 0) + (demoSchedules.find((s) => s.id === m[1])?.emails.length ?? 0) } as T
    }
    if (method === 'DELETE') {
      demoSchedules = demoSchedules.filter((s) => s.id !== m[1])
      return { ok: true } as T
    }
    check()
    const s = next({ ...b, id: m[1] })
    demoSchedules = demoSchedules.map((x) => (x.id === m[1] ? s : x))
    return s as T
  }
  throw new MetaError(404, 'Not found', path)
}
const call = jsonClient(dummy)

export const listSchedules = () => call<ReportSchedule[]>('/api/reports/schedules')
export const createSchedule = (s: Omit<ReportSchedule, 'id'>) => call<ReportSchedule>('/api/reports/schedules', 'POST', s)
export const updateSchedule = (id: string, s: Omit<ReportSchedule, 'id'>) => call<ReportSchedule>(`/api/reports/schedules/${id}`, 'PUT', s)
export const deleteSchedule = (id: string) => call<{ ok: true }>(`/api/reports/schedules/${id}`, 'DELETE')
export const sendScheduleNow = (id: string) => call<{ sent: number }>(`/api/reports/schedules/${id}/send`, 'POST', {})

function save(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Downloads one report as CSV for the filter. Errors reject with the server's reason. */
export async function downloadReport(id: ReportId, f: AnalyticsFilter) {
  const name = reportFile(id, f.from, f.to)
  if (isDummyMode()) {
    const t = isLogReport(id) ? reportTable(id, null, await getLog(id, f, 0, 5000)) : reportTable(id, await getOverview(f), null)
    return save(name, new Blob([tableCsv(t)], { type: 'text/csv;charset=utf-8' }))
  }
  const res = await fetch(`/api/reports/${id}.csv?${filterQuery(f)}`)
  if (!res.ok) await parse(res) // throws the server's {title, detail}
  save(name, await res.blob())
}

/** The print view of a report (Save as PDF from the browser's print dialog). */
export const printUrl = (ids: ReportId[], f: AnalyticsFilter) => `/reports/print?reports=${ids.join(',')}&${filterQuery(f)}`
