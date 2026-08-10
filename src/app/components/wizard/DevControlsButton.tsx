import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { useDevControlsEntries } from '@/app/wizard/DevControlsContext'

/** The single, app-wide demo-controls panel. Rendered once at the app root, fixed to the true
 *  bottom-left of the viewport — not the wizard's own footer, which spans full width and already
 *  carries the Back button at its own bottom-left inset, so this sits above that bar rather than
 *  beside it to guarantee no overlap. Always visible, collapsed by default; its contents swap
 *  silently to match whichever screen is currently registering controls. Hidden below a reasonable
 *  desktop width, since this is prototype-only tooling that never needs to work on a narrow screen.
 *  z-[60] outranks the Dialog overlay/content's z-50, and pointer-events-auto overrides the
 *  `body.style.pointerEvents = 'none'` that Radix's DismissableLayer applies while a Dialog with
 *  disableOutsidePointerEvents (e.g. Create Agent) is open — without it, this panel would inherit
 *  that `none` from body and become unclickable any time a modal is open.
 *
 *  Open state is a plain controlled boolean, not left to Radix's own outside-click dismissal: the
 *  panel must stay expanded across stepper navigation (an explicit requirement), and by default
 *  Radix's Popover treats any click elsewhere on the page — including the stepper itself — as a
 *  dismiss. onInteractOutside/onFocusOutside are suppressed so only the trigger (or Escape) closes
 *  it. */
export function DevControlsButton() {
  const entries = useDevControlsEntries()
  const rendered = entries.map(({ id, getNode }) => ({ id, node: getNode() })).filter((e) => e.node)
  const [open, setOpen] = useState(false)

  return (
    <div data-demo-panel className="pointer-events-auto fixed bottom-20 left-4 z-[60] hidden lg:block">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="Demo controls"
            className="rounded-full border-warning bg-warning/10 text-warning-foreground hover:bg-warning/20"
          >
            <FlaskConical className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          data-demo-panel
          align="start"
          side="top"
          onInteractOutside={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          className="pointer-events-auto z-[60] w-96 space-y-4 border-dashed border-warning bg-warning/5"
        >
          {rendered.length === 0 ? (
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              No demo controls for this step
            </p>
          ) : (
            rendered.map(({ id, node }) => <div key={id}>{node}</div>)
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
