// Number formats shared by Analytics and Reports.
export const num = (v: number | null | undefined) => (v == null ? '–' : new Intl.NumberFormat([], { maximumFractionDigits: 0 }).format(v))
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`)
/** Minutes as 45m, 1.5h, 12h or 3d. Rounded first, so 59.6 minutes reads 1.0h, never "60m". */
export const dur = (min: number | null | undefined) => {
  if (min == null) return '–'
  const m = Math.round(min)
  return m < 60 ? `${m}m` : m < 60 * 48 ? `${(m / 60).toFixed(m < 600 ? 1 : 0)}h` : `${Math.round(m / 1440)}d`
}
export const money = (v: number | null | undefined, currency: string | null) =>
  v == null ? '–' : currency ? new Intl.NumberFormat([], { style: 'currency', currency, maximumFractionDigits: v < 100 ? 2 : 0 }).format(v) : new Intl.NumberFormat([], { maximumFractionDigits: 2 }).format(v)
/** Change against the period before, as a fraction; null when there's nothing to compare. */
export const change = (k: { value: number | null; prev: number | null }) => (k.value == null || k.prev == null || k.prev === 0 ? null : (k.value - k.prev) / Math.abs(k.prev))
/** For rates (0–1): the change in points reads better than a percent of a percent. */
export const pointChange = (k: { value: number | null; prev: number | null }) => (k.value == null || k.prev == null ? null : k.value - k.prev)
/** For chart axes: short and whole (₹1.2K). */
export const moneyShort = (v: number, currency: string | null) =>
  new Intl.NumberFormat([], { ...(currency && { style: 'currency', currency }), notation: 'compact', maximumFractionDigits: 1 }).format(v)
/** Minutes as 12m, 1h 05m or 2d 3h: for tables, where 1.5h reads oddly. */
export const hm = (min: number | null | undefined) => {
  if (min == null) return '–'
  const m = Math.round(min)
  if (m < 60) return `${m}m`
  if (m < 60 * 48) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h`
}
/** A YYYY-MM-DD day as "Mon 12 Oct". */
export const dayLabel = (d: string) => new Date(d + 'T00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
