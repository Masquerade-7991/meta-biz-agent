import { useEffect, useState } from 'react'
import { errorDetail } from '@/app/api/meta'
import { getSupportAnalytics, type SupportAnalytics } from '@/app/api/tickets'
import { PillTabs } from '@/app/components/Filters'
import { PageLoader } from '@/app/components/ui/wavy-loader'

const RANGES = [7, 30, 90] as const
const dur = (m: number | null) => (m === null ? '–' : m < 60 ? `${Math.round(m)}m` : m < 60 * 48 ? `${(m / 60).toFixed(m < 600 ? 1 : 0)}h` : `${Math.round(m / 1440)}d`)
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`)

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-muted-foreground text-xs">
        {label}
      </p>
      <p className="mt-1" style={{ fontSize: '1.75rem', fontWeight: 'var(--font-weight-semi-bold)', lineHeight: 1.1 }}>
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-muted-foreground text-xs">
          {hint}
        </p>
      )}
    </div>
  )
}

/** Tickets opened vs resolved per day, as paired bars. */
function VolumeChart({ series }: { series: SupportAnalytics['series'] }) {
  const W = 720
  const H = 180
  const max = Math.max(1, ...series.flatMap((d) => [d.created, d.resolved]))
  const slot = W / series.length
  const bar = Math.max(1.5, Math.min(14, slot / 2 - 2))
  const step = Math.ceil(series.length / 10)
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="block h-auto w-full" role="img" aria-label={`Tickets opened and resolved per day over ${series.length} days`}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="stroke-border" strokeDasharray="3 3" />
        ))}
        {series.map((d, i) => {
          const x = i * slot + slot / 2
          return (
            <g key={d.date}>
              <title>{`${d.date}: ${d.created} opened, ${d.resolved} resolved`}</title>
              <rect x={x - bar - 1} y={H - (d.created / max) * H} width={bar} height={(d.created / max) * H} rx={2} className="fill-primary" />
              <rect x={x + 1} y={H - (d.resolved / max) * H} width={bar} height={(d.resolved / max) * H} rx={2} className="fill-success" />
              {i % step === 0 && (
                <text x={x} y={H + 14} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>
                  {new Date(d.date + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="flex gap-4 text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" /> Opened
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" /> Resolved
        </span>
        <span className="ml-auto">Most in a day: {max}</span>
      </figcaption>
    </figure>
  )
}

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
            <Kpi label="Tickets opened" value={String(d.created)} hint={`${d.resolved} resolved · ${d.open} open now`} />
            <Kpi label="Typical first reply" value={dur(d.medianFirstReplyMin)} hint={`First-reply target met ${pct(d.slaFirstReplyMet)}`} />
            <Kpi label="Typical time to resolve" value={dur(d.medianResolveMin)} hint={`Resolution target met ${pct(d.slaResolveMet)}`} />
            <Kpi label="Customer satisfaction" value={d.csat.average === null ? '–' : `${Math.round(((d.csat.good + d.csat.okay * 0.5) / Math.max(1, d.csat.responses)) * 100)}%`} hint={d.csat.responses ? `${d.csat.good} good · ${d.csat.okay} okay · ${d.csat.bad} bad` : 'No answers yet'} />
          </div>
          <section className="rounded-lg border border-border p-5">
            <h2 style={{ fontSize: '1.125rem', fontWeight: 'var(--font-weight-semi-bold)' }}>Tickets per day</h2>
            <div className="mt-4">
              <VolumeChart series={d.series} />
            </div>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3 rounded-lg border border-border p-5">
              <h2 style={{ fontSize: '1.125rem', fontWeight: 'var(--font-weight-semi-bold)' }}>Who handled chats</h2>
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
              <h2 style={{ fontSize: '1.125rem', fontWeight: 'var(--font-weight-semi-bold)' }}>Broadcasts</h2>
              <div className="grid grid-cols-3 gap-3">
                <Kpi label="Sent" value={String(d.broadcasts.sent)} />
                <Kpi label="Read" value={pct(d.broadcasts.sent ? d.broadcasts.read / d.broadcasts.sent : null)} />
                <Kpi label="Replied" value={pct(d.broadcasts.sent ? d.broadcasts.replied / d.broadcasts.sent : null)} />
              </div>
            </section>
          </div>
          <section className="rounded-lg border border-border p-5">
            <h2 style={{ fontSize: '1.125rem', fontWeight: 'var(--font-weight-semi-bold)' }}>By person</h2>
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
