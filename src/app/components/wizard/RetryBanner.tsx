import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'

/** Small inline "could not do X, nothing lost" message with a Try again link. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p className="flex items-center gap-1.5 text-destructive text-xs">
      <AlertTriangle className="size-3.5 shrink-0" />
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="underline">
          Try again
        </button>
      )}
    </p>
  )
}

/** Boxed banner for a failed initial load of a section's saved content. */
export function LoadFailedBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-warning bg-warning/10 px-4 py-3">
      <p className="text-warning-foreground text-sm">
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
        <RefreshCw className="size-3.5" /> Try again
      </Button>
    </div>
  )
}

/** Boxed banner for a failed save, matching LoadFailedBanner's layout in the destructive palette. */
export function SaveFailedBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive bg-destructive/10 px-4 py-3">
      <p className="text-destructive text-sm">
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
        <RefreshCw className="size-3.5" /> Try again
      </Button>
    </div>
  )
}

/** Small "Saving..." line shown while a save-on-Next section's simulated save is in flight. */
export function SavingIndicator() {
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
      <Loader2 className="size-3.5 animate-spin" /> Saving&hellip;
    </p>
  )
}

/** Small "Loading X..." line shown while a section's simulated initial fetch is in flight. */
export function LoadingIndicator({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
      <Loader2 className="size-3.5 animate-spin" /> {label}&hellip;
    </p>
  )
}
