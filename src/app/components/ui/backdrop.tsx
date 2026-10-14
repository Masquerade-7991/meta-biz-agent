import { cn } from '@/app/lib/utils'

/** The decorative band behind the top of a page (styles in src/styles/backdrop.css). Put it first
 *  inside a scrolling container that has `relative isolate`. `band` for pages, `hero` for Home,
 *  `auth` for the sign-in screens. */
export function Backdrop({ variant = 'band' }: { variant?: 'band' | 'hero' | 'auth' }) {
  return <div aria-hidden className={cn('backdrop', variant !== 'band' && `backdrop--${variant}`)} />
}
