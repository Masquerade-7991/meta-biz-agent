import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CreditCard, ExternalLink, Landmark, Loader2, Mic, Package, Send, ShieldCheck, Smartphone, X } from 'lucide-react'
import { BUY, PAID, rupees, type DummyRich, type Order } from '@/app/api/dummyMeta'
import { Bubble, BubbleButton, Meta, PhoneFrame, WA } from './WhatsAppPreview'

export interface DemoChatMessage {
  from: 'customer' | 'agent' | 'system'
  text: string
  at: number
  quickReplies?: string[]
  rich?: DummyRich
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The dummy-mode Quick test: the scripted conversation in a WhatsApp phone, with a carousel,
 *  an order-details message, an in-chat payment sheet, and an order confirmation. */
export function DemoWhatsAppChat({
  name,
  messages,
  sending,
  disabled,
  onSend,
}: {
  name: string
  messages: DemoChatMessage[]
  sending: boolean
  disabled?: boolean
  /** `shown` is what the customer's bubble says when `text` is an internal token. */
  onSend: (text: string, shown?: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [paying, setPaying] = useState<Order | null>(null)
  const opened = useRef(new Set<string>())
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages.length, sending])

  // WhatsApp opens the payment sheet as the order arrives; once per order.
  useEffect(() => {
    const rich = messages.at(-1)?.rich
    if (rich?.kind === 'order_details' && !opened.current.has(rich.order.id)) {
      opened.current.add(rich.order.id)
      setPaying(rich.order)
    }
  }, [messages])

  const paidOrders = new Set(messages.flatMap((m) => (m.rich?.kind === 'order_confirmed' ? [m.rich.order.id] : [])))
  const busy = sending || !!disabled

  function send() {
    const t = draft.trim()
    if (!t || busy) return
    setDraft('')
    onSend(t)
  }

  return (
    <PhoneFrame
      name={name}
      label="Test conversation"
      scrollRef={scroller}
      overlay={
        paying && (
          <PaymentSheet
            order={paying}
            merchant={name}
            onClose={() => setPaying(null)}
            onPaid={() => {
              setPaying(null)
              onSend(`${PAID}${paying.id}:${paying.product.id}`, `Paid ${rupees(paying.total)} ✓`)
            }}
          />
        )
      }
      composer={
        <form
          className="flex items-center gap-1.5 px-1.5 pb-3 pt-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!!disabled}
            placeholder="Message"
            aria-label="Message"
            className="h-9 min-w-0 flex-1 rounded-full bg-white px-4 outline-none"
            style={{ color: WA.text, fontSize: 13.5 }}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Send"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: WA.green }}
          >
            {draft.trim() ? <Send className="size-4" /> : <Mic className="size-[18px]" />}
          </button>
        </form>
      }
    >
      {messages.map((m, i) => {
        const last = i === messages.length - 1
        if (m.from === 'system')
          return (
            <div
              key={i}
              className="mx-3 rounded-md px-2 py-1 text-center"
              style={{
                background: WA.notice,
                color: WA.noticeText,
                fontSize: 11,
              }}
            >
              {m.text}
            </div>
          )
        if (m.from === 'customer')
          return (
            <Bubble key={i} out>
              <span className="whitespace-pre-wrap break-words">{m.text}</span>
              <Meta out time={clock(m.at)} />
            </Bubble>
          )
        return (
          <div key={i} className="space-y-1.5">
            <AgentMessage
              m={m}
              busy={busy}
              paid={m.rich?.kind === 'order_details' && paidOrders.has(m.rich.order.id)}
              onBuy={(id, label) => onSend(BUY + id, label)}
              onPay={(o) => setPaying(o)}
            />
            {last && !sending && m.quickReplies?.length ? (
              <div className="flex flex-wrap justify-end gap-1.5 pl-8">
                {m.quickReplies.map((qr) => (
                  <button
                    key={qr}
                    type="button"
                    disabled={busy}
                    onClick={() => onSend(qr)}
                    className="rounded-full px-3 py-1 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
                    style={{
                      background: WA.bubbleIn,
                      color: WA.link,
                      fontSize: 12.5,
                      fontWeight: 500,
                    }}
                  >
                    {qr}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      {sending && (
        <Bubble>
          <span className="flex items-center gap-1 py-1" aria-label="The agent is typing">
            {[0, 150, 300].map((d) => (
              <span key={d} className="size-1.5 animate-bounce rounded-full" style={{ background: WA.meta, animationDelay: `${d}ms` }} />
            ))}
          </span>
        </Bubble>
      )}
    </PhoneFrame>
  )
}

function AgentMessage({
  m,
  busy,
  paid,
  onBuy,
  onPay,
}: {
  m: DemoChatMessage
  busy: boolean
  paid: boolean
  onBuy: (productId: string, label: string) => void
  onPay: (o: Order) => void
}) {
  const time = clock(m.at)
  const text = (
    <>
      <span className="whitespace-pre-wrap break-words">{m.text}</span>
      <Meta time={time} />
    </>
  )
  const rich = m.rich

  if (rich?.kind === 'carousel')
    return (
      <>
        <Bubble>{text}</Bubble>
        <div className="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1" tabIndex={0} aria-label="Products">
          {rich.cards.map((p) => (
            <div
              key={p.id}
              className="w-[200px] shrink-0 snap-start overflow-hidden shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]"
              style={{ background: WA.bubbleIn, borderRadius: 7.5 }}
            >
              <div className="p-[3px]">
                <img src={p.image} alt="" className="block h-[110px] w-full object-cover" style={{ borderRadius: 6 }} />
              </div>
              <div className="px-2 pb-1.5 pt-1" style={{ color: WA.text, lineHeight: '17px' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: WA.meta }}>{p.description}</div>
                <div className="mt-0.5" style={{ fontSize: 13, fontWeight: 600 }}>
                  {rupees(p.price)}
                </div>
              </div>
              <BubbleButton icon={ExternalLink} label="Buy now" placeholder="" onClick={busy ? undefined : () => onBuy(p.id, `Buy now: ${p.name}`)} />
            </div>
          ))}
        </div>
      </>
    )

  if (rich?.kind === 'order_details') {
    const o = rich.order
    return (
      <Bubble
        footer={
          <BubbleButton
            icon={CreditCard}
            label={paid ? 'Paid' : 'Review and pay'}
            placeholder=""
            onClick={paid || busy ? undefined : () => onPay(o)}
          />
        }
      >
        <div className="mb-1.5 flex items-center gap-2 rounded-md p-1.5" style={{ background: '#f0f2f5' }}>
          <img src={o.product.image} alt="" className="size-11 shrink-0 rounded object-cover" />
          <div className="min-w-0 flex-1" style={{ fontSize: 12 }}>
            <div className="truncate" style={{ fontWeight: 600 }}>
              {o.product.name}
            </div>
            <div style={{ color: WA.meta }}>
              Monthly plan · {rupees(o.total)}
            </div>
          </div>
        </div>
        <div className="mb-1" style={{ fontSize: 11.5, color: WA.meta }}>
          Order {o.id}
        </div>
        {text}
      </Bubble>
    )
  }

  if (rich?.kind === 'order_confirmed') {
    const o = rich.order
    const rows: [string, string][] = [
      ['Order', o.id],
      ['Plan', `${o.product.name} · 1 month`],
      ['Amount paid', rupees(o.total)],
      ['Payment ID', rich.paymentRef],
      ['Live by', rich.eta],
    ]
    return (
      <Bubble>
        <div
          className="-mx-2 -mt-1.5 mb-1.5 flex items-center gap-1.5 rounded-t-[7.5px] rounded-tl-none px-2 py-1.5 text-white"
          style={{ background: WA.green, fontSize: 13, fontWeight: 600 }}
        >
          <Package className="size-4" /> Order confirmed
        </div>
        <dl className="mb-1.5 space-y-0.5" style={{ fontSize: 12 }}>
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt style={{ color: WA.meta }}>{k}</dt>
              <dd className="truncate text-right" style={{ fontWeight: 500 }}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {text}
      </Bubble>
    )
  }

  return <Bubble>{text}</Bubble>
}

const METHODS = [
  { id: 'upi', icon: Smartphone, label: 'UPI', detail: 'customer@okaxis' },
  {
    id: 'card',
    icon: CreditCard,
    label: 'Debit or credit card',
    detail: 'Visa •••• 4242',
  },
  {
    id: 'netbanking',
    icon: Landmark,
    label: 'Net banking',
    detail: 'HDFC Bank',
  },
] as const

/** WhatsApp's in-chat checkout, as a bottom sheet inside the phone. Nothing is charged. */
function PaymentSheet({ order, merchant, onClose, onPaid }: { order: Order; merchant: string; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('upi')
  const [stage, setStage] = useState<'review' | 'processing' | 'done'>('review')
  // Kept in a ref so a parent re-render can't restart the timers below.
  const paidRef = useRef(onPaid)
  paidRef.current = onPaid

  useEffect(() => {
    if (stage === 'processing') {
      const t = setTimeout(() => setStage('done'), 1800)
      return () => clearTimeout(t)
    }
    if (stage === 'done') {
      const t = setTimeout(() => paidRef.current(), 1400)
      return () => clearTimeout(t)
    }
  }, [stage])

  const rows: [string, string][] = [
    [`${order.product.name} · 1 month`, rupees(order.subtotal)],
    ['Setup', order.delivery ? rupees(order.delivery) : 'Free'],
  ]

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end" style={{ background: 'rgba(11,20,26,0.45)' }}>
      <div role="dialog" aria-label="Payment" className="rounded-t-2xl bg-white px-4 pb-4 pt-2" style={{ color: WA.text, fontFamily: WA.font }}>
        <div className="mx-auto mb-2 h-1 w-9 rounded-full" style={{ background: WA.divider }} />
        {stage === 'review' && (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span style={{ fontSize: 15, fontWeight: 600 }}>Review and pay</span>
              <button type="button" onClick={onClose} aria-label="Close" style={{ color: WA.meta }}>
                <X className="size-5" />
              </button>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <img src={order.product.image} alt="" className="size-10 rounded object-cover" />
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{merchant}</div>
                <div style={{ color: WA.meta }}>Order {order.id}</div>
              </div>
            </div>
            <div className="space-y-1 border-y py-2" style={{ fontSize: 12.5, borderColor: WA.divider }}>
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span style={{ color: WA.meta }}>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              <div className="flex justify-between pt-1" style={{ fontWeight: 600 }}>
                <span>Total</span>
                <span>{rupees(order.total)}</span>
              </div>
            </div>
            <div className="mb-1 mt-2" style={{ fontSize: 12, color: WA.meta }}>
              Pay with
            </div>
            <div className="space-y-1" role="radiogroup" aria-label="Payment method">
              {METHODS.map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  role="radio"
                  aria-checked={method === pm.id}
                  onClick={() => setMethod(pm.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
                  style={{
                    border: `1px solid ${method === pm.id ? WA.green : WA.divider}`,
                  }}
                >
                  <pm.icon className="size-4 shrink-0" style={{ color: WA.meta }} />
                  <span className="min-w-0 flex-1" style={{ fontSize: 12.5 }}>
                    <span className="block" style={{ fontWeight: 500 }}>
                      {pm.label}
                    </span>
                    <span className="block" style={{ color: WA.meta, fontSize: 11 }}>
                      {pm.detail}
                    </span>
                  </span>
                  <span
                    className="flex size-4 items-center justify-center rounded-full"
                    style={{
                      border: `2px solid ${method === pm.id ? WA.green : WA.faint}`,
                    }}
                  >
                    {method === pm.id && <span className="size-2 rounded-full" style={{ background: WA.green }} />}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStage('processing')}
              className="mt-3 w-full rounded-full py-2.5 text-white"
              style={{ background: WA.green, fontSize: 14, fontWeight: 600 }}
            >
              Pay {rupees(order.total)}
            </button>
            <p className="mt-1.5 flex items-center justify-center gap-1" style={{ fontSize: 10.5, color: WA.meta }}>
              <ShieldCheck className="size-3" /> Secured payment
            </p>
          </>
        )}
        {stage === 'processing' && (
          <div className="flex flex-col items-center gap-2 py-10" style={{ fontSize: 13 }}>
            <Loader2 className="size-8 animate-spin" style={{ color: WA.green }} />
            Processing payment…
          </div>
        )}
        {stage === 'done' && (
          <div className="flex flex-col items-center gap-1 py-8 text-center">
            <CheckCircle2 className="size-12" style={{ color: WA.green }} />
            <span style={{ fontSize: 15, fontWeight: 600 }}>Payment successful</span>
            <span style={{ fontSize: 12, color: WA.meta }}>
              {rupees(order.total)} paid to {merchant}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
