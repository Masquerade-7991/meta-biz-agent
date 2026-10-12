import { useState } from 'react'
import { Building2, Check, ChevronRight, Lock, MessageCircle, ShieldCheck, Smartphone } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/app/components/ui/dialog'
import type { Flow } from '@/app/api/whatsapp'
import { cn } from '@/app/lib/utils'

// A stand-in for Meta's Embedded Signup window in Dummy mode. It only shows the journey: it has no
// input fields, so it never asks for or collects anything, and it's labelled as a demo throughout.

const META_BLUE = '#0866ff'
const STEPS: Record<Flow, { title: string; body: string }[]> = {
  new: [
    { title: 'Continue as Asha Rao', body: 'Meta asks you to log in with Facebook and confirms who you are.' },
    { title: 'Choose your business', body: 'Pick the business portfolio this WhatsApp number belongs to, or create one.' },
    { title: 'Create a WhatsApp Business account', body: 'Name the account and choose the display name customers see.' },
    { title: 'Add your phone number', body: 'Enter the number and get a 6-digit code by SMS or call.' },
    { title: 'Review permissions', body: 'Allow Helo.ai to manage the account and send messages for you.' },
  ],
  coexistence: [
    { title: 'Continue as Asha Rao', body: 'Meta asks you to log in with Facebook and confirms who you are.' },
    { title: 'Choose your business', body: 'Pick the business portfolio this WhatsApp number belongs to.' },
    { title: 'Connect your WhatsApp Business app', body: 'Scan the QR code with the WhatsApp Business app on your phone.' },
    { title: 'Share chats and contacts', body: 'Choose to bring your last 6 months of chats and your contacts.' },
    { title: 'Review permissions', body: 'Allow Helo.ai to manage the account and send messages for you.' },
  ],
}

/** What each step looks like inside the window: sample content, never real data, nothing to type. */
function StepVisual({ flow, i }: { flow: Flow; i: number }) {
  const box = 'rounded-lg border border-[#dadde1] bg-white px-3 py-2.5 text-[13px] text-[#1c2b33]'
  if (i === 0)
    return (
      <div className="flex flex-col items-center gap-3 py-2">
        <span className="flex size-14 items-center justify-center rounded-full bg-[#e7f0ff] text-[18px] font-semibold" style={{ color: META_BLUE }}>
          AR
        </span>
        <div className="w-full rounded-md py-2 text-center text-[14px] font-semibold text-white" style={{ background: META_BLUE }}>
          Continue as Asha
        </div>
      </div>
    )
  if (i === 1)
    return (
      <div className="space-y-2">
        {['Asha Foods', 'Asha Foods Exports'].map((b, j) => (
          <div key={b} className={cn(box, 'flex items-center gap-2.5', j === 0 && 'border-[#0866ff] ring-1 ring-[#0866ff]')}>
            <Building2 className="size-4 text-[#65676b]" /> {b}
            {j === 0 && <Check className="ml-auto size-4" style={{ color: META_BLUE }} />}
          </div>
        ))}
      </div>
    )
  if (i === 2 && flow === 'coexistence')
    return (
      <div className="flex flex-col items-center gap-2 py-1">
        <div className="grid size-28 grid-cols-7 gap-0.5 rounded-md border border-[#dadde1] bg-white p-1.5" aria-hidden>
          {Array.from({ length: 49 }, (_, k) => (
            <span key={k} className={(k * 7 + (k % 5) * 3) % 3 === 0 || [0, 1, 7, 8, 5, 6, 12, 13, 35, 36, 42, 43].includes(k) ? 'bg-[#1c2b33]' : 'bg-white'} />
          ))}
        </div>
        <p className="text-[12px] text-[#65676b]">Sample code: scan it in the WhatsApp Business app</p>
      </div>
    )
  if (i === 2)
    return (
      <div className="space-y-2">
        <div className={box}>
          <span className="block text-[11px] text-[#65676b]">WhatsApp Business account name</span>
          Asha Foods
        </div>
        <div className={box}>
          <span className="block text-[11px] text-[#65676b]">Display name</span>
          Asha Foods
        </div>
      </div>
    )
  if (i === 3 && flow === 'coexistence')
    return (
      <div className="space-y-2">
        {['Last 6 months of chats', 'Contacts'].map((t) => (
          <div key={t} className={cn(box, 'flex items-center gap-2.5')}>
            <span className="flex size-4 items-center justify-center rounded-sm text-white" style={{ background: META_BLUE }}>
              <Check className="size-3" />
            </span>
            {t}
          </div>
        ))}
      </div>
    )
  if (i === 3)
    return (
      <div className="space-y-2">
        <div className={cn(box, 'flex items-center gap-2')}>
          <Smartphone className="size-4 text-[#65676b]" /> +91 90000 12345
        </div>
        <div className={cn(box, 'flex items-center gap-2 tracking-[0.4em]')}>
          <Lock className="size-4 text-[#65676b]" /> ••••••
        </div>
      </div>
    )
  return (
    <div className="space-y-2">
      {['Manage your WhatsApp Business account', 'Send and receive messages for your business'].map((t) => (
        <div key={t} className={cn(box, 'flex items-center gap-2.5')}>
          <ShieldCheck className="size-4 text-[#31a24c]" /> {t}
        </div>
      ))}
    </div>
  )
}

