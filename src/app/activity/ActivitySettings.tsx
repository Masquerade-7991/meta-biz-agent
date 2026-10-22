import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { SearchInput } from '@/app/components/Filters'
import { SettingsSection } from '@/app/components/shell/SettingsSection'
import { useMembers } from '@/app/auth/useMembers'
import { activityCsvUrl, type ActivityQuery } from '@/app/api/activity'
import { AREAS, type Area } from './activityText'
import { ActivityList } from './ActivityList'

const ANY = 'any'

/** Settings › Activity (owners and admins): everything people and the system did, filterable. */
export function ActivitySettings() {
  const members = useMembers()
  const [userId, setUserId] = useState(ANY)
  const [area, setArea] = useState<Area | typeof ANY>(ANY)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [ref, setRef] = useState('')
  // A reference is 8+ hex characters; until it is one, the other filters apply as usual.
  const refOk = /^[0-9a-f-]{8,36}$/i.test(ref.trim())
  const query: ActivityQuery = {
    userId: userId === ANY ? undefined : userId,
    area: area === ANY ? undefined : area,
    from: from || undefined,
    to: to || undefined,
    ref: refOk ? ref.trim().toLowerCase() : undefined,
  }
  const filtered = userId !== ANY || area !== ANY || !!from || !!to || !!ref
  const csv = activityCsvUrl(query)
  const dateError = from && to && from > to ? 'The start date is after the end date.' : null

  return (
    <SettingsSection
      stacked
      title="Activity"
      description="Who did what in this workspace, and what the system did on its own: ticket changes, AI agent edits, members, settings and more. Dates are in the workspace’s time zone (Hours & targets). Kept for two years."
    >
      <div className="flex flex-wrap items-end gap-2">
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="h-9 w-44" aria-label="Person">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Everyone</SelectItem>
            <SelectItem value="system">The system</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name || m.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={area} onValueChange={(v) => setArea(v as Area | typeof ANY)}>
          <SelectTrigger className="h-9 w-48" aria-label="Area">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All areas</SelectItem>
            {(Object.keys(AREAS) as Area[]).map((a) => (
              <SelectItem key={a} value={a}>
                {AREAS[a].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
        </label>
        <SearchInput value={ref} onChange={setRef} placeholder="Error reference" label="Find an error reference" className="h-9 w-44" />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setUserId(ANY)
              setArea(ANY)
              setFrom('')
              setTo('')
              setRef('')
            }}
          >
            Clear filters
          </Button>
        )}
        {csv && !dateError && (
          <Button variant="outline" size="sm" className="ml-auto" asChild title="Up to 10,000 rows. If there are more, the file says so on its last line: narrow the dates.">
            <a href={csv} download>
              <Download className="size-4" />
              Download CSV
            </a>
          </Button>
        )}
      </div>
      {csv && !dateError && !from && !to && <p className="text-xs text-muted-foreground">A download holds up to 10,000 rows, newest first; pick dates to get older ones.</p>}
      {ref && !refOk && <p className="text-xs text-muted-foreground">A reference is the 8 letters and numbers shown after “Reference:” in an error.</p>}
      {dateError ? (
        <p className="text-sm text-destructive">{dateError}</p>
      ) : (
        <ActivityList query={query} empty={filtered ? 'Nothing matches these filters. Try a wider date range or clear the filters.' : 'Changes people make, and what the system does on its own, show up here.'} />
      )}
    </SettingsSection>
  )
}
