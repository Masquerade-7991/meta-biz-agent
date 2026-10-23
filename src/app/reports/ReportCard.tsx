import { Link } from 'react-router'
import { ArrowRightLeft, Bot, BriefcaseBusiness, Cpu, MessageSquareText, MessagesSquare, Receipt, Siren, Smile, Star, Ticket, Timer, Users, Wallet, type LucideIcon } from 'lucide-react'
import { reportOf, type ReportId } from './catalog'

const REPORT_ICON: Record<ReportId, LucideIcon> = {
  business_review: BriefcaseBusiness,
  ai_agent: Bot,
  conversations: MessagesSquare,
  team: Users,
  response_sla: Timer,
  csat: Smile,
  spend: Wallet,
  conversations_log: MessageSquareText,
  tickets: Ticket,
  handovers: ArrowRightLeft,
  escalations: Siren,
  csat_responses: Star,
  charges: Receipt,
  agent_usage: Cpu,
}

/** A report in the library: its icon, title and one line; the whole card opens it. */
export function ReportCard({ id, to }: { id: ReportId; to: string }) {
  const r = reportOf(id)
  const Icon = REPORT_ICON[id]
  return (
    <Link to={to} className="group flex h-full gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-border-strong" data-density-row>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{r.title}</span>
        <span className="block text-sm text-muted-foreground">{r.description}</span>
      </span>
    </Link>
  )
}
