import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { addDays, type AnalyticsFilter } from './types'

export const PRESETS = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: 'mtd', label: 'This month', days: 0 },
] as const

/** Today in the workspace's time zone (its support hours), so "today" is the business's day, not the
 *  viewer's: someone in New York reading an Indian workspace's numbers in the evening. */
const today = (tz?: string) => new Intl.DateTimeFormat('en-CA', tz ? { timeZone: tz } : {}).format(new Date())
const presetRange = (id: string, tz?: string) => {
  const to = today(tz)
  if (id === 'mtd') return { from: to.slice(0, 8) + '01', to }
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[1]
  return { from: addDays(to, -(p.days - 1)), to }
}

/** The page's filters live in the address, so a view can be bookmarked or shared. `tz`: the
 *  workspace's time zone, once known (until then the browser's). */
export function useAnalyticsFilter(tz?: string) {
  const [q, setQ] = useSearchParams()
  const filter: AnalyticsFilter = useMemo(() => {
    const preset = presetRange(q.get('range') ?? '30', tz)
    return {
      from: q.get('from') ?? preset.from,
      to: q.get('to') ?? preset.to,
      numbers: (q.get('agents') ?? '').split(',').filter(Boolean),
      team: q.get('team'),
      person: q.get('person'),
    }
  }, [q, tz])
  const range = q.get('from') ? 'custom' : (q.get('range') ?? '30')
  const set = useCallback(
    (patch: Record<string, string | null>) =>
      setQ(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true },
      ),
    [setQ],
  )
  return { filter, range, set, tab: q.get('tab') ?? 'overview' }
}
