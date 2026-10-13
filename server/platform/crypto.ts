// Sealing secrets we must keep (customers' WhatsApp business tokens, number PINs): AES-256-GCM with
// TOKEN_ENCRYPTION_KEY (32 bytes, base64). A sealed value is "v1.<iv>.<tag>.<data>" in base64url.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function keyFrom(b64: string): Buffer | null {
  const k = b64 ? Buffer.from(b64, 'base64') : null
  return k?.length === 32 ? k : null
}

export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv, c.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

/** Throws if the value was tampered with or sealed under another key. */
export function open(sealed: string, key: Buffer): string {
  const [v, iv, tag, data] = sealed.split('.')
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Not a sealed value')
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
}
