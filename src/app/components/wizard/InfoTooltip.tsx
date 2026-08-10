import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip'

/** The one small (i) affordance used everywhere a field, card, or section used to carry a
 *  permanently-visible helper line. Text is shown verbatim, unchanged from wherever it used to
 *  live inline — this component only changes when it's visible, never what it says. */
export function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.preventDefault()}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
          aria-label="More information"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64" side="top">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
