import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/app/lib/utils"
import { Button } from "@/app/components/ui/button"

// Page scaffolding shared by every console page and studio section, so titles, widths and empty
// states look and behave the same everywhere.

/** Two widths only: `wide` for lists and tables, `form` for settings and forms. */
export function PageContainer({ width = "wide", className, ...props }: React.ComponentProps<"div"> & { width?: "wide" | "form" }) {
  return <div className={cn("mx-auto w-full px-4 py-6 sm:px-8 sm:py-8", width === "wide" ? "max-w-7xl" : "max-w-4xl", className)} {...props} />
}

/** The page's one title (24px), a single line of description, and its actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** Primary action last; secondary actions before it or in a "…" menu. */
  actions?: React.ReactNode
  /** Small status beside the title, e.g. a StatusPill. */
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-title font-semibold">{title}</h1>
          {meta}
        </div>
        {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** A section heading inside a page: title, optional one-line description and actions. */
export function SectionHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-section font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Says why something is empty and offers the one thing to do about it. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong px-6 py-12 text-center", className)}>
      {Icon && (
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
      )}
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-md text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Sticky bar at the bottom of a form while it has unsaved changes. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel = "Save changes",
  disabled,
}: {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onDiscard?: () => void
  saveLabel?: string
  disabled?: boolean
}) {
  if (!dirty && !saving) return null
  return (
    <div className="sticky bottom-4 z-20 mt-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-popover px-4 py-2.5 shadow-float">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        {saving ? "Saving…" : "You have unsaved changes"}
      </span>
      <div className="flex items-center gap-2">
        {onDiscard && (
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={saving || disabled}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  )
}
