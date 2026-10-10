// Number formats shared by Analytics and Reports.
export const num = (v: number | null | undefined) => (v == null ? '–' : new Intl.NumberFormat([], { maximumFractionDigits: 0 }).format(v))
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`)
export const dur = (min: number | null | undefined) => (min == null ? '–' : min < 60 ? `${Math.round(min)}m` : min < 60 * 48 ? `${(min / 60).toFixed(min < 600 ? 1 : 0)}h` : `${Math.round(min / 1440)}d`)
export const money = (v: number | null | undefined, currency: string | null) =>
  v == null ? '–' : currency ? new Intl.NumberFormat([], { style: 'currency', currency, maximumFractionDigits: v < 100 ? 2 : 0 }).format(v) : new Intl.NumberFormat([], { maximumFractionDigits: 2 }).format(v)
/** Change against the period before, as a fraction; null when there's nothing to compare. */
export const change = (k: { value: number | null; prev: number | null }) => (k.value == null || k.prev == null || k.prev === 0 ? null : (k.value - k.prev) / Math.abs(k.prev))
/** For rates (0–1): the change in points reads better than a percent of a percent. */
export const pointChange = (k: { value: number | null; prev: number | null }) => (k.value == null || k.prev == null ? null : k.value - k.prev)
/** For chart axes: short and whole (₹1.2K). */
export const moneyShort = (v: number, currency: string | null) =>
  new Intl.NumberFormat([], { ...(currency && { style: 'currency', currency }), notation: 'compact', maximumFractionDigits: 1 }).format(v)
