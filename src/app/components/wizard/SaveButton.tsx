import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/app/components/ui/button'
import { useAuth } from '@/app/auth/AuthContext'
import { can } from '@/app/lib/permissions'

/** The explicit Save affordance every form-style step/tab gets: disabled with nothing to save,
 *  active the moment something changes, disabled again once it lands. `onSave` is whatever the
 *  section's own save-on-next lifecycle already does (see useSaveOnNextSection) — this component
 *  only adds the button chrome and the success toast, so failure still surfaces through that
 *  section's existing SaveFailedBanner rather than a second, competing error path. */
export function SaveButton({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean
  saving: boolean
  onSave: () => Promise<boolean>
}) {
  const { me } = useAuth()
  async function handleClick() {
    const ok = await onSave()
    if (ok) toast.success('Saved')
  }

  // Only owners and admins change the agent; the studio says so in its view-only banner.
  if (!can(me?.role, 'agent.edit')) return null
  return (
    <Button size="sm" onClick={handleClick} disabled={!dirty || saving}>
      {saving && <Loader2 className="size-3.5 animate-spin" />}
      Save
    </Button>
  )
}
