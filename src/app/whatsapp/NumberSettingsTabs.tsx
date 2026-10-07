import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Badge } from '@/app/components/ui/badge'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { requestDisplayName, saveAutomation } from '@/app/api/numbers'
import { can } from '@/app/lib/permissions'
import { WA } from '@/app/wizard/steps/whatsappTheme'
import { AUTOMATION_LIMITS, automationErrors, displayNameError, type Automation } from './profileRules'
import { useForcedFailure } from './useForcedFailure'
import type { TabProps } from './NumberPage'

const GUIDELINES = [
  'It matches your business, as on your website or signage.',
  'Your business name with a description is fine: “Helo Foods Support”.',
  'No full person’s names, generic words alone (“Groceries”) or web addresses.',
  'Normal capitals and punctuation, no emoji or decoration.',
]
const NAME_STATUS: Record<string, string> = {
  APPROVED: 'Approved',
  AVAILABLE_WITHOUT_REVIEW: 'Approved',
  PENDING_REVIEW: 'In review',
  DECLINED: 'Declined',
  EXPIRED: 'Review expired',
  NON_EXISTS: 'Not reviewed yet',
  NONE: 'Not reviewed yet',
}

/** The name customers see above your chats. Changing it goes through Meta's review. */
export function DisplayNameTab({ detail, onSaved, onDirty, onRegister }: TabProps & { onRegister: () => void }) {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'numbers.edit')
  const failNext = useForcedFailure()
  const n = detail.number
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = name.trim() ? displayNameError(name) : null
  useEffect(() => onDirty(!!name.trim()), [name, onDirty])
  const pending = n.newNameStatus === 'PENDING_REVIEW'
  // Approved but not live: WhatsApp shows the new name only after the number registers again.
  const approvedNotLive = n.newNameStatus === 'APPROVED' && !!n.newName

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      failNext()
      onSaved(await requestDisplayName(n.id, name.trim()))
      setName('')
      toast.success('Sent for review. WhatsApp usually decides within a few days, and you’ll see it here.')
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            Current name
          </p>
          <p className="flex flex-wrap items-center gap-2 font-semibold" style={{ fontSize: '1.125rem' }}>
            {n.verifiedName || '—'}
            {n.nameStatus && <Badge variant="secondary">{NAME_STATUS[n.nameStatus] ?? n.nameStatus.toLowerCase()}</Badge>}
          </p>
        </div>
        {pending && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
            <strong>&ldquo;{n.newName}&rdquo; is in review.</strong> Your current name stays until WhatsApp approves it. We update this page when the review finishes.
          </p>
        )}
        {n.newNameStatus === 'DECLINED' && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <strong>WhatsApp declined &ldquo;{n.newName}&rdquo;.</strong> Check it against the guidelines and try a different name.
          </p>
        )}
        {approvedNotLive && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success/5 px-4 py-3 text-sm">
            <span className="min-w-60 flex-1">
              <strong>&ldquo;{n.newName}&rdquo; was approved.</strong> Register the number again within 14 days so customers see it.
            </span>
            <Button size="sm" onClick={onRegister}>
              Register now
            </Button>
          </div>
        )}
        {canEdit ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="dn">New display name</Label>
              <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} placeholder={n.verifiedName} disabled={busy || pending} />
              {problem && <p className="text-destructive text-xs">{problem}</p>}
              <p className="text-muted-foreground text-xs">
                You can change it up to 10 times in 30 days.
              </p>
            </div>
            {error && <FormError>{error}</FormError>}
            <Button type="submit" disabled={busy || pending || !name.trim() || !!problem || name.trim() === n.verifiedName}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Send for review
            </Button>
          </form>
        ) : (
          <p className="text-muted-foreground text-sm">
            Owners and admins request name changes.
          </p>
        )}
      </div>
      <div className="space-y-2 rounded-lg border border-border p-4">
        <p className="text-sm font-semibold">What WhatsApp approves</p>
        <ul className="space-y-1.5 text-xs">
          {GUIDELINES.map((g) => (
            <li key={g} className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> {g}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Ice breakers (tappable first messages) and / commands customers see in a new chat. */
export function AutomationTab({ detail, onSaved, onDirty }: TabProps) {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'numbers.edit')
  const failNext = useForcedFailure()
  const saved = detail.automation
  const [a, setA] = useState<Automation>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = JSON.stringify(a) !== JSON.stringify(saved)
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const problem = automationErrors(a)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      failNext()
      const d = await saveAutomation(detail.number.id, a)
      onSaved(d)
      setA(d.automation)
      toast.success('Saved. Customers see the change in new chats.')
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-6">
        <div className="space-y-2">
          <Label>Ice breakers (up to {AUTOMATION_LIMITS.prompts})</Label>
          <p className="text-muted-foreground text-xs">
            Questions a customer can tap to start a chat. Your AI agent answers them like any message.
          </p>
          {a.prompts.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={p} maxLength={AUTOMATION_LIMITS.prompt + 20} aria-label={`Ice breaker ${i + 1}`} onChange={(e) => setA({ ...a, prompts: a.prompts.map((x, j) => (j === i ? e.target.value : x)) })} />
              <span className={p.length > AUTOMATION_LIMITS.prompt ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {p.length}/{AUTOMATION_LIMITS.prompt}
              </span>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove ice breaker ${i + 1}`} onClick={() => setA({ ...a, prompts: a.prompts.filter((_, j) => j !== i) })}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {a.prompts.length < AUTOMATION_LIMITS.prompts && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setA({ ...a, prompts: [...a.prompts, ''] })}>
              <Plus className="size-4" /> Add an ice breaker
            </Button>
          )}
        </div>
        <div className="space-y-2">
          <Label>Commands</Label>
          <p className="text-muted-foreground text-xs">
            Shortcuts a customer sees after typing / in your chat.
          </p>
          {a.commands.map((c, i) => (
            <div key={i} className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-2">
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">/</span>
                <Input className="pl-6" value={c.name} aria-label={`Command ${i + 1} name`} onChange={(e) => setA({ ...a, commands: a.commands.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/^\//, '') } : x)) })} />
              </div>
              <Input value={c.description} placeholder="What it does" aria-label={`Command ${i + 1} description`} onChange={(e) => setA({ ...a, commands: a.commands.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove command ${i + 1}`} onClick={() => setA({ ...a, commands: a.commands.filter((_, j) => j !== i) })}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {a.commands.length < AUTOMATION_LIMITS.commands && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setA({ ...a, commands: [...a.commands, { name: '', description: '' }] })}>
              <Plus className="size-4" /> Add a command
            </Button>
          )}
        </div>
        {(error || (dirty && problem)) && <FormError>{error ?? problem}</FormError>}
        {canEdit && (
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={!dirty || busy || !!problem}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save to WhatsApp
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setA(saved)} disabled={busy}>
                Discard changes
              </Button>
            )}
          </div>
        )}
      </fieldset>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          A new chat
        </p>
        <div className="space-y-2 rounded-2xl p-4" style={{ background: WA.wallpaper, fontFamily: WA.font, fontSize: 14 }}>
          {a.prompts.filter((p) => p.trim()).length === 0 && a.commands.filter((c) => c.name.trim()).length === 0 && <p style={{ color: WA.meta }}>Nothing yet: customers see an empty chat.</p>}
          {a.prompts
            .filter((p) => p.trim())
            .map((p) => (
              <div key={p} className="rounded-lg px-3 py-2 text-center shadow-sm" style={{ background: '#fff', color: WA.link }}>
                {p}
              </div>
            ))}
          {a.commands.some((c) => c.name.trim()) && (
            <div className="rounded-lg shadow-sm" style={{ background: '#fff' }}>
              {a.commands
                .filter((c) => c.name.trim())
                .map((c) => (
                  <p key={c.name} className="px-3 py-1.5" style={{ color: WA.text, borderBottom: `1px solid ${WA.divider}` }}>
                    /{c.name} <span style={{ color: WA.meta }}>{c.description}</span>
                  </p>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
