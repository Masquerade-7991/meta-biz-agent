import { Bot, CalendarRange, Check, ChevronDown, Users, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { cn } from '@/app/lib/utils'
import { PRESETS } from './useAnalyticsFilter'
import type { AnalyticsFilter } from './types'

/**
 * The filters every analytics view shares: period, agents (one, several or all), team and person.
 * Team and person narrow the ticket figures; agents narrow everything.
 */
export function FilterBar({
  filter,
  range,
  agents,
  teams,
  people,
  onChange,
  className,
}: {
  filter: AnalyticsFilter
  range: string
  agents: { id: string; label: string }[]
  teams: { id: string; name: string }[]
  people: { userId: string; name: string }[]
  onChange: (patch: Record<string, string | null>) => void
  className?: string
}) {
  const chosen = agents.filter((a) => filter.numbers.includes(a.id))
  const agentLabel = !chosen.length ? 'All agents' : chosen.length === 1 ? chosen[0].label : `${chosen.length} agents`
  const toggleAgent = (id: string) => {
    const next = filter.numbers.includes(id) ? filter.numbers.filter((x) => x !== id) : [...filter.numbers, id]
    onChange({ agents: next.length === agents.length ? null : next.join(',') })
  }
  const rangeLabel = range === 'custom' ? `${fmt(filter.from)} – ${fmt(filter.to)}` : (PRESETS.find((p) => p.id === range)?.label ?? 'Last 30 days')
  const narrowed = filter.numbers.length || filter.team || filter.person || range !== '30'

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="group" aria-label="Filters">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <CalendarRange className="size-4" /> {rangeLabel} <ChevronDown className="size-3.5 opacity-60" />
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <Bot className="size-4" /> {agentLabel} <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">Agents (one per WhatsApp number)</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onChange({ agents: null })}>
            <Check className={cn('size-4', filter.numbers.length && 'invisible')} /> All agents together
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {agents.map((a) => (
            <DropdownMenuCheckboxItem key={a.id} checked={filter.numbers.includes(a.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleAgent(a.id)}>
              {a.label}
            </DropdownMenuCheckboxItem>
          ))}
          {!agents.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">No WhatsApp numbers connected yet.</p>}
        </DropdownMenuContent>
      </DropdownMenu>

      {teams.length > 0 && (
        <Select value={filter.team ?? 'all'} onValueChange={(v) => onChange({ team: v === 'all' ? null : v })}>
          <SelectTrigger className="h-9 w-40" aria-label="Team">
            <Users className="size-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={filter.person ?? 'all'} onValueChange={(v) => onChange({ person: v === 'all' ? null : v })}>
        <SelectTrigger className="h-9 w-40" aria-label="Person">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Everyone</SelectItem>
          {people.map((p) => (
            <SelectItem key={p.userId} value={p.userId}>
              {p.name}
            </SelectItem>
          ))}
          <SelectItem value="none">Unassigned</SelectItem>
        </SelectContent>
      </Select>
      {narrowed ? (
        <Button variant="ghost" size="sm" className="h-9" onClick={() => onChange({ range: null, from: null, to: null, agents: null, team: null, person: null })}>
          <X className="size-4" /> Reset
        </Button>
      ) : null}
    </div>
  )
}

const fmt = (d: string) => new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })
