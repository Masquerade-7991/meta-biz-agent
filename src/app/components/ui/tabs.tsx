"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/app/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

// Two looks. "line" (default): sub-section navigation, an underlined row with no box, so it
// sits quietly inside a card or page. "segmented": a small pill switch for picking a value
// (like a date range), not for moving between sections.
type Variant = "line" | "segmented"
const VariantContext = React.createContext<Variant>("line")

function TabsList({
  className,
  variant = "line",
  actions,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: Variant
  /** Right-aligned controls in the tab row, e.g. a section's Save button (line variant only). */
  actions?: React.ReactNode
}) {
  const list = (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        variant === "segmented"
          ? "inline-flex w-fit items-center rounded-md bg-muted p-0.5 text-muted-foreground"
          : "-mb-px flex min-w-0 flex-1 items-end gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
  return (
    <VariantContext.Provider value={variant}>
      {variant === "segmented" ? (
        list
      ) : (
        <div data-slot="tabs-bar" className="flex items-end gap-3 border-b border-border">
          {list}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2 pb-2">{actions}</div>}
        </div>
      )}
    </VariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(VariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground outline-none transition-colors",
        "hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === "segmented"
          ? "rounded px-2.5 py-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          : "rounded-t-sm border-b-2 border-transparent px-0.5 pt-1 pb-2.5 data-[state=active]:border-primary data-[state=active]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

// No border/background of its own — every real usage in this app already sits inside a
// page-level bordered card (the studio shell's, or a caller's own), so a second box here would
// stack borders around the same content, the exact seam this component was corrected to avoid.
function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("pt-6 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
