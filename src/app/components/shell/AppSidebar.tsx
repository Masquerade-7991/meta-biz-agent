import { useState } from 'react'
import { Check, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Rows3, Rows4, Settings, Sun, UserPlus } from 'lucide-react'
import { getDensity, setDensity, type Density } from '@/app/lib/density'
import { Avatar, AvatarFallback, AvatarImage } from '@/app/components/ui/avatar'
import avatar from '@/assets/helo-avatar.svg'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip'
import mark from '@/assets/helo-mark.svg'
import { NAV_GROUPS, navFor, type NavId } from '@/app/nav'
import { cn, initialsOf } from '@/app/lib/utils'
import { useAuth } from '@/app/auth/AuthContext'
import type { SettingsTab } from './SettingsPage'
import { can, roleLabel } from '@/app/lib/permissions'
import { getTheme, setTheme, type ThemeChoice } from '@/app/lib/theme'

const initials = (name: string) => initialsOf(name) || '?'
const COLLAPSE_KEY = 'helo-nav-collapsed'
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/** The console's navigation: labelled pages in three groups. Collapses to an icon rail on wide
 *  screens (remembered per viewer); on phones it is the content of the menu drawer. */
export function AppSidebar({
  active,
  onNavigate,
  onOpenSettings,
  drawer = false,
}: {
  active: NavId
  onNavigate: (id: NavId) => void
  onOpenSettings: (tab: SettingsTab) => void
  /** Rendered inside the phone drawer: always expanded, no collapse control. */
  drawer?: boolean
}) {
  const { me, logout } = useAuth()
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed)
  const collapsed = !drawer && collapsedPref
  const toggle = () => {
    const next = !collapsedPref
    setCollapsedPref(next)
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
    } catch {
      // storage blocked: remembered for this page only
    }
  }
  const items = navFor(me?.role)

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full shrink-0 flex-col bg-sidebar transition-[width] duration-150',
        drawer ? 'w-full' : cn('border-r border-sidebar-border', collapsed ? 'w-16' : 'w-56'),
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5', collapsed ? 'justify-center' : 'px-4')}>
        <img src={mark} alt="" className="size-7" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-foreground">Helo.ai</p>
            <p className="truncate text-meta text-muted-foreground">{me?.workspace?.name}</p>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((g) => {
          const groupItems = items.filter((i) => i.group === g.id)
          if (!groupItems.length) return null
          return (
            <div key={g.id}>
              {!collapsed && <p className="px-2.5 pb-1.5 text-meta font-medium text-muted-foreground">{g.label}</p>}
              <ul className="space-y-0.5">
                {groupItems.map((item) => {
                  const Icon = item.icon
                  const isActive = active === item.id
                  const button = (
                    <button
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      aria-label={collapsed ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex h-9 w-full items-center gap-3 rounded-md text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        collapsed ? 'justify-center' : 'px-2.5',
                        isActive ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                      )}
                    >
                      {/* The Helo red marks where you are. */}
                      {isActive && <span aria-hidden className="absolute top-2 bottom-2 -left-2.5 w-0.75 rounded-r-full bg-brand" />}
                      <Icon className={cn('size-4 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </button>
                  )
                  return (
                    <li key={item.id}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{button}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        button
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      <div className={cn('shrink-0 space-y-1 border-t border-sidebar-border p-2.5', collapsed && 'flex flex-col items-center')}>
        <AccountMenu collapsed={collapsed} onOpenSettings={onOpenSettings} onLogout={() => void logout()} me={me} />
        {!drawer && (
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={cn(
              'flex h-8 items-center gap-3 rounded-md text-meta text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-foreground',
              collapsed ? 'w-9 justify-center' : 'w-full px-2.5',
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && 'Collapse'}
          </button>
        )}
      </div>
    </nav>
  )
}

function AccountMenu({
  collapsed,
  me,
  onOpenSettings,
  onLogout,
}: {
  collapsed: boolean
  me: ReturnType<typeof useAuth>['me']
  onOpenSettings: (tab: SettingsTab) => void
  onLogout: () => void
}) {
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme)
  const [density, setDensityState] = useState<Density>(getDensity)
  const pickDensity = (d: Density) => {
    setDensity(d)
    setDensityState(d)
  }
  const pick = (t: ThemeChoice) => {
    setTheme(t)
    setThemeState(t)
  }
  const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'Match system', icon: Monitor },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account, theme and workspace"
          className={cn(
            'flex items-center gap-2.5 rounded-md text-left transition-colors outline-none hover:bg-sidebar-accent/70 focus-visible:ring-[3px] focus-visible:ring-ring/50',
            collapsed ? 'size-9 justify-center' : 'w-full px-1.5 py-1.5',
          )}
        >
          <Avatar className="size-7">
            <AvatarImage src={avatar} alt="" />
            <AvatarFallback className="bg-primary text-meta text-primary-foreground">{initials(me?.user.name ?? '')}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-foreground">{me?.user.name}</span>
              <span className="block truncate text-meta text-muted-foreground">{roleLabel(me?.role)}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-64">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="truncate">{me?.user.name}</div>
          <div className="truncate text-meta font-normal text-muted-foreground">{me?.user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOpenSettings('profile')}>
          <Settings className="size-4" /> Your profile
        </DropdownMenuItem>
        {can(me?.role, 'members.manage') && (
          <DropdownMenuItem onSelect={() => onOpenSettings('members')}>
            <UserPlus className="size-4" /> Invite people
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={(e) => (e.preventDefault(), pick(t.id))}>
            <t.icon className="size-4" /> {t.label}
            {theme === t.id && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">Lists</DropdownMenuLabel>
        {(['comfortable', 'compact'] as const).map((d) => (
          <DropdownMenuItem key={d} onSelect={(e) => (e.preventDefault(), pickDensity(d))}>
            {d === 'compact' ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />} {d === 'compact' ? 'Compact' : 'Comfortable'}
            {density === d && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">
          {me?.workspace?.name} · {roleLabel(me?.role)}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut className="size-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
