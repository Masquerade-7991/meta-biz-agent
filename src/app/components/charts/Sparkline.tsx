// A tiny trend line for KPI tiles. Plain SVG on purpose: it shows on Home, which shouldn't load a chart library.
/** `null` is a day with nothing to measure (no chats, no replies): the line breaks there instead of dropping to zero. */
export function Sparkline({ values, className = 'stroke-primary', height = 28 }: { values: (number | null)[]; className?: string; height?: number }) {
  const known = values.filter((v): v is number => v != null)
  if (values.length < 2 || known.length < 2) return null
  const W = 100
  const max = Math.max(...known)
  const min = Math.min(...known)
  const span = max - min || 1
  const segments: string[][] = [[]]
  values.forEach((v, i) => {
    if (v == null) segments.push([])
    else segments.at(-1)!.push(`${(i / (values.length - 1)) * W},${height - 2 - ((v - min) / span) * (height - 4)}`)
  })
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block h-7 w-full" aria-hidden>
      {segments
        .filter((pts) => pts.length > 1)
        .map((pts, i) => (
          <polyline key={i} points={pts.join(' ')} fill="none" className={className} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
    </svg>
  )
}
