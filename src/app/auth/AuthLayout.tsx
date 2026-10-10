import { useId, type ComponentProps, type ReactNode } from 'react'
import logo from '@/assets/helo-logo.svg'
import heroArt from '@/assets/helo-conversations.svg'
import metaPartner from '@/assets/meta-partner.svg'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'

/** Login, sign-up and setup screens: brand panel on wide screens, the form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Helo.ai's own look (helo.ai): blush page, red-and-black logo, and its homepage art of an agent answering on WhatsApp. */}
      <aside className="hidden flex-col justify-between gap-8 bg-[#FDF3F1] p-10 text-[#14181B] lg:flex lg:w-5/12 xl:p-14">
        <img src={logo} alt="Helo.ai" className="h-14 w-auto self-start" />
        <div className="max-w-md space-y-6">
          <h2 style={{ fontSize: '2.25rem', lineHeight: 1.15, letterSpacing: '-0.015em', color: 'inherit' }}>
            Your WhatsApp AI agent, set up and run from one place.
          </h2>
          {/* The art has a white background; multiply blends it into the blush panel. */}
          <img src={heroArt} alt="" className="max-h-[42vh] w-full object-contain object-left mix-blend-multiply" />
        </div>
        <div className="space-y-3">
          <img src={metaPartner} alt="Meta Partner" className="h-8 w-auto" />
          <p className="opacity-70 text-sm">
            Built by Helo.ai, an official Meta Business Solution Provider.
          </p>
        </div>
      </aside>
      <main className="flex flex-1 justify-center px-4 py-10 sm:items-center sm:py-16">
        <div className="w-full max-w-100">
          <img src={logo} alt="Helo.ai" className="mb-10 h-12 w-auto lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  )
}

/** Screen heading plus one line of context. */
export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 space-y-2">
      {/* The page-level h1 size (3.5rem) is too heavy for a 400px form column. */}
      <h1 className="text-display">{title}</h1>
      {children && (
        <p className="text-muted-foreground text-sm">
          {children}
        </p>
      )}
    </div>
  )
}

/** Label, input and an optional hint, wired together for screen readers. */
export function Field({
  label,
  hint,
  aside,
  ...input
}: { label: string; hint?: string; aside?: ReactNode } & ComponentProps<typeof Input>) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      <Input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
    </div>
  )
}

/** A form-level error, announced when it appears. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
      {children}
    </p>
  )
}

/** An in-text button styled as a link. */
export function TextButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
      {children}
    </button>
  )
}
