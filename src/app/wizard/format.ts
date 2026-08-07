import type { BusinessHourRow, Day, PaymentMethodId } from './types'
import { PAYMENT_METHOD_OPTIONS } from './mockData'

/** Joins a list with commas and "and" before the last item — no Oxford comma. "A, B and C". */
export function formatList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  const head = items.slice(0, -1).join(', ')
  const tail = items[items.length - 1]
  return `${head} and ${tail}`
}

export function composePaymentSentence(selected: PaymentMethodId[], otherText: string): string {
  if (selected.length === 0) return ''
  const labels = PAYMENT_METHOD_OPTIONS.filter((option) => selected.includes(option.id as PaymentMethodId)).map(
    (option) => (option.id === 'other' ? otherText.trim() || 'Other' : option.label),
  )
  return `We accept ${formatList(labels)}.`
}

const DAY_FULL: Record<Day, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
}

/** Strips a leading zero from the hour: "09:00" -> "9:00", "18:00" stays "18:00". */
function formatTimeLabel(time: string): string {
  return time.replace(/^0(\d:)/, '$1')
}

export function composeBusinessHoursSentence(rows: BusinessHourRow[]): string {
  if (rows.length > 0 && rows.every((r) => r.closed)) return 'Closed every day'

  const openGroups: { days: Day[]; open: string; close: string }[] = []
  let lastOpenIndex = -2
  rows.forEach((row, i) => {
    if (row.closed || !row.open || !row.close) return
    const last = openGroups[openGroups.length - 1]
    if (last && lastOpenIndex === i - 1 && last.open === row.open && last.close === row.close) {
      last.days.push(row.day)
    } else {
      openGroups.push({ days: [row.day], open: row.open, close: row.close })
    }
    lastOpenIndex = i
  })

  const closedDays = rows.filter((r) => r.closed).map((r) => r.day)

  const parts: string[] = []
  if (openGroups.length > 0) {
    const openPhrase = openGroups
      .map((g) => {
        const range = g.days.length === 1 ? DAY_FULL[g.days[0]] : `${DAY_FULL[g.days[0]]} to ${DAY_FULL[g.days[g.days.length - 1]]}`
        return `${range} ${formatTimeLabel(g.open)} to ${formatTimeLabel(g.close)}`
      })
      .join(', ')
    parts.push(`Open ${openPhrase}.`)
  }
  if (closedDays.length > 0) {
    parts.push(`Closed ${formatList(closedDays.map((d) => DAY_FULL[d]))}.`)
  }
  return parts.join(' ')
}

/** "today" / "yesterday" / "N days ago" — used for document upload dates and website read dates. */
export function formatRelativeDate(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function kebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Appends a numeric suffix (kept within 64 chars) until `base` no longer collides with `existing`. */
export function uniqueTitle(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let n = 2
  let candidate: string
  do {
    const suffix = `-${n}`
    candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`
    n++
  } while (existing.includes(candidate))
  return candidate
}
