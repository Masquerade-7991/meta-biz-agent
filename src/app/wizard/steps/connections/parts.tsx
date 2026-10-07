import { useId, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Input } from '@/app/components/ui/input'
import { cn } from '@/app/lib/utils'
import type { ValueLocation } from '@/app/wizard/types'
import type { RequestPreview } from '@/app/wizard/toolRequest'
import { PLACE } from './places'

// Shared pieces of the connection and tool dialogs. Plain building blocks, styled from theme tokens.


/** A numbered form section: a short title, one line of help, then its fields. */
export function FormSection({ n, title, help, children }: { n: number; title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-semibold">
          {n}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{title}</h3>
          {help && (
            <p className="text-muted-foreground text-xs">
              {help}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-4 sm:pl-7.5">{children}</div>
    </section>
  )
}

/** Field label + control + one line of help or error. Errors replace the help, never stack. */
export function Field({ label, htmlFor, help, error, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : (
        help && (
          <p className="text-muted-foreground text-xs">
            {help}
          </p>
        )
      )}
    </div>
  )
}

/** A row of mutually exclusive options (radio semantics), each with an optional one-line hint. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  columns,
}: {
  value: T
  options: { id: T; title: string; hint?: string }[]
  onChange: (v: T) => void
  disabled?: boolean
  label: string
  columns?: 2 | 3
}) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <label
            key={o.id}
            className={cn(
              'relative flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring',
              on ? 'border-primary bg-accent' : 'border-border hover:border-primary/50',
              disabled && !on && 'cursor-not-allowed opacity-50',
              disabled && on && 'cursor-default',
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={on} disabled={disabled} onChange={() => onChange(o.id)} />
            <span className="flex items-center justify-between gap-2 text-sm font-medium">
              {o.title}
              {on && <Check className="size-4 shrink-0 text-primary" />}
            </span>
            {o.hint && (
              <span className="text-muted-foreground text-xs">
                {o.hint}
              </span>
            )}
          </label>
        )
      })}
    </div>
  )
}

/**
 * A secret: typed once, never shown again. With a saved one on Meta and nothing typed, it reads
 * "Saved key ending 86a5" with Replace; typing replaces it.
 */
export function SecretInput({
  id,
  value,
  onChange,
  savedHint,
  replacing,
  onReplace,
  onKeep,
  placeholder,
  invalid,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  /** Last characters of the saved secret; set when Meta already has one. */
  savedHint?: string
  replacing: boolean
  onReplace: () => void
  onKeep?: () => void
  placeholder?: string
  invalid?: boolean
}) {
  if (savedHint !== undefined && !replacing)
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-input bg-muted/40 px-3 py-2">
        <span className="font-mono text-muted-foreground text-sm">
          {savedHint ? `Saved · ends in ${savedHint}` : 'Saved'}
        </span>
        <button type="button" onClick={onReplace} className="text-primary hover:underline text-xs">
          Replace
        </button>
      </div>
    )
  return (
    <div className="flex items-center gap-2">
      <Input id={id} type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-invalid={invalid} className="font-mono" />
      {savedHint !== undefined && onKeep && (
        <button type="button" onClick={onKeep} className="shrink-0 text-muted-foreground hover:underline text-xs">
          Keep saved
        </button>
      )}
    </div>
  )
}

export function PlaceBadge({ place }: { place: ValueLocation }) {
  const p = PLACE[place]
  return (
    <span
      className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold"
      style={{ color: p.tone, background: `color-mix(in srgb, ${p.tone} 12%, transparent)` }}
    >
      {p.short}
    </span>
  )
}

export function MethodBadge({ method }: { method: string }) {
  const tone = method === 'GET' ? 'var(--chart-1)' : method === 'DELETE' ? 'var(--chart-3)' : 'var(--chart-2)'
  return (
    <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold" style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
      {method}
    </span>
  )
}

/** The request written out, the way it's sent. Agent-filled parts (‹…›) are highlighted. */
export function RequestPreviewBlock({ preview }: { preview: RequestPreview }) {
  const mark = (s: string) =>
    s.split(/(‹[^›]*›)/).map((part, i) =>
      part.startsWith('‹') ? (
        <span key={i} className="rounded bg-accent text-accent-foreground">
          {part}
        </span>
      ) : (
        part
      ),
    )
  return (
    <pre className="min-w-0 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 break-all whitespace-pre-wrap text-xs">
      <span className="font-semibold">{preview.method}</span> {mark(preview.url)}
      {preview.headers.map(([k, v]) => (
        <span key={k}>
          {'\n'}
          <span className="text-muted-foreground">{k}:</span> {mark(v)}
        </span>
      ))}
      {preview.body && (
        <>
          {'\n\n'}
          {mark(preview.body)}
        </>
      )}
    </pre>
  )
}
