import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Lock, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { LoadFailedBanner } from '@/app/components/wizard/RetryBanner'
import { SaveButton } from '@/app/components/wizard/SaveButton'
import { FormError } from '@/app/auth/AuthLayout'
import type { Action } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { pathFor } from '@/app/nav'
import { lastChanged, type Stamp } from './formCore'
import { confirmLeave } from './leaveGuard'
import type { SettingsTab } from './areas'

/** Says who can change a tab someone may only read. */
export function ReadOnlyNote({ children = 'Only owners and admins can change these settings.' }: { children?: ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
      <Lock className="size-3.5 shrink-0" />
      {children}
    </p>
  )
}

/** The page loader while a tab loads, then a Try again banner if it couldn't. */
export function LoadGate({ error, onRetry, what = 'these settings' }: { error: string | null; onRetry: () => void; what?: string }) {
  if (error) return <LoadFailedBanner message={`Couldn’t load ${what}. ${error}`} onRetry={onRetry} />
  return <PageLoader context="settings" className="min-h-[30vh] py-10" />
}

/** Someone else saved first (409): see theirs, or save over them. */
export function ConflictBanner({ onReload, onKeepMine }: { onReload: () => void; onKeepMine: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-warning/10 px-4 py-3">
      <p className="text-sm text-warning-foreground">Someone else changed this just now. Reload to see their changes, or keep yours and save over them.</p>
      <span className="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onClick={onReload}>
          <RefreshCw className="size-3.5" /> Reload
        </Button>
        <Button variant="ghost" size="sm" onClick={onKeepMine}>
          Keep mine
        </Button>
      </span>
    </div>
  )
}

/** "Last changed by Riya, 2 hours ago". */
export function LastChanged({ stamp, className }: { stamp: Stamp; className?: string }) {
  const text = lastChanged(stamp)
  return text ? <p className={cn('text-meta text-muted-foreground', className)}>{text}</p> : null
}

/** The bottom of a Settings form: Save (and the floating unsaved-changes bar with Discard), what
 *  went wrong, a 409's choices, and who saved it last. */
export function FormFooter({
  form,
  can = 'settings.manage',
  label = 'Save changes',
  onSave,
}: {
  form: { dirty: boolean; saving: boolean; saveError: string | null; conflict: boolean; stamp: Stamp; save: () => Promise<boolean>; keepMine: () => Promise<boolean>; reload: () => void; discard: () => void; invalid: boolean }
  /** null = anyone (their own settings). */
  can?: Action | null
  label?: string
  /** Replaces form.save (e.g. to ask something first). */
  onSave?: () => Promise<boolean>
}) {
  return (
    <div className="space-y-3 py-4">
      {form.conflict && <ConflictBanner onReload={form.reload} onKeepMine={() => void form.keepMine()} />}
      {form.saveError && <FormError>{form.saveError}</FormError>}
      {form.invalid && form.dirty && <p className="text-sm text-destructive">Fix the highlighted fields to save.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton can={can} label={label} dirty={form.dirty} saving={form.saving} onSave={onSave ?? form.save} onDiscard={form.discard} />
        <LastChanged stamp={form.stamp} />
      </div>
    </div>
  )
}

/** A link to another Settings tab that asks before leaving unsaved changes. */
export function SettingsLink({ tab, children, className }: { tab: SettingsTab; children: ReactNode; className?: string }) {
  const navigate = useNavigate()
  const href = pathFor('settings', tab)
  return (
    <a
      href={href}
      className={cn('font-medium text-primary underline-offset-4 hover:underline', className)}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        void confirmLeave().then((ok) => ok && navigate(href))
      }}
    >
      {children}
    </a>
  )
}
