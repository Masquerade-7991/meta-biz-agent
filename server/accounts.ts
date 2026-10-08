// WhatsApp accounts a workspace has connected (Embedded Signup) or was given by the server (.env).
// Every request runs with its workspace's accounts (context.ts): the oldest is the default for the
// WABA_ID / PHONE_NUMBER_ID placeholders, and each call uses the token of the account it names.
import type { Db } from 'mongodb'
import { col } from './db.ts'
import { keyFrom, open } from './crypto.ts'
import { env } from './upstream.ts'
import type { Assets } from './context.ts'
import { addProtected } from './protect.ts'

export type StepState = { state: 'done' | 'failed' | 'skipped'; at: Date; error?: string }
export interface Account {
  workspaceId: string
  wabaId: string
  wabaName: string
  businessId: string
  phoneNumbers: { id: string; display: string; verifiedName: string }[]
  /** env: the server's own WABA from .env; signup / coexistence: connected through Embedded Signup. */
  source: 'env' | 'signup' | 'coexistence'
  /** The customer's business token, sealed (crypto.ts); null for the env account. */
  tokenEnc: string | null
  pinEnc?: string
  billing: { mode: 'partner_credit' | 'own'; state: 'shared' | 'pending' | 'confirmed' | 'failed'; error?: string }
  steps: Partial<Record<'exchange' | 'subscribe' | 'register' | 'billing' | 'sync' | 'details', StepState>>
  connectedBy: string | null
  createdAt: Date
}

export const accounts = () => col<Account>('whatsapp_accounts')
export const tokenKey = () => keyFrom(env('TOKEN_ENCRYPTION_KEY'))

const cache = new Map<string, { at: number; assets: Assets | null }>()
/** Call after a workspace's accounts change so the next request sees it. */
export const forgetAssets = (workspaceId: string) => void cache.delete(workspaceId)

/** The accounts a workspace acts through, ready for context.ts (tokens opened here, never sent out). */
export async function assetsFor(workspaceId: string): Promise<Assets | null> {
  const hit = cache.get(workspaceId)
  if (hit && Date.now() - hit.at < 30_000) return hit.assets
  const list = await accounts().find({ workspaceId }).sort({ createdAt: 1 }).toArray()
  const key = tokenKey()
  const tokens = new Map<string, string | null>()
  for (const a of list) {
    let token: string | null = null
    if (a.tokenEnc) {
      if (!key) continue // can't open it: this account is unusable until TOKEN_ENCRYPTION_KEY is set
      token = open(a.tokenEnc, key)
    }
    for (const id of [a.wabaId, a.businessId, ...a.phoneNumbers.map((p) => p.id)].filter(Boolean)) tokens.set(id, token)
    // The server's own account (the business's) and every number it has: never rewired (protect.ts).
    if (a.source === 'env') addProtected(a.wabaId, a.businessId, ...a.phoneNumbers.map((p) => p.id))
  }
  const first = list.find((a) => tokens.has(a.wabaId))
  const assets: Assets | null = first
    ? { wabaId: first.wabaId, phoneNumberId: first.phoneNumbers[0]?.id ?? '', businessId: first.businessId, token: tokens.get(first.wabaId) ?? null, ids: new Set(tokens.keys()), tokens }
    : null
  cache.set(workspaceId, { at: Date.now(), assets })
  return assets
}

/** Which workspace a phone number belongs to, for webhooks. */
export async function workspaceForNumber(phoneNumberId: string): Promise<string | null> {
  return (await accounts().findOne({ 'phoneNumbers.id': phoneNumberId }, { projection: { workspaceId: 1 } }))?.workspaceId ?? null
}

/** One-time: the .env WhatsApp account becomes an account record of the workspace that owned it. */
export async function migrateEnvAccount(d: Db) {
  const wabaId = env('WABA_ID')
  const phoneNumberId = env('PHONE_NUMBER_ID')
  if (!wabaId || !phoneNumberId) return
  const owner = await d.collection('workspaces').findOne({ metaAssets: true })
  if (!owner || (await d.collection('whatsapp_accounts').findOne({ wabaId }))) return
  const doc: Account = {
    workspaceId: String(owner._id),
    wabaId,
    wabaName: env('WABA_NAME') || env('BUSINESS_NAME') || `WABA ${wabaId}`,
    businessId: env('BUSINESS_ID'),
    phoneNumbers: [{ id: phoneNumberId, display: env('PHONE_NUMBER'), verifiedName: env('PHONE_NAME') }],
    source: 'env',
    tokenEnc: null,
    billing: { mode: 'partner_credit', state: 'shared' },
    steps: {},
    connectedBy: null,
    createdAt: (owner.createdAt as Date) ?? new Date(),
  }
  await d.collection('whatsapp_accounts').insertOne(doc)
}
