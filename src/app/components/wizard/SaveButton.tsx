import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/app/components/ui/button'
import { useAuth } from '@/app/auth/AuthContext'
import { can, type Action } from '@/app/lib/permissions'

/** The explicit Save affordance every form-style step/tab gets: disabled with nothing to save,
 *  active the moment something changes, disabled again once it lands. `onSave` is whatever the
 *  section's own save-on-next lifecycle already does (see useSaveOnNextSection) — this component
 *  only adds the button chrome and the success toast, so failure still surfaces through that
 *  section's existing SaveFailedBanner rather than a second, competing error path. */
export function SaveButton({
  dirty,
  saving,
  onSave,
  onDiscard,
  can: need = 'agent.edit',
  label = 'Save',
}: {
  dirty: boolean
  saving: boolean
  onSave: () => Promise<boolean>
  /** Puts back the last saved values; offered in the floating bar when given. */
  onDiscard?: () => void
  /** Who may save (hidden for everyone else); null = anyone (their own settings). The studio's default; Settings passes its own. */
  can?: Action | null
  label?: string
}) {
  const { me } = useAuth()
  async function handleClick() {
    const ok = await onSave()
    if (ok) toast.success('Saved')
  }

  // Only roles allowed to save see it (the studio and Settings say so in their read-only banners).
  if (need && !can(me?.role, need)) return null
  return (
    <>
      <Button size="sm" onClick={handleClick} disabled={!dirty || saving}>
        {saving && <Loader2 className="size-3.5 animate-spin" />}
        {label}
      </Button>
      {/* While there's something to save, a bar at the bottom of the screen says so, wherever the
          person has scrolled to. */}
      {(dirty || saving) &&
        createPortal(
          <div className="fixed bottom-5 left-1/2 z-40 flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-lg border border-border bg-popover px-4 py-2.5 shadow-float animate-in fade-in-0 slide-in-from-bottom-2">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
              {saving ? 'Saving…' : 'You have unsaved changes'}
            </span>
            <span className="flex items-center gap-2">
              {onDiscard && (
                <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
                  Discard
                </Button>
              )}
              <Button size="sm" onClick={handleClick} disabled={saving}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Save changes
              </Button>
            </span>
          </div>,
          document.body,
        )}
    </>
  )
}
