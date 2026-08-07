import { Avatar, AvatarFallback } from '@/app/components/ui/avatar'
import { Separator } from '@/app/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip'
import { NAV_ITEMS, type NavId } from '@/app/nav'
import { cn } from '@/app/lib/utils'

export function AppSidebar({
  active,
  onNavigate,
}: {
  active: NavId
  onNavigate: (id: NavId) => void
}) {
  return (
    <nav className="flex w-16 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="rounded-full" aria-label="Workspace">
            <Avatar>
              <AvatarFallback className="bg-primary text-primary-foreground">A</AvatarFallback>
            </Avatar>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Aurora Home Goods</TooltipContent>
      </Tooltip>

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
