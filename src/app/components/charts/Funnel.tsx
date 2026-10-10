import { compact, percent } from './chartTheme'

/** Steps that narrow (sent → delivered → read → replied), each with its share of the first step. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const first = steps[0]?.value || 0
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const share = first ? s.value / first : 0
        return (
          <li key={s.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
            <span className="text-muted-foreground">{s.label}</span>
            <div className="h-6 overflow-hidden rounded-md bg-muted">
              <div className="h-full rounded-md" style={{ width: `${Math.max(share * 100, s.value ? 2 : 0)}%`, background: `color-mix(in oklab, var(--chart-1) ${100 - i * 18}%, transparent)` }} />
            </div>
            <span className="w-24 text-right tabular-nums">
              <span className="font-medium">{compact(s.value)}</span>
              {i > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{percent(share)}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
