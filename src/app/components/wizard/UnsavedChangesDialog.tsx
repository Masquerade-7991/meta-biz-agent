import { Button } from '@/app/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/app/components/ui/dialog'

/** The one "leaving with unsaved changes" prompt, shared by every save-on-Next section. */
export function UnsavedChangesDialog({ open, onResolve }: { open: boolean; onResolve: (leave: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onResolve(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You have unsaved changes on this page.</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onResolve(false)}>
            Stay on this page
          </Button>
          <Button variant="destructive" onClick={() => onResolve(true)}>
            Leave without saving
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
