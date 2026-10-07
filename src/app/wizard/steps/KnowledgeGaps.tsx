import { useEffect, useState } from 'react'
import { MessageCircleQuestion, Plus } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { StatusPill } from '@/app/components/ui/status'
import { listGaps, type Gap } from '@/app/api/assist'

/** Questions from the last week the agent couldn't answer or handed to a person, each one click from
 *  becoming an FAQ. Stays out of the way when there are none (or they can't be loaded). */
export function KnowledgeGaps({ onAddFaq }: { onAddFaq: (question: string) => void }) {
  const [gaps, setGaps] = useState<Gap[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    listGaps(7).then(setGaps, () => setGaps([]))
  }, [])
  if (!gaps?.length) return null
  const shown = all ? gaps : gaps.slice(0, 3)
  return (
    <section className="mb-6 rounded-lg border border-warning/50 bg-card">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        <MessageCircleQuestion className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Questions your agent couldn&rsquo;t answer this week</h2>
          <p className="text-xs text-muted-foreground">Answer them once as an FAQ and the agent will know next time.</p>
        </div>
      </div>
      <ul className="divide-y divide-border px-4">
        {shown.map((g) => (
          <li key={g.question} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
            <span className="min-w-0 flex-1 text-sm">&ldquo;{g.question}&rdquo;</span>
            <span className="flex items-center gap-2">
              <StatusPill tone="neutral" dot={false}>
                {g.count > 1 ? `Asked ${g.count}×` : 'Asked once'}
                {g.source === 'test' ? ' in testing' : ''}
              </StatusPill>
              <StatusPill tone={g.reason === 'handoff' ? 'warning' : 'danger'} dot={false}>
                {g.reason === 'handoff' ? 'Handed to a person' : 'Couldn’t answer'}
              </StatusPill>
              <Button size="xs" variant="outline" onClick={() => onAddFaq(g.question)}>
                <Plus />
                Add as FAQ
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {gaps.length > 3 && (
        <Button variant="link" size="sm" className="px-4 pb-2" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${gaps.length}`}
        </Button>
      )}
    </section>
  )
}
