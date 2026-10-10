import type { ReactNode } from 'react'
import { cn } from '@/app/lib/utils'

/** One titled settings section: heading and explanation on the left, the form on the right.
 *  `wide` gives the form the rest of the row (tables, schedules); otherwise it stays form-width.
 *  `stacked` puts the heading above and gives the content the full width (grids, wide tables). */
export function SettingsSection({ title, description, wide, stacked, children }: { title: string; description?: string; wide?: boolean; stacked?: boolean; children: ReactNode }) {
  return (
    <section
      className={cn(
        'grid gap-4 border-b border-border py-8 first:pt-2 last:border-0 md:gap-10',
        stacked ? 'md:gap-4' : wide ? 'md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]' : 'md:grid-cols-[minmax(0,16rem)_minmax(0,28rem)]',
      )}
    >
      <div className={cn('space-y-1', stacked && 'max-w-2xl')}>
        <h2 className="text-section font-semibold">{title}</h2>
        {description && (
          <p className="text-muted-foreground text-sm">
            {description}
          </p>
        )}
      </div>
      <div className={cn((wide || stacked) && 'min-w-0 space-y-4')}>{children}</div>
    </section>
  )
}
