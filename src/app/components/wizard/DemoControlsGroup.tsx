import type { ReactNode } from 'react'

/** One labelled cluster of demo/prototype controls inside the floating Demo controls panel. */
export function DemoControlsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-semibold">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
