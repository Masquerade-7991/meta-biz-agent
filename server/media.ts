// Chat attachments, kept in MongoDB GridFS (bucket "media") because WhatsApp deletes media after
// about 30 days. Inbound files are fetched from Meta by a job right after the webhook; outbound files
// are stored here first, then uploaded to Meta and sent. Files are only served to their workspace.
// ponytail: whole files pass through memory (WhatsApp's largest is a 100 MB document); stream to
// GridFS and Meta if bigger files or many parallel uploads become normal.
import type http from 'node:http'
import { GridFSBucket, ObjectId } from 'mongodb'
import { HttpError } from './http.ts'
import { col, db, ws } from './db.ts'
import { callUpstream, downloadMeta, metaJson, parseJson, resolveIds } from './upstream.ts'
import { defineJob } from './jobs.ts'
import { trace } from './trace.ts'
import type { MediaKind, MessageMedia } from '../src/app/inbox/media.ts'

const bucket = () => {
  if (!db) throw new Error('No database')
  return new GridFSBucket(db, { bucketName: 'media' })
}

/** Stores a file for the current workspace; returns its id. */
export async function saveMedia(buf: Buffer, o: { mime: string; filename?: string; source: 'whatsapp' | 'upload' }): Promise<string> {
  const id = new ObjectId()
  await new Promise<void>((resolve, reject) => {
    const up = bucket().openUploadStreamWithId(id, o.filename || 'file', { metadata: { workspaceId: ws(), mime: o.mime, source: o.source } })
    up.once('finish', () => resolve())
    up.once('error', reject)
    up.end(buf)
  })
  return String(id)
}

/** GET /api/inbox/media/<id>: the file, if it belongs to this workspace. */
export async function serveMedia(id: string, res: http.ServerResponse, download: boolean) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'No such file.')
  const f = await col('media.files').findOne({ _id: new ObjectId(id), 'metadata.workspaceId': ws() })
  if (!f) throw new HttpError(404, 'No such file.')
  const name = encodeURIComponent(String(f.filename ?? 'file'))
  res.writeHead(200, {
    'content-type': String(f.metadata?.mime ?? 'application/octet-stream'),
    'content-length': String(f.length),
    'cache-control': 'private, max-age=86400',
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
    'x-content-type-options': 'nosniff',
  })
  bucket().openDownloadStream(f._id).pipe(res)
}

/** Uploads a stored file to WhatsApp for sending; returns Meta's media id. */
export async function uploadToMeta(buf: Buffer, mime: string, filename: string): Promise<string> {
  const form = new FormData()
  form.set('messaging_product', 'whatsapp')
  form.set('type', mime)
  form.set('file', new Blob([new Uint8Array(buf)], { type: mime }), filename)
  const body = new Response(form)
  const r = await callUpstream('graph', 'POST', resolveIds('/PHONE_NUMBER_ID/media'), Buffer.from(await body.arrayBuffer()), body.headers.get('content-type') ?? undefined)
  const json = parseJson(r.text) as { id?: string; error?: { message?: string; code?: number } } | null
  if (r.status >= 300 || !json?.id) throw new HttpError(r.status === 400 ? 400 : 502, json?.error?.message ?? `WhatsApp didn’t take the file (${r.status}).`, json?.error?.code)
  return json.id
}

/** WhatsApp message types that carry media, and the attachment to store for an inbound one. */
export const MEDIA_TYPES = new Set<MediaKind>(['image', 'video', 'audio', 'document', 'sticker'])
export function inboundMedia(type: MediaKind, m: Record<string, unknown>): MessageMedia & { waMediaId: string } {
  const o = (m[type] ?? {}) as Record<string, unknown>
  return {
    kind: type,
    mime: String(o.mime_type ?? 'application/octet-stream'),
    waMediaId: String(o.id ?? ''),
    ...(typeof o.filename === 'string' && { filename: o.filename }),
    ...(typeof o.caption === 'string' && { caption: o.caption }),
    state: 'pending',
  }
}

// Fetches an inbound file from WhatsApp into GridFS, then tells open screens the message changed.
const setState = async (messageId: unknown, state: MessageMedia['state'], extra: Record<string, unknown> = {}) => {
  const msg = await col('messages').findOneAndUpdate({ workspaceId: ws(), _id: new ObjectId(String(messageId)) }, { $set: { 'media.state': state, ...extra } })
  if (msg) trace('message.updated', { media: state }, { entity: 'conversation', id: String(msg.phone) })
}
defineJob(
  'media.fetch',
  async (p) => {
    const msg = await col('messages').findOne({ workspaceId: ws(), _id: new ObjectId(String(p.messageId)) })
    const media = msg?.media as (MessageMedia & { waMediaId?: string }) | undefined
    if (!msg || !media?.waMediaId || media.state === 'ready') return
    let info
    try {
      info = await metaJson('graph', 'GET', `/${media.waMediaId}`)
    } catch (err) {
      // 400: WhatsApp no longer has it (expired or deleted); anything else is worth retrying.
      if ((err as { status?: number }).status === 400) return setState(p.messageId, 'failed')
      throw err
    }
    const { buf, mime } = await downloadMeta(String(info.url))
    const id = await saveMedia(buf, { mime: String(info.mime_type ?? mime), filename: media.filename, source: 'whatsapp' })
    await setState(p.messageId, 'ready', { 'media.id': id, 'media.size': buf.length })
  },
  { maxAttempts: 4, onDead: (p) => setState(p.messageId, 'failed') },
)
