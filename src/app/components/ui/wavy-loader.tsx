import { useEffect, useState } from 'react'
import { cn } from '@/app/lib/utils'
import { LOADING_LINES, type LoadingContext } from '@/app/lib/loadingLines'

// The ring's outline: a circle with a gentle sine wave along it, like Material 3's wavy indicator.
const WAVES = 11
const SIZE = 48
const R = 19
const AMP = 1.4
const RING = (() => {
  const steps = 240
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const r = R + AMP * Math.sin(WAVES * t)
    d += `${i ? 'L' : 'M'}${(SIZE / 2 + r * Math.cos(t)).toFixed(2)} ${(SIZE / 2 + r * Math.sin(t)).toFixed(2)}`
  }
  return d + 'Z'
})()

/** The wavy ring on its own: a plain faint track, and a wavy arc that grows, shrinks and turns. */
export function WavyLoader({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={size} height={size} className={cn('wavy-loader text-primary', className)} aria-hidden>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={3} />
      <g className="wavy-loader-spin">
        <path d={RING} pathLength={100} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" className="wavy-loader-arc" />
      </g>
    </svg>
  )
}

/** The big, centred loader for a page or panel, with a line about what's happening that changes
 *  every couple of seconds. `fullscreen` covers the window (used by the Demo controls preview). */
export function PageLoader({ context = 'general', label, fullscreen, className }: { context?: LoadingContext; label?: string; fullscreen?: boolean; className?: string }) {
  const lines = LOADING_LINES[context]
  const [i, setI] = useState(() => Math.floor(Math.random() * lines.length))
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 2200)
    return () => clearInterval(t)
  }, [lines.length])
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
      className={cn(
        'flex flex-col items-center justify-center gap-5 text-center',
        fullscreen ? 'fixed inset-0 z-[70] bg-background/85 backdrop-blur-sm' : 'min-h-[50vh] w-full py-16',
        className,
      )}
    >
      <WavyLoader size={72} />
      <p key={i} className="wavy-loader-line text-sm font-medium text-muted-foreground">
        {lines[i]}
      </p>
    </div>
  )
}
