import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftRight, BookOpen, FileText, FlaskConical, Monitor, Moon, Plus, Rows3, Rows4, Settings, Sun } from 'lucide-react'
import { setDensity } from '@/app/lib/density'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/app/components/ui/command'
import { OPEN_COMMAND_PALETTE } from '@/app/lib/commandPalette'
import { navFor, pathFor } from '@/app/nav'
import { useAuth } from '@/app/auth/AuthContext'
import { useWizard } from '@/app/wizard/WizardContext'
import { STUDIO_NAV_SECTIONS } from '@/app/wizard/studioNav'
import { studioPath } from '@/app/wizard/studioPaths'
import { setTheme } from '@/app/lib/theme'
import { switchWorkspace } from '@/app/auth/workspaceSwitch'
import { can } from '@/app/lib/permissions'
import { REPORTS } from '@/app/reports/catalog'
import { visibleAreas } from './settings/areas'
import { confirmLeave } from './settings/leaveGuard'

/** ⌘K / Ctrl+K anywhere: jump to any page, setting or agent section, or run a quick action. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { me } = useAuth()
  const { state } = useWizard()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen)
    }
  }, [])

  if (!me?.workspace) return null
  const go = (path: string) => {
    setOpen(false)
    void confirmLeave().then((ok) => ok && navigate(path))
  }
  const agentName = state.gate.gatePassed ? state.identity.agentName.trim() || 'Your agent' : null

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search Helo.ai" description="Jump to a page, setting or agent section">
      <CommandInput placeholder="Search pages, settings and actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Actions">
          {can(me.role, 'agent.edit') && (
            <CommandItem onSelect={() => go('/agents?new')}>
              <Plus />
              Create an AI agent
            </CommandItem>
          )}
          {can(me.role, 'settings.manage') && (
            <CommandItem
              value="api docs documentation swagger"
              onSelect={() => {
                setOpen(false)
                window.open('/api/docs', '_blank', 'noopener')
              }}
            >
              <BookOpen />
              API docs
            </CommandItem>
          )}
          {agentName && (
            <CommandItem onSelect={() => go(studioPath('testEval'))}>
              <FlaskConical />
              Test {agentName}
            </CommandItem>
          )}
        </CommandGroup>
        <CommandGroup heading="Go to">
          {navFor(me.role).map((item) => (
            <CommandItem key={item.id} onSelect={() => go(pathFor(item.id))}>
              <item.icon />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {agentName && (
          <CommandGroup heading={agentName}>
            {STUDIO_NAV_SECTIONS.map((s) => (
              <CommandItem key={s.id} value={`${agentName} ${s.label}`} onSelect={() => go(studioPath(s.id))}>
                <s.icon />
                {s.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {can(me.role, 'reports.view') && (
          <CommandGroup heading="Reports">
            {REPORTS.map((r) => (
              <CommandItem key={r.id} value={`report ${r.title}`} onSelect={() => go(`/reports/${r.id}`)}>
                <FileText />
                {r.title} report
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {/* The same catalog as the Settings home and its tabs (settings/areas.ts). */}
        <CommandGroup heading="Settings">
          <CommandItem value="settings home all settings" onSelect={() => go(pathFor('settings'))}>
            <Settings />
            All settings
          </CommandItem>
          {visibleAreas(me.role).flatMap((a) =>
            a.tabs.map((t) => (
              <CommandItem key={t.slug} value={`settings ${a.label} ${t.label} ${t.keywords ?? ''}`} onSelect={() => go(pathFor('settings', t.slug))}>
                <Settings />
                {t.label}
                <span className="ml-auto text-meta text-muted-foreground">{a.label}</span>
              </CommandItem>
            )),
          )}
          {can(me.role, 'whatsapp.manage') && (
            <CommandItem value="whatsapp account webhooks live events disconnect assets" onSelect={() => go('/whatsapp?tab=account')}>
              <Settings />
              WhatsApp account
              <span className="ml-auto text-meta text-muted-foreground">Assets</span>
            </CommandItem>
          )}
        </CommandGroup>
        {me.workspaces.length > 1 && (
          <CommandGroup heading="Workspaces">
            {me.workspaces
              .filter((w) => w.id !== me.workspace?.id)
              .map((w) => (
                <CommandItem
                  key={w.id}
                  value={`switch workspace ${w.name}`}
                  onSelect={() => {
                    setOpen(false)
                    void switchWorkspace(w.id)
                  }}
                >
                  <ArrowLeftRight />
                  Switch to {w.name}
                </CommandItem>
              ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Lists">
          {(['comfortable', 'compact'] as const).map((d) => (
            <CommandItem
              key={d}
              value={`density ${d} lists`}
              onSelect={() => {
                setDensity(d)
                setOpen(false)
              }}
            >
              {d === 'compact' ? <Rows4 /> : <Rows3 />}
              {d === 'compact' ? 'Compact lists' : 'Comfortable lists'}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Theme">
          {(
            [
              ['light', 'Light theme', Sun],
              ['dark', 'Dark theme', Moon],
              ['system', 'Match system theme', Monitor],
            ] as const
          ).map(([id, label, Icon]) => (
            <CommandItem
              key={id}
              onSelect={() => {
                setTheme(id)
                setOpen(false)
              }}
            >
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

