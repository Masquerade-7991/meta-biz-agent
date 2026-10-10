import { useEffect, useState } from 'react'
import { errorDetail } from '@/app/api/meta'
import { getSupportAnalytics, type SupportAnalytics } from '@/app/api/tickets'
import { PillTabs } from '@/app/components/Filters'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { KpiTile as Kpi } from '@/app/components/ui/kpi'
import { TimeSeriesChart } from '@/app/components/charts/TimeSeriesChart'

const RANGES = [7, 30, 90] as const
const dur = (m: number | null) => (m === null ? '–' : m < 60 ? `${Math.round(m)}m` : m < 60 * 48 ? `${(m / 60).toFixed(m < 600 ? 1 : 0)}h` : `${Math.round(m / 1440)}d`)
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`)

/** How the support team is doing: volume, speed, SLAs, satisfaction, AI vs people, broadcasts. */
export function SupportAnalyticsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7)
  const [data, setData] = useState<SupportAnalytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null)
    getSupportAnalytics(days).then(setData, (err) => setError(errorDetail(err)))
  }, [days])
  const d = data

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Analytics</h1>
          <p className="mt-1 text-muted-foreground">How your team and AI agent handle customers. Your agent&rsquo;s own numbers are on its Analytics tab.</p>
        </div>
        <PillTabs label="Date range" options={RANGES.map((r) => ({ id: r, label: `Last ${r} days` }))} value={days} onChange={setDays} />
      </div>
      {error ? (
        <p className="mt-6 text-destructive text-sm">
          {error}
        </p>
      ) : !d ? (
        <PageLoader context="analytics" />
      ) : (
        <div className="mt-6 space-y-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Tickets opened" value={String(d.created)} sub={`${d.resolved} resolved · ${d.open} open now`} />
            <Kpi label="Typical first reply" value={dur(d.medianFirstReplyMin)} sub={`First-reply target met ${pct(d.slaFirstReplyMet)}`} />
            <Kpi label="Typical time to resolve" value={dur(d.medianResolveMin)} sub={`Resolution target met ${pct(d.slaResolveMet)}`} />
            <Kpi label="Customer satisfaction" value={d.csat.average === null ? '–' : `${Math.round(((d.csat.good + d.csat.okay * 0.5) / Math.max(1, d.csat.responses)) * 100)}%`} sub={d.csat.responses ? `${d.csat.good} good · ${d.csat.okay} okay · ${d.csat.bad} bad` : 'No answers yet'} />
          </div>
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-section font-semibold">Tickets per day</h2>
            <div className="mt-4">
              <TimeSeriesChart
                data={d.series}
                label={`Tickets opened and resolved per day over ${d.series.length} days`}
                series={[
                  { key: 'created', label: 'Opened' },
                  { key: 'resolved', label: 'Resolved' },
                ]}
              />
            </div>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3 rounded-lg border border-border p-5">
              <h2 className="text-section font-semibold">Who handled chats</h2>
              {d.chats.total ? (
                <>
                  <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${d.chats.aiOnly} by the AI alone, ${d.chats.withTeam} with your team`}>
                    <div className="bg-primary" style={{ width: `${(d.chats.aiOnly / d.chats.total) * 100}%` }} />
                    <div className="bg-warning" style={{ width: `${(d.chats.withTeam / d.chats.total) * 100}%` }} />
                  </div>
                  <p className="text-sm">
                    The AI agent handled <strong>{pct(d.chats.aiOnly / d.chats.total)}</strong> of {d.chats.total} chats on its own; your team stepped into {d.chats.withTeam}.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No chats in this period.
                </p>
              )}
            </section>
            <section className="space-y-3 rounded-lg border border-border p-5">
              <h2 className="text-section font-semibold">Broadcasts</h2>
              <div className="grid grid-cols-3 gap-3">
                <Kpi label="Sent" value={String(d.broadcasts.sent)} />
                <Kpi label="Read" value={pct(d.broadcasts.sent ? d.broadcasts.read / d.broadcasts.sent : null)} />
                <Kpi label="Replied" value={pct(d.broadcasts.sent ? d.broadcasts.replied / d.broadcasts.sent : null)} />
              </div>
            </section>
          </div>
          <section className="rounded-lg border border-border p-5">
            <h2 className="text-section font-semibold">By person</h2>
            {d.people.length ? (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-muted-foreground text-xs">
                  <tr>
                    <th className="py-2 font-normal">Person</th>
                    <th className="py-2 text-right font-normal">Resolved</th>
                    <th className="py-2 text-right font-normal">Open now</th>
                    <th className="py-2 text-right font-normal">Typical first reply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.people.map((p) => (
                    <tr key={p.name}>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 text-right">{p.resolved}</td>
                      <td className="py-2 text-right">{p.open}</td>
                      <td className="py-2 text-right">{dur(p.medianFirstReplyMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-muted-foreground text-sm">
                No tickets in this period.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
