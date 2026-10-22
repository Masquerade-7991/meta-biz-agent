import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { setLeaveAsker } from './leaveGuard'

// Small pieces App.tsx mounts outside the lazily loaded pages, so they work even before (or
// without) a page's code arriving.

/** An address that isn't (or is no longer) a page this role opens: go where it belongs, saying why. */
export function RedirectWithMessage({ to, message }: { to: string; message?: string }) {
  useEffect(() => {
    if (!message) return
    // On a fresh load the toaster mounts after this: say it on the next tick so it's heard.
    const t = setTimeout(() => toast.error(message))
    return () => clearTimeout(t)
  }, [message])
  return <Navigate to={to} replace />
}

/** The "Discard your changes?" question every guarded way of leaving asks (leaveGuard.ts). */
export function LeaveGuardHost() {
  const [answer, setAnswer] = useState<((leave: boolean) => void) | null>(null)
  useEffect(() => {
    setLeaveAsker((fn) => setAnswer(() => fn))
    return () => setLeaveAsker(null)
  }, [])
  const close = (leave: boolean) => {
    answer?.(leave)
    setAnswer(null)
  }
  return (
    <ConfirmDialog
      open={!!answer}
      title="Discard your changes?"
      description="You have changes on this page that aren’t saved. Leave and they’re lost."
      confirmLabel="Discard changes"
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  )
}
