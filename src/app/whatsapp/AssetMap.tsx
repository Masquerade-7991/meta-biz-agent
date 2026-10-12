import { ArrowRight } from 'lucide-react'
import { assetMap, type SignupAssets, type SignupFlow } from './signupLink'
import { cn } from '@/app/lib/utils'

/** What Meta's signup connects and where each piece lands in Helo.ai. With `assets`, the ids Meta
 *  reported are shown next to each piece. */
export function AssetMap({ flow, workspace, assets, className }: { flow: SignupFlow; workspace: string; assets?: SignupAssets | null; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border', className)}>
      <p className="border-b border-border px-4 py-2.5 text-sm font-medium">{assets ? 'What Meta connected' : 'What gets connected'}</p>
      <ul className="divide-y divide-border">
        {assetMap(flow, workspace, assets ?? null).map((r) => (
          <li key={r.meta} data-density-row className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[11rem_1.25rem_minmax(0,1fr)] sm:gap-2">
            <span className="font-medium">
              {r.meta}
              {r.id && <span className="block font-mono text-xs font-normal text-muted-foreground">{r.id}</span>}
            </span>
            <ArrowRight className="hidden size-4 text-muted-foreground sm:mt-0.5 sm:block" aria-hidden />
            <span className="text-muted-foreground">{r.helo}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
