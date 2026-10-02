import { LogOut, Settings, UserPlus } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/app/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { Separator } from '@/app/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip'
import { NAV_ITEMS, type NavId } from '@/app/nav'
import { cn } from '@/app/lib/utils'
import { useAuth } from '@/app/auth/AuthContext'
import type { SettingsTab } from './SettingsPage'

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?'

export function AppSidebar({
  active,
  onNavigate,
  onOpenSettings,
}: {
  active: NavId
  onNavigate: (id: NavId) => void
  onOpenSettings: (tab: SettingsTab) => void
}) {
  const { me, logout } = useAuth()
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label="Account and workspace">
                <Avatar>
                  <AvatarFallback className="bg-primary text-primary-foreground">{initials(me?.user.name ?? '')}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{me?.workspace?.name}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="w-64">
          <DropdownMenuLabel className="space-y-0.5">
            <div className="truncate">{me?.user.name}</div>
            <div className="truncate text-muted-foreground" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-normal)' }}>
              {me?.user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-normal)' }}>
            {me?.workspace?.name}, {me?.role === 'owner' ? 'Owner' : 'Member'}
          </DropdownMenuLabel>
          {me?.role === 'owner' && (
            <DropdownMenuItem onSelect={() => onOpenSettings('members')}>
              <UserPlus className="size-4" /> Invite people
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onOpenSettings('profile')}>
            <Settings className="size-4" /> Account settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void logout()}>
            <LogOut className="size-4" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator className="my-3 w-8 bg-sidebar-border" />

      <ul className="flex flex-1 flex-col items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <li key={item.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'relative flex size-10 items-center justify-center rounded-lg transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : item.distinct
                          ? 'bg-primary/10 text-primary hover:bg-primary/15'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                    )}
                  >
                    <Icon className="size-5" />
                    {item.distinct && !isActive && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-2 rounded-full bg-primary" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.label}
                  {item.distinct && (
                    <span className="ml-1.5 text-primary-foreground/70">&middot; Agent builder</span>
                  )}
                </TooltipContent>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
