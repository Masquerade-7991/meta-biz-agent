import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Switch } from '@/app/components/ui/switch'
import { useDevControlsEntries } from '@/app/wizard/DevControlsContext'
import { isDummyMode, setDummyMode } from '@/app/api/dummy'
import { DemoControlsGroup } from './DemoControlsGroup'

/** The single, app-wide demo-controls panel. Rendered once at the app root, fixed to the true
 *  bottom-right of the viewport (toasts sit above it, see components/ui/sonner.tsx, so the two
 *  floating layers never overlap). Always visible, collapsed by default; its contents swap
 *  silently to match whichever screen is currently registering controls. Hidden below a reasonable
 *  desktop width, since this is prototype-only tooling that never needs to work on a narrow screen.
 *  Trigger and panel use the app's own Button/Popover primitives with no colour overrides, so this
 *  reads as part of the product rather than as a debug overlay bolted on top of it.
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
    <div data-demo-panel className="pointer-events-auto fixed right-4 bottom-4 z-60 hidden lg:block print:hidden">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Demo controls" className="relative rounded-full shadow-md">
            <FlaskConical className="size-4" />
            {/* A quiet cue for the presenter only; nothing on the page itself says "dummy". */}
            {isDummyMode() && <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-warning" aria-hidden />}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          data-demo-panel
          align="end"
          side="top"
          onInteractOutside={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          className="pointer-events-auto z-60 w-96 space-y-4"
        >
          <DemoControlsGroup label="Dummy mode">
            <label className="flex w-full items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Uses sample data in this browser. No calls to Meta. The page reloads.</span>
              <Switch checked={isDummyMode()} onCheckedChange={setDummyMode} aria-label="Dummy mode" />
            </label>
          </DemoControlsGroup>
          {rendered.length === 0 ? (
            <p className="text-muted-foreground text-xs">
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
