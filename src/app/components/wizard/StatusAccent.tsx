import type { ReactNode } from 'react'
import { cn } from '@/app/lib/utils'

/** Replaces an always-visible "Provided / Not provided yet" status line: the field's left edge
 *  carries a thin accent bar instead, grey when empty, green when filled. The original wording
 *  survives as a visually-hidden label for screen readers, never deleted, only not shown. */
export function StatusAccent({
  filled,
  srLabel,
  children,
}: {
  filled: boolean
  srLabel?: string
  children: ReactNode
}) {
  return (
    <div className={cn('border-l-2 pl-3 transition-colors', filled ? 'border-l-success' : 'border-l-border')}>
      {children}
      <span className="sr-only">{srLabel ?? (filled ? 'Provided' : 'Not provided yet')}</span>
    </div>
  )
}
