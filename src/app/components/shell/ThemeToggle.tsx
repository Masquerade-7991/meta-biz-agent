import { Moon, Sun } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/ui/tooltip'
import { toggleTheme, useIsDark } from '@/app/lib/theme'
import { HEADER_ICON_BUTTON } from './headerButton'

/** Top-bar switch between light and dark. "Match system" stays available in ⌘K. */
export function ThemeToggle() {
  const dark = useIsDark()
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={toggleTheme} aria-label={label} className={HEADER_ICON_BUTTON}>
          {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
