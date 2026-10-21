import { WA } from '@/app/wizard/steps/whatsappTheme'

/** A template as the customer sees it, in WhatsApp's bubble. */
export function TemplatePreview({ text }: { text: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: WA.wallpaper }}>
      <p className="max-w-sm rounded-lg px-2.5 py-1.5 whitespace-pre-wrap shadow-sm" style={{ background: WA.bubbleIn, color: WA.text, fontFamily: WA.font, fontSize: 14, lineHeight: '19px' }}>
        {text}
      </p>
    </div>
  )
}
