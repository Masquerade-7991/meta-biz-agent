import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOmnibarScope } from '@/app/omnibar/OmnibarContext'
import { matchesText } from '@/app/omnibar/rank'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Download, FileText } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { PageContainer, PageHeader } from '@/app/components/ui/page'
import { useAuth } from '@/app/auth/AuthContext'
import { useMembers } from '@/app/auth/useMembers'
import { getOverview } from '@/app/api/overview'
import { getSupportSettings, listTeams, type Team } from '@/app/api/tickets'
import { can } from '@/app/lib/permissions'
import { useAnalyticsFilter } from '@/app/analytics/useAnalyticsFilter'
import { blankSchedule, isReport, REPORT_GROUPS, reportOf, REPORTS, type ReportId, type ReportSchedule } from './catalog'
import { ReportCard } from './ReportCard'
import { ReportView } from './ReportView'
import { ExportDialog } from './ExportDialog'
import { Schedules } from './Schedules'

/**
 * Reports, three ways in: the library (/reports) lists every report; a report's own page
 * (/reports/<id>) shows it on screen with Download; Export… downloads several at once; and
 * /reports/schedules emails them on a schedule. Filters live in the address, so they carry over.
 */
export function ReportsPage() {
  const { me } = useAuth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [q] = useSearchParams()
  const [timezone, setTimezone] = useState<string | undefined>()
  const { filter, range, set } = useAnalyticsFilter(timezone)
  const members = useMembers()
  const [agents, setAgents] = useState<{ id: string; label: string }[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [exporting, setExporting] = useState(false)
  const [start, setStart] = useState<Omit<ReportSchedule, 'id'> | null>(null)

  const sub = pathname.split('/')[2] ?? ''
  const reportId: ReportId | null = isReport(sub) ? sub : null
  const go = (to: string) => navigate(`/reports${to ? `/${to}` : ''}${search}`)

  useEffect(() => {
    listTeams().then(setTeams, () => {})
    getSupportSettings().then((s) => setTimezone(s.hours.timezone), () => {})
    // The agents for the filter come with the overview; a short period keeps it light.
    getOverview({ ...filter, from: filter.to }).then((o) => setAgents(o.agents), () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // A report's "Email on a schedule…" lands here with ?schedule=new&report=<id>.
  useEffect(() => {
    if (q.get('schedule') !== 'new') return
    const report = q.get('report')
    const base = blankSchedule(me?.user.id)
    setStart({ ...base, ...(isReport(report) && { name: `${reportOf(report).title} by email`, reports: [report] }), numbers: filter.numbers, team: filter.team })
    const rest = new URLSearchParams(q)
    rest.delete('schedule')
    rest.delete('report')
    navigate(`/reports/schedules${rest.size ? `?${rest}` : ''}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const started = useCallback(() => setStart(null), [])

  // The omnibar filters the library's cards (title and description).
  const [text, setText] = useState('')
  const library = !reportId && sub !== 'schedules'
  const shown = REPORTS.filter((r) => matchesText(text, r.title, r.description))
  useOmnibarScope(
    useMemo(
      () =>
        library
          ? {
              id: 'reports',
              placeholder: 'Search reports',
              query: { value: text, onChange: setText },
              items: shown.slice(0, 6).map((r) => ({ id: r.id, label: r.title, hint: 'Report', icon: FileText, run: () => go(r.id) })),
            }
          : null,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [library, text, search],
    ),
  )

  if (reportId)
    return (
      <PageContainer>
        <ReportView
          id={reportId}
          filter={filter}
          range={range}
          set={set}
          agents={agents}
          teams={teams}
          members={members}
          timezone={timezone}
          onBack={() => go('')}
          onSchedule={() => navigate(`/reports/schedules?schedule=new&report=${reportId}${search ? `&${search.slice(1)}` : ''}`)}
        />
      </PageContainer>
    )

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        actions={
          <Button variant="outline" onClick={() => setExporting(true)}>
            <Download className="size-4" /> Export…
          </Button>
        }
      />
      <Tabs value={sub === 'schedules' ? 'schedules' : 'library'} onValueChange={(v) => go(v === 'schedules' ? 'schedules' : '')} className="mb-6">
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="schedules">Scheduled emails</TabsTrigger>
        </TabsList>
      </Tabs>

      {sub === 'schedules' ? (
        <Schedules meId={me?.user.id} agents={agents} teams={teams} members={members} canEmailOutside={can(me?.role, 'settings.manage')} start={start} onStarted={started} />
      ) : (
        <div className="space-y-10">
          {shown.length === 0 && <p className="text-sm text-muted-foreground">No reports match.</p>}
          {REPORT_GROUPS.filter((g) => shown.some((r) => r.group === g.id)).map((g) => (
            <section key={g.id} className="space-y-3">
              <h2 className="text-section font-semibold">{g.title}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shown.filter((r) => r.group === g.id).map((r) => (
                  <li key={r.id}>
                    <ReportCard id={r.id} to={`/reports/${r.id}${search}`} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <ExportDialog open={exporting} onClose={() => setExporting(false)} filter={filter} range={range} set={set} agents={agents} timezone={timezone} />
    </PageContainer>
  )
}
