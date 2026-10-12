import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'

export interface ResolveChoice {
  resolution: string
  askFeedback: boolean
  handBack: boolean
}

/**
 * Resolving one ticket or several: what fixed it, whether to ask for a rating, whether the AI agent
 * takes the chat back. `windowOpen`: known for one chat; undefined for several (the server asks only
 * customers who wrote in the last 24 hours).
 */
export function ResolveDialog({ title, description, windowOpen, onResolve, onClose }: { title: string; description?: string; windowOpen?: boolean; onResolve: (c: ResolveChoice) => Promise<void>; onClose: () => void }) {
  const [resolution, setResolution] = useState('')
  const [askFeedback, setAskFeedback] = useState(windowOpen !== false)
  const [handBack, setHandBack] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resolution">What fixed it (optional)</Label>
            <Textarea id="resolution" rows={3} maxLength={2000} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Refunded the duplicate charge." />
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={askFeedback} onCheckedChange={(v) => setAskFeedback(v === true)} disabled={windowOpen === false} className="mt-0.5" />
            <span>
              Ask the customer how we did
              <span className="block text-muted-foreground text-xs">
                {windowOpen === false
                  ? 'Not possible: the 24-hour reply window is closed.'
                  : windowOpen
                    ? 'Sends Good / Okay / Bad buttons on WhatsApp.'
                    : 'Sends Good / Okay / Bad buttons to customers who wrote in the last 24 hours.'}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={handBack} onCheckedChange={(v) => setHandBack(v === true)} className="mt-0.5" />
            <span>
              Hand the chat back to the AI agent
              <span className="block text-muted-foreground text-xs">
                The agent answers the customer&rsquo;s next message. Leave it off to keep the chat with your team.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onResolve({ resolution, askFeedback: askFeedback && windowOpen !== false, handBack })
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
