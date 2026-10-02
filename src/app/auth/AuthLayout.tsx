import { useId, type ComponentProps, type ReactNode } from 'react'
import logo from '@/assets/helo-logo.svg'
import logoLight from '@/assets/helo-logo-light.svg'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { WA } from '@/app/wizard/steps/whatsappTheme'

// One short exchange in WhatsApp's own look: what the product does, shown rather than described.
const EXCHANGE = [
  { from: 'customer', text: 'Hi! Do you deliver to Pune?', delay: 250 },
  { from: 'agent', text: 'Yes, orders to Pune usually arrive in 2–3 days, and delivery is free. Want me to show you our bestsellers?', delay: 1100 },
] as const

function ChatGlimpse() {
  return (
    <div className="space-y-2" aria-hidden style={{ fontFamily: WA.font }}>
      {EXCHANGE.map((m) => (
        <div key={m.text} className={m.from === 'customer' ? 'flex justify-end pl-12' : 'flex justify-start pr-12'}>
          <p
            className="motion-safe:animate-bubble-in rounded-lg px-3 py-2 shadow-sm"
            style={{
              animationDelay: `${m.delay}ms`,
              background: m.from === 'customer' ? WA.bubbleOut : WA.bubbleIn,
              color: WA.text,
              fontSize: 14,
              lineHeight: '20px',
              [m.from === 'customer' ? 'borderTopRightRadius' : 'borderTopLeftRadius']: 0,
            }}
          >
            {m.text}
          </p>
        </div>
      ))}
    </div>
  )
}

/** Login, sign-up and setup screens: brand panel on wide screens, the form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex lg:w-5/12 xl:p-14">
        <img src={logoLight} alt="Helo.ai" className="h-14 w-auto self-start" />
        <div className="max-w-md space-y-8">
          <h2 className="text-primary-foreground" style={{ fontSize: '2.25rem', lineHeight: 1.15, letterSpacing: '-0.015em' }}>
            Your WhatsApp AI agent, set up and run from one place.
          </h2>
          <ChatGlimpse />
        </div>
        <p className="opacity-80" style={{ fontSize: 'var(--text-sm)' }}>
          Built by Helo.ai, an official Meta Business Solution Provider.
        </p>
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
      <h1 style={{ fontSize: 'var(--text-h4)', letterSpacing: '-0.01em' }}>{title}</h1>
      {children && (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
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
        <p id={`${id}-hint`} className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** A form-level error, announced when it appears. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive" style={{ fontSize: 'var(--text-sm)' }}>
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
