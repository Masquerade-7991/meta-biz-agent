import * as React from "react"

import { cn } from "@/app/lib/utils"
import { Badge } from "@/app/components/ui/badge"
import type { Tone } from "@/app/lib/status"

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
}

/** One look for every status in the console (agent, number, knowledge, connection, ticket…). The
 *  words come from src/app/lib/status.ts so the same state reads the same everywhere. */
export function StatusPill({
  tone,
  dot = true,
  pulse = false,
  className,
  children,
}: {
  tone: Tone
  dot?: boolean
  /** A gentle pulse on the dot for work in progress (reading, saving). */
  pulse?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <Badge variant={tone} className={cn("gap-1.5 px-2 font-medium", className)}>
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone], pulse && "animate-pulse")} />}
      {children}
    </Badge>
  )
}
