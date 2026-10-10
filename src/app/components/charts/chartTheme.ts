// Shared look for every chart: colours come from the theme tokens, so charts follow light and dark.
export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'] as const

export const colorAt = (i: number) => CHART_COLORS[i % CHART_COLORS.length]

export type SeriesKind = 'bar' | 'line' | 'area'

export interface Series<K extends string = string> {
  key: K
  label: string
  kind?: SeriesKind
  color?: string
  /** Series with the same stack id are stacked. */
  stack?: string
  /** Plot against the right-hand axis (e.g. a rate next to counts). */
  right?: boolean
  format?: (v: number) => string
}

export const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' }

export const shortDate = (iso: string) => {
  const d = new Date(iso.length === 10 ? iso + 'T00:00' : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export const compact = (v: number) => (Math.abs(v) >= 1000 ? new Intl.NumberFormat([], { notation: 'compact', maximumFractionDigits: 1 }).format(v) : String(Math.round(v * 100) / 100))

export const percent = (v: number) => `${Math.round(v * 100)}%`
