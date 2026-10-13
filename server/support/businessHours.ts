// Business-hours arithmetic for SLAs: deadlines only count minutes when the team is working.
// Hours are local to the workspace's time zone; holidays are whole local dates.

export type Day = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export const DAYS: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export interface Hours {
  timezone: string
  /** Per weekday: opening and closing time as "HH:MM"; null = closed all day. */
  week: Record<Day, { open: string; close: string } | null>
  /** Local dates ("YYYY-MM-DD") when the team is off. */
  holidays: string[]
}

const MIN = 60_000
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

const formats = new Map<string, Intl.DateTimeFormat>()
/** Local date, weekday and minute-of-day of an instant in `tz`. */
function local(t: Date, tz: string) {
  let f = formats.get(tz)
  if (!f) formats.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })))
  const parts = Object.fromEntries(f.formatToParts(t).map((p) => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: parts.weekday.slice(0, 3).toLowerCase() as Day,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/** The working window [from, to) in local minutes for the day containing `t`, or null. */
function windowOf(t: Date, h: Hours) {
  const l = local(t, h.timezone)
  const w = h.week[l.day]
  if (!w || h.holidays.includes(l.date)) return { l, win: null }
  const open = toMin(w.open)
  const close = toMin(w.close)
  return { l, win: close > open ? { open, close } : null }
}

export function isOpen(t: Date, h: Hours): boolean {
  const { l, win } = windowOf(t, h)
  return !!win && l.minute >= win.open && l.minute < win.close
}

/** At most this many real minutes per step, then the local time is read again: a clock change
 *  (DST) moves wall time by up to an hour, so wall-minute arithmetic over longer steps miscounts. */
const STEP = 60

/** `start` plus `minutes` of working time, counted in real minutes, so it stays correct across DST. */
export function addBusinessMinutes(start: Date, minutes: number, h: Hours): Date {
  let t = new Date(Math.floor(start.getTime() / MIN) * MIN)
  let left = minutes
  // ponytail: hour-long steps for up to a year (about 9,000 when nothing is ever open → "never").
  for (let guard = 0; guard < 366 * 25 && left > 0; guard++) {
    const { l, win } = windowOf(t, h)
    if (win && l.minute >= win.open && l.minute < win.close) {
      const step = Math.min(left, win.close - l.minute, STEP)
      t = new Date(t.getTime() + step * MIN)
      left -= step
    } else {
      // Towards the next open time today, or the next local midnight.
      const jump = win && l.minute < win.open ? win.open - l.minute : 24 * 60 - l.minute
      t = new Date(t.getTime() + Math.min(jump, STEP) * MIN)
    }
  }
  return left > 0 ? new Date(8.64e15) : t
}

export const DEFAULT_HOURS: Hours = {
  timezone: 'Asia/Kolkata',
  week: {
    sun: null,
    mon: { open: '09:30', close: '18:30' },
    tue: { open: '09:30', close: '18:30' },
    wed: { open: '09:30', close: '18:30' },
    thu: { open: '09:30', close: '18:30' },
    fri: { open: '09:30', close: '18:30' },
    sat: { open: '10:00', close: '14:00' },
  },
  holidays: [],
}
