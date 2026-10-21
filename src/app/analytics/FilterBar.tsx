import { Bot, CalendarRange, Check, ChevronDown, UserRound, Users, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { cn } from '@/app/lib/utils'
import { PRESETS } from './useAnalyticsFilter'
import type { AnalyticsFilter } from './types'
import type { ReportFilter } from '@/app/reports/catalog'

const EVERY: readonly ReportFilter[] = ['agents', 'team', 'person']

/**
 * The filters every analytics view and report shares: period, agents (one, several or all), team and
 * assignee. Each control says what it is ("Team: All"), the exact dates show underneath, and a report
 * that ignores team or assignee hides them and says why (`applies`, `note`).
 */
export function FilterBar({
  filter,
  range,
  agents,
  teams,
  people,
  onChange,
  applies = EVERY,
  note,
  timezone,
  className,
}: {
  filter: AnalyticsFilter
  range: string
  agents: { id: string; label: string }[]
  teams: { id: string; name: string }[]
  people: { userId: string; name: string }[]
  onChange: (patch: Record<string, string | null>) => void
  /** The filters this view uses besides the date; the others are hidden. */
  applies?: readonly ReportFilter[]
  /** Why some filters are hidden. */
  note?: string
  /** The workspace's time zone, named under the dates. */
  timezone?: string
  className?: string
}) {
  const rangeLabel = range === 'custom' ? `${fmt(filter.from)} – ${fmt(filter.to)}` : (PRESETS.find((p) => p.id === range)?.label ?? 'Last 30 days')
  const narrowed = filter.numbers.length || filter.team || filter.person || range !== '30'
  const span = `${fmtLong(filter.from)}${filter.from === filter.to ? '' : ` – ${fmtLong(filter.to)}`}`

  return (
    <div className={cn('space-y-1.5', className)}>
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <CalendarRange className="size-4" /> <span className="text-muted-foreground">Date:</span> {rangeLabel} <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant={range === p.id ? 'default' : 'outline'} onClick={() => onChange({ range: p.id, from: null, to: null })}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-meta text-muted-foreground">Custom range</p>
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From" className="h-8" value={filter.from} max={filter.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: filter.to, range: null })} />
              <span className="text-muted-foreground">–</span>
              <Input type="date" aria-label="To" className="h-8" value={filter.to} min={filter.from} onChange={(e) => e.target.value && onChange({ from: filter.from, to: e.target.value, range: null })} />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {applies.includes('agents') && <AgentsFilter agents={agents} value={filter.numbers} onChange={(next) => onChange({ agents: next.length ? next.join(',') : null })} />}
      {applies.includes('team') && <TeamFilter teams={teams} value={filter.team} onChange={(team) => onChange({ team })} />}
      {applies.includes('person') && (
      <Select value={filter.person ?? 'all'} onValueChange={(v) => onChange({ person: v === 'all' ? null : v })}>
        <SelectTrigger className="h-9 w-auto min-w-44" aria-label="Assigned to">
          <UserRound className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">Assigned to:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Anyone</SelectItem>
          {people.map((p) => (
            <SelectItem key={p.userId} value={p.userId}>
              {p.name}
            </SelectItem>
          ))}
          <SelectItem value="none">Unassigned</SelectItem>
        </SelectContent>
      </Select>
      )}
      {narrowed ? (
        <Button variant="ghost" size="sm" className="h-9" onClick={() => onChange({ range: null, from: null, to: null, agents: null, team: null, person: null })}>
          <X className="size-4" /> Clear filters
        </Button>
      ) : null}
    </div>
    <p className="text-meta text-muted-foreground">
      {span}
      {timezone && ` · ${timezone} time`}
      {note && ` · ${note}`}
    </p>
    </div>
  )
}

const fmt = (d: string) => new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })
const fmtLong = (d: string) => new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })

/** Agents: all of them together, or any set (an empty `value` means all). */
export function AgentsFilter({ agents, value, onChange }: { agents: { id: string; label: string }[]; value: string[]; onChange: (next: string[]) => void }) {
  const chosen = agents.filter((a) => value.includes(a.id))
  const label = !chosen.length ? 'All' : chosen.length === 1 ? chosen[0].label : `${chosen.length} agents`
  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id]
    onChange(next.length === agents.length ? [] : next)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Bot className="size-4" /> <span className="text-muted-foreground">Agents:</span> {label} <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">Agents (one per WhatsApp number)</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange([])}>
          <Check className={cn('size-4', value.length && 'invisible')} /> All agents together
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {agents.map((a) => (
          <DropdownMenuCheckboxItem key={a.id} checked={value.includes(a.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggle(a.id)}>
            {a.label}
          </DropdownMenuCheckboxItem>
        ))}
        {!agents.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">No WhatsApp numbers connected yet.</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Team: all, or one. Hidden while the workspace has no teams. */
export function TeamFilter({ teams, value, onChange }: { teams: { id: string; name: string }[]; value: string | null; onChange: (team: string | null) => void }) {
  if (!teams.length) return null
  return (
    <Select value={value ?? 'all'} onValueChange={(v) => onChange(v === 'all' ? null : v)}>
      <SelectTrigger className="h-9 w-auto min-w-36" aria-label="Team">
        <Users className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">Team:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        {teams.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
