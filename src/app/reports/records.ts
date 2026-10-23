// How a record report's cells read on screen: durations, times in the viewer's own format, statuses as pills.
import type { LogKind, LogPage } from '../analytics/types.ts'
import type { Tone } from '../lib/status.ts'

/** What one row is, singular and plural, for the count above the table. */
export const LOG_NOUN: Record<LogKind, [string, string]> = {
  conversations: ['conversation', 'conversations'],
  tickets: ['ticket', 'tickets'],
  handovers: ['handover', 'handovers'],
  escalations: ['escalation', 'escalations'],
  csat: ['rating', 'ratings'],
  charges: ['priced message', 'priced messages'],
  agent_usage: ['hour', 'hours'],
}

/** "Minutes to first reply" reads "Time to first reply": the cells show 1h 05m, not minutes. */
export const columnLabel = (c: LogPage['columns'][number]) => (c.key.endsWith('Min') ? c.label.replace(/^Minutes to /, 'Time to ') : c.label)

const PILLS: Record<string, Record<string, [string, Tone]>> = {
  status: { open: ['Open', 'info'], pending: ['Waiting', 'warning'], resolved: ['Resolved', 'success'], closed: ['Closed', 'neutral'], delivered: ['Delivered', 'success'], read: ['Read', 'success'], sent: ['Sent', 'neutral'], failed: ['Failed', 'danger'] },
  sla: { met: ['Met', 'success'], missed: ['Missed', 'danger'], overdue: ['Overdue', 'warning'], running: ['Running', 'neutral'] },
  csat: { good: ['Good', 'success'], okay: ['Okay', 'warning'], bad: ['Bad', 'danger'] },
  answeredBy: { ai: ['AI alone', 'info'], team: ['Team', 'neutral'], none: ['No reply', 'warning'] },
}
PILLS.rating = PILLS.csat

/** A status-like cell as a pill (its words and tone); null for anything else. */
export function statusOf(key: string, v: unknown): { label: string; tone: Tone } | null {
  const hit = typeof v === 'string' ? PILLS[key]?.[v.toLowerCase()] : undefined
  return hit ? { label: hit[0], tone: hit[1] } : null
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
/** A cell as text: ISO times in the viewer's format, numbers with separators, empty as a dash. */
export function cellText(v: string | number | null) {
  if (v == null || v === '') return '–'
  if (typeof v === 'number') return new Intl.NumberFormat([], { maximumFractionDigits: 2 }).format(v)
  if (ISO.test(v)) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  }
  return v
}