/**
 * Meta's signup journey, simulated for Dummy mode: the same steps with sample data and nothing to
 * type. Finish hands back to the connect dialog, which shows what was connected; Close is leaving.
 */
export function SignupWindow({ flow, onDone, onClose }: { flow: Flow; onDone: () => void; onClose: (step: string) => void }) {
  const steps = STEPS[flow]
  const [i, setI] = useState(0)
  const leave = () => onClose(steps[i].title)
  return (
    <Dialog open onOpenChange={(o) => !o && leave()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-104" style={{ fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        {/* Window bar: says plainly that this isn't Meta's real window. */}
        <div className="flex items-center gap-2 border-b border-[#dadde1] bg-[#f0f2f5] px-4 py-2.5">
          <span className="flex size-6 items-center justify-center rounded-full text-white" style={{ background: '#25d366' }}>
            <MessageCircle className="size-3.5" />
          </span>
          <DialogTitle className="text-[14px] font-semibold text-[#1c2b33]">WhatsApp Business signup</DialogTitle>
          <span className="ml-auto rounded bg-[#ffe8a3] px-1.5 py-0.5 text-[11px] font-semibold text-[#5c4300]">Demo</span>
        </div>
        <DialogDescription className="sr-only">A demo of Meta&rsquo;s signup steps with sample data. Nothing is entered here.</DialogDescription>
        <div className="space-y-4 bg-white px-5 py-5">
          <div className="flex gap-1" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((_, j) => (
              <span key={j} className="h-1 flex-1 rounded-full" style={{ background: j <= i ? META_BLUE : '#e4e6eb' }} />
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-[17px] font-semibold text-[#1c2b33]">{steps[i].title}</p>
            <p className="text-[13px] text-[#65676b]">{steps[i].body}</p>
          </div>
          <StepVisual flow={flow} i={i} />
          <p className="flex items-center gap-1.5 text-[11px] text-[#8a8d91]">
            <Lock className="size-3" /> Demo with sample data. Meta&rsquo;s real window asks for your details, never this page.
          </p>
        </div>
        <div className="flex justify-between gap-2 border-t border-[#dadde1] bg-[#f7f8fa] px-5 py-3">
          <Button variant="ghost" size="sm" onClick={i === 0 ? leave : () => setI(i - 1)}>
            {i === 0 ? 'Close' : 'Back'}
          </Button>
          <Button size="sm" style={{ background: META_BLUE }} onClick={() => (i === steps.length - 1 ? onDone() : setI(i + 1))}>
            {i === steps.length - 1 ? 'Finish' : 'Next'} <ChevronRight className="size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
