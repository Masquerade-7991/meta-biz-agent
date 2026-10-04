// What WhatsApp accepts as media (Cloud API "supported media types"), shared so the browser can
// refuse a file before uploading it and the server enforces the same rules.

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker'

const MB = 1024 * 1024
export const MEDIA_RULES: Record<Exclude<MediaKind, 'sticker'>, { mimes: string[]; max: number; label: string }> = {
  image: { mimes: ['image/jpeg', 'image/png'], max: 5 * MB, label: 'Images (JPG, PNG) up to 5 MB' },
  video: { mimes: ['video/mp4', 'video/3gpp'], max: 16 * MB, label: 'Videos (MP4, 3GP) up to 16 MB' },
  audio: { mimes: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'], max: 16 * MB, label: 'Audio (AAC, AMR, MP3, M4A, OGG) up to 16 MB' },
  document: {
    mimes: [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    max: 100 * MB,
    label: 'Documents (PDF, Word, Excel, PowerPoint, TXT) up to 100 MB',
  },
}

/** `accept` for a file input: everything WhatsApp lets a business send. */
export const ACCEPT = Object.values(MEDIA_RULES).flatMap((r) => r.mimes).join(',')

/** The kind a file goes out as, or an error to show. Parameters after `;` (e.g. codecs) are ignored. */
export function checkMedia(mime: string, size: number): { kind: Exclude<MediaKind, 'sticker'> } | { error: string } {
  const base = mime.split(';')[0].trim().toLowerCase()
  for (const [kind, r] of Object.entries(MEDIA_RULES) as [Exclude<MediaKind, 'sticker'>, (typeof MEDIA_RULES)['image']][]) {
    if (!r.mimes.includes(base)) continue
    if (size > r.max) return { error: `That file is ${(size / MB).toFixed(1)} MB. WhatsApp allows ${r.label.toLowerCase()}.` }
    if (size === 0) return { error: 'That file is empty.' }
    return { kind }
  }
  return { error: `WhatsApp can’t send ${base || 'this kind of file'}. It accepts images (JPG, PNG), videos (MP4), audio and documents (PDF, Office, TXT).` }
}

export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < MB ? `${Math.round(n / 1024)} KB` : `${(n / MB).toFixed(1)} MB`)

/** A message's attachment. `id` is ours (GET /api/inbox/media/<id>) once the file is stored. */
export interface MessageMedia {
  kind: MediaKind
  mime: string
  id?: string
  filename?: string
  size?: number
  caption?: string
  /** pending: still being fetched from WhatsApp; failed: WhatsApp no longer has it. */
  state: 'pending' | 'ready' | 'failed'
}

/** Short text for a message that is only an attachment (chat list previews, notifications). */
export function mediaLabel(kind: MediaKind, filename?: string) {
  if (kind === 'document') return filename ? `📄 ${filename}` : '📄 Document'
  return { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Audio', sticker: 'Sticker' }[kind]
}
