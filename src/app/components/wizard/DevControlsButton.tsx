import { FlaskConical } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { useDevControlsEntries } from '@/app/wizard/DevControlsContext'

/** Bottom-left corner of the footer. Opens every prototype/demo control registered by whatever
 *  step (and sub-sections of that step) is currently mounted. Renders nothing when the current
 *  step has no demo controls to show (e.g. the placeholder steps). */
export function DevControlsButton() {
  const entries = useDevControlsEntries()
  if (entries.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-warning bg-warning/10 text-warning-foreground hover:bg-warning/20"
        >
          <FlaskConical className="size-3.5" />
          Demo controls
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-96 space-y-4">
        {entries.map(({ id, getNode }) => (
          <div key={id}>{getNode()}</div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
