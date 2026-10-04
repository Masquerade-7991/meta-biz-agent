import { useState } from 'react'
import { Download, FileText, ImageOff, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/app/components/ui/dialog'
import { mediaUrl } from '@/app/api/inbox'
import { WA } from '@/app/wizard/steps/whatsappTheme'
import { formatSize, type MessageMedia } from './media'

const NAMES: Record<MessageMedia['kind'], string> = { image: 'Photo', video: 'Video', audio: 'Audio', document: 'Document', sticker: 'Sticker' }

/** An attachment inside a chat bubble: photos open full size, audio and video play, documents download. */
export function MediaView({ media }: { media: MessageMedia }) {
  const [zoom, setZoom] = useState(false)
  if (media.state === 'failed')
    return (
      <p className="flex items-center gap-2 py-1" style={{ color: WA.meta, fontSize: 13 }}>
        <ImageOff className="size-4" /> {NAMES[media.kind]} no longer available on WhatsApp
      </p>
    )
  if (media.state === 'pending' || !media.id)
    return (
      <p className="flex items-center gap-2 py-1" style={{ color: WA.meta, fontSize: 13 }}>
        <Loader2 className="size-4 animate-spin" /> Getting the {NAMES[media.kind].toLowerCase()} from WhatsApp&hellip;
      </p>
    )
  const src = mediaUrl(media.id)
  if (media.kind === 'image' || media.kind === 'sticker')
    return (
      <>
        <button type="button" className="block overflow-hidden rounded-md" onClick={() => setZoom(true)} aria-label={`Open ${media.filename ?? 'photo'}`}>
          <img src={src} alt={media.caption ?? NAMES[media.kind]} loading="lazy" className={media.kind === 'sticker' ? 'size-32 object-contain' : 'max-h-72 max-w-full object-cover'} />
        </button>
        <Dialog open={zoom} onOpenChange={setZoom}>
          <DialogContent className="max-w-[min(90vw,64rem)] p-2">
            <DialogTitle className="sr-only">{media.filename ?? 'Photo'}</DialogTitle>
            <img src={src} alt={media.caption ?? 'Photo'} className="max-h-[80vh] w-full object-contain" />
            <a href={mediaUrl(media.id, true)} download={media.filename} className="flex items-center gap-1.5 justify-self-end px-2 pb-1 text-primary" style={{ fontSize: 13 }}>
              <Download className="size-4" /> Download
            </a>
          </DialogContent>
        </Dialog>
      </>
    )
  if (media.kind === 'video') return <video src={src} controls preload="metadata" className="max-h-72 max-w-full rounded-md" />
  if (media.kind === 'audio') return <audio src={src} controls preload="metadata" className="w-64 max-w-full" />
  return (
    <a href={mediaUrl(media.id, true)} download={media.filename} className="flex items-center gap-3 rounded-md px-2 py-2" style={{ background: 'rgba(0,0,0,0.05)', color: WA.text }}>
      <FileText className="size-8 shrink-0" style={{ color: WA.meta }} />
      <span className="min-w-0">
        <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>
          {media.filename ?? 'Document'}
        </span>
        <span style={{ fontSize: 12, color: WA.meta }}>{[media.mime.split('/')[1]?.toUpperCase().slice(0, 12), media.size ? formatSize(media.size) : null].filter(Boolean).join(' · ')}</span>
      </span>
      <Download className="ml-auto size-4 shrink-0" style={{ color: WA.meta }} />
    </a>
  )
}
