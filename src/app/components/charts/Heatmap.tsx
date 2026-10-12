const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** When customers write in: 7 weekdays × 24 hours, darker = busier. `cells[day][hour]`, Monday first. */
export function Heatmap({ cells, label, empty = 'No customer messages in these dates.' }: { cells: number[][]; label: string; empty?: string }) {
  const max = Math.max(1, ...cells.flat())
  // The busiest weekday and hour, named (not just its count).
  let busiest = { d: -1, h: -1, v: 0 }
  cells.forEach((row, d) => row.forEach((v, h) => v > busiest.v && (busiest = { d, h, v })))
  if (!busiest.v) return <p className="flex h-40 items-center justify-center rounded-md bg-muted/40 text-sm text-muted-foreground">{empty}</p>
  return (
    <figure className="space-y-2 overflow-x-auto">
      <div role="img" aria-label={label} className="grid min-w-md grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-0.5 text-micro text-muted-foreground">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {DAYS.map((d, di) => (
          <div key={d} className="contents">
            <span className="self-center">{d}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const v = cells[di]?.[h] ?? 0
              return <span key={h} title={`${d} ${h}:00 · ${v}`} className="aspect-square rounded-sm" style={{ background: v ? `color-mix(in oklab, var(--chart-1) ${15 + (v / max) * 85}%, var(--muted))` : 'var(--muted)' }} />
            })}
          </div>
        ))}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Darker means more messages. Busiest: {DAYS[busiest.d]} {String(busiest.h).padStart(2, '0')}:00 ({busiest.v} message{busiest.v === 1 ? '' : 's'}).
      </figcaption>
    </figure>
  )
}
