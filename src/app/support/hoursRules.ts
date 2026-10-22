// Checks for Hours & targets, in plain words per field: the form shows them as you type, and Dummy
// mode refuses a save with the same words the server uses. Pure, so it's tested under Node.
import type { Day, Holiday, Priority, SupportSettings } from '../api/tickets.ts'

export const DAY_ORDER: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const DAY_LABEL: Record<Day, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const PRIO: Priority[] = ['urgent', 'high', 'normal', 'low']
const PRIO_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }

export const ALL_DAY = { open: '00:00', close: '24:00' }
export const isAllDay = (w: { open: string; close: string } | null) => !!w && w.open === '00:00' && w.close === '24:00'
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/

/** A holiday as {date, name, yearly}, whether it was saved the old way (a bare date) or not. */
export const holidayOf = (h: Holiday) => (typeof h === 'string' ? { date: h, name: '', yearly: false } : { date: h.date, name: h.name ?? '', yearly: !!h.yearly })
export const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d

// Engines list some zones by their old names (Asia/Calcutta); people search for today's (Kolkata).
const MODERN: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Enderbury': 'Pacific/Kanton',
}
/** Every IANA time zone this browser knows, by today's names (the server accepts old and new). */
export function timeZones(): string[] {
  try {
    const z = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (z?.length) return [...new Set(['UTC', ...z.map((x) => MODERN[x] ?? x)])].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)))
  } catch {
    // an older engine: fall through to a short list
  }
  return ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney']
}
export const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return true
  } catch {
    return false
  }
}

/** Problems by field: `timezone`, `day.<day>`, `holiday`, `sla.<priority>.<firstResponse|resolve>`, `routing`. */
export function hoursErrors(s: Pick<SupportSettings, 'hours' | 'sla' | 'routing'>): Record<string, string> {
  const e: Record<string, string> = {}
  if (!validZone(s.hours.timezone)) e.timezone = 'Pick a time zone from the list.'
  for (const d of DAY_ORDER) {
    const w = s.hours.week[d]
    if (!w) continue
    if (!TIME.test(w.open) || !TIME.test(w.close)) e[`day.${d}`] = `${DAY_LABEL[d]}: enter both times.`
    else if (w.close <= w.open) e[`day.${d}`] = `${DAY_LABEL[d]}: closing time must be after opening.`
  }
  if (s.hours.holidays.some((h) => !validDate(holidayOf(h).date))) e.holiday = 'One of the holidays isn’t a real date.'
  for (const p of PRIO) {
    const t = s.sla[p]
    for (const k of ['firstResponse', 'resolve'] as const) {
      const v = t?.[k]
      if (!Number.isInteger(v) || v < 1) e[`sla.${p}.${k}`] = `${PRIO_LABEL[p]}: enter whole minutes, 1 or more.`
      else if (v > 60 * 24 * 90) e[`sla.${p}.${k}`] = `${PRIO_LABEL[p]}: keep it under 90 days.`
    }
    if (!e[`sla.${p}.resolve`] && !e[`sla.${p}.firstResponse`] && t.resolve < t.firstResponse) e[`sla.${p}.resolve`] = `${PRIO_LABEL[p]}: resolve can’t be sooner than the first reply.`
  }
  if (s.routing.mode === 'fixed' && !s.routing.userId) e.routing = 'Pick the person who gets every new ticket.'
  return e
}

/** No day open and not 24/7: response deadlines would never run. */
export const noHours = (s: Pick<SupportSettings, 'hours' | 'twentyFourSeven'>) => !s.twentyFourSeven && DAY_ORDER.every((d) => !s.hours.week[d])

/** The first problem as one sentence (Dummy mode's 400), or null. */
export function supportSettingsError(s: SupportSettings, confirmNoHours: boolean): string | null {
  const first = Object.values(hoursErrors(s))[0]
  if (first) return first
  if (noHours(s) && !confirmNoHours) return 'Every day is closed, so response deadlines would never run. Open at least one day, turn on 24/7, or confirm.'
  return null
}

/** A holiday date that's already gone (and doesn't repeat) can't be added. */
export const pastHoliday = (date: string, yearly: boolean, today = new Date().toISOString().slice(0, 10)) => !yearly && date < today
