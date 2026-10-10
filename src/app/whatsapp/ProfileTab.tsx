import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Camera, Globe, Loader2, Mail, MapPin, Store } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Textarea } from '@/app/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { FormError } from '@/app/auth/AuthLayout'
import { useAuth } from '@/app/auth/AuthContext'
import { errorDetail } from '@/app/api/meta'
import { saveProfile, uploadPhoto } from '@/app/api/numbers'
import { can } from '@/app/lib/permissions'
import { WA } from '@/app/wizard/steps/whatsappTheme'
import { PROFILE_LIMITS, profileErrors, VERTICALS, type Profile } from './profileRules'
import { useForcedFailure } from './useForcedFailure'
import { NumberAvatar, type TabProps } from './NumberPage'

const strip = ({ about, address, description, email, websites, vertical }: Profile): Profile => ({ about, address, description, email, websites, vertical })
/** The form keeps one box per website slot; empty slots are dropped before comparing or saving. */
const pad = (p: Profile): Profile => ({ ...p, websites: [...p.websites, '', ''].slice(0, PROFILE_LIMITS.websites) })
const clean = (p: Profile): Profile => ({ ...p, websites: p.websites.map((w) => w.trim()).filter(Boolean) })
const same = (a: Profile, b: Profile) => JSON.stringify(clean(a)) === JSON.stringify(clean(b))

function Count({ n, max }: { n: number; max: number }) {
  return (
    <span className={n > max ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
      {n}/{max}
    </span>
  )
}

/** How the profile looks to a customer who taps the business name in WhatsApp. */
function Preview({ p, name, photo }: { p: Profile; name: string; photo: string | null }) {
  const row = (icon: React.ReactNode, text: string) =>
    text && (
      <div className="flex gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${WA.divider}` }}>
        <span style={{ color: WA.meta }}>{icon}</span>
        <span className="min-w-0 break-words" style={{ color: WA.text }}>
          {text}
        </span>
      </div>
    )
  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-sm" style={{ background: '#fff', fontFamily: WA.font, fontSize: 14 }}>
      <div className="flex flex-col items-center gap-2 px-4 pt-6 pb-4">
        <NumberAvatar photo={photo} name={name} size="lg" />
        <p style={{ fontSize: 20, color: WA.text }}>{name}</p>
        <p style={{ color: WA.meta, fontSize: 13 }}>Business account</p>
      </div>
      {p.description && <p className="px-4 pb-3 whitespace-pre-wrap" style={{ color: WA.text }}>{p.description}</p>}
      {row(<Store className="size-4" />, VERTICALS.find((v) => v.id === p.vertical)?.label ?? '')}
      {row(<MapPin className="size-4" />, p.address)}
      {row(<Mail className="size-4" />, p.email)}
      {p.websites.filter(Boolean).map((w) => (
        <div key={w}>{row(<Globe className="size-4" />, w)}</div>
      ))}
      {p.about && (
        <div className="px-4 py-3" style={{ borderTop: `8px solid ${WA.wallpaper}` }}>
          <p style={{ color: WA.meta, fontSize: 13 }}>About</p>
          <p style={{ color: WA.text }}>{p.about}</p>
        </div>
      )}
    </div>
  )
}

export function ProfileTab({ detail, onSaved, onDirty }: TabProps) {
  const { me } = useAuth()
  const canEdit = can(me?.role, 'numbers.edit')
  const failNext = useForcedFailure()
  const saved = strip(detail.profile)
  const [p, setP] = useState<Profile>(() => pad(saved))
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const errors = profileErrors(clean(p))
  const dirty = !same(p, saved)
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const set = (patch: Partial<Profile>) => setP((x) => ({ ...x, ...patch }))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      failNext()
      const d = await saveProfile(detail.number.id, clean(p))
      onSaved(d)
      setP(pad(strip(d.profile)))
      toast.success('Profile updated on WhatsApp.')
    } catch (err) {
      setError(errorDetail(err))
    } finally {
      setBusy(false)
    }
  }
  async function photo(f: File | undefined) {
    if (!f) return
    if (!['image/jpeg', 'image/png'].includes(f.type)) return void toast.error('Use a JPG or PNG image.')
    if (f.size > 5 * 1024 * 1024) return void toast.error('Profile photos can be 5 MB at most.')
    setPhotoBusy(true)
    try {
      failNext()
      onSaved(await uploadPhoto(detail.number.id, f))
      toast.success('Profile photo updated. Customers see it within a few minutes.')
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-5">
        {!canEdit && (
          <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm">
            Owners and admins change the profile. You can see what customers see.
          </p>
        )}
        <div className="flex items-center gap-4">
          <NumberAvatar photo={detail.profile.photo} name={detail.number.verifiedName} size="md" />
          <input ref={file} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => (void photo(e.target.files?.[0]), (e.target.value = ''))} />
          <Button type="button" variant="outline" size="sm" disabled={!canEdit || photoBusy} onClick={() => file.current?.click()}>
            {photoBusy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            Change photo
          </Button>
          <span className="text-muted-foreground text-xs">
            Square JPG or PNG, at least 192 &times; 192, up to 5 MB.
          </span>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-about" className="flex justify-between">
            About <Count n={p.about.length} max={PROFILE_LIMITS.about} />
          </Label>
          <Input id="pf-about" value={p.about} onChange={(e) => set({ about: e.target.value })} placeholder="Fresh groceries delivered in 30 minutes" />
          {errors.about && <p className="text-destructive text-xs">{errors.about}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-desc" className="flex justify-between">
            Description <Count n={p.description.length} max={PROFILE_LIMITS.description} />
          </Label>
          <Textarea id="pf-desc" rows={3} value={p.description} onChange={(e) => set({ description: e.target.value })} placeholder="What you do, in a sentence or two." />
          {errors.description && <p className="text-destructive text-xs">{errors.description}</p>}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={p.vertical} onValueChange={(v) => set({ vertical: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERTICALS.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-email">Email</Label>
            <Input id="pf-email" type="email" value={p.email} onChange={(e) => set({ email: e.target.value })} placeholder="hello@yourbusiness.com" />
            {errors.email && <p className="text-destructive text-xs">{errors.email}</p>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pf-addr" className="flex justify-between">
            Address <Count n={p.address.length} max={PROFILE_LIMITS.address} />
          </Label>
          <Input id="pf-addr" value={p.address} onChange={(e) => set({ address: e.target.value })} placeholder="Street, city" />
        </div>
        <div className="space-y-1.5">
          <Label>Websites (up to {PROFILE_LIMITS.websites})</Label>
          {p.websites.map((w, i) => (
            <Input key={i} value={w} placeholder={i === 0 ? 'https://yourbusiness.com' : 'https:// (optional)'} aria-label={`Website ${i + 1}`} onChange={(e) => set({ websites: p.websites.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
          {errors.websites && <p className="text-destructive text-xs">{errors.websites}</p>}
        </div>
        {error && <FormError>{error}</FormError>}
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button onClick={() => void save()} disabled={!dirty || busy || Object.keys(errors).length > 0}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save to WhatsApp
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setP(pad(saved))} disabled={busy}>
                Discard changes
              </Button>
            )}
          </div>
        )}
      </fieldset>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          What customers see
        </p>
        <Preview p={clean(p)} name={detail.number.verifiedName || detail.number.display} photo={detail.profile.photo} />
      </div>
    </div>
  )
}
