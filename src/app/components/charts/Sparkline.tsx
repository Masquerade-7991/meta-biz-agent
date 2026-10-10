// A tiny trend line for KPI tiles. Plain SVG on purpose: it shows on Home, which shouldn't load a chart library.
export function Sparkline({ values, className = 'stroke-primary', height = 28 }: { values: number[]; className?: string; height?: number }) {
  if (values.length < 2) return null
  const W = 100
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${height - 2 - ((v - min) / span) * (height - 4)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block h-7 w-full" aria-hidden>
      <polyline points={pts} fill="none" className={className} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
