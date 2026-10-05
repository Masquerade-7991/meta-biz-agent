// WhatsApp number management (/api/whatsapp/numbers/*, server/numbers.ts). Dummy mode answers in
// this browser with the same rules. Screens run Demo controls' forced failure (useForcedFailure) first.
import { jsonClient } from './client'
import { isDummyMode } from './dummy'
import { parse } from './meta'
import { dummyNumbers } from './supportDummy'
import type { Automation, Profile } from '@/app/whatsapp/profileRules'

export interface WaNumber {
  id: string
  wabaId: string
  wabaName: string
  display: string
  verifiedName: string
  status: string
  codeVerification: string | null
  quality: string
  nameStatus: string | null
  /** A display name waiting for Meta's review (or refused). */
  newName: string | null
  newNameStatus: string | null
  platform: string | null
  throughput: string | null
  photo: string | null
  limit: string | null
  pinKnown: boolean
  syncedAt: string
}
export interface NumberDetail {
  number: WaNumber
  profile: Profile & { photo: string | null }
  automation: Automation
  /** The green badge; null when WhatsApp doesn't say. */
  official: boolean | null
  /** Whether the server can remember PINs (TOKEN_ENCRYPTION_KEY is set). */
  pinStorage: boolean
  webhook: { number: string | null; account: string | null; app: string | null; console: string; reachable: boolean; verifyTokenSet: boolean }
  activity: { kind: string; data: Record<string, unknown>; at: string; by: string }[]
}

const call = jsonClient(dummyNumbers)
const base = (id: string, action = '') => `/api/whatsapp/numbers/${id}${action && '/' + action}`
const write = <T>(fn: () => Promise<T>) => fn()

export const listNumbers = (refresh = false) => call<WaNumber[]>(`/api/whatsapp/numbers${refresh ? '?refresh' : ''}`)
export const getNumber = (id: string) => call<NumberDetail>(base(id))
export const saveProfile = (id: string, p: Profile) => write(() => call<NumberDetail>(base(id, 'profile'), 'PUT', p))
export const requestDisplayName = (id: string, name: string) => write(() => call<NumberDetail>(base(id, 'display-name'), 'POST', { name }))
export const saveAutomation = (id: string, a: Automation) => write(() => call<NumberDetail>(base(id, 'automation'), 'PUT', a))
export const changePin = (id: string, pin: string) => write(() => call<NumberDetail>(base(id, 'pin'), 'POST', { pin }))
export const showPin = (id: string) => call<{ pin: string }>(base(id, 'pin'))
export const registerNumber = (id: string, pin?: string) => write(() => call<NumberDetail>(base(id, 'register'), 'POST', pin ? { pin } : {}))
export const deregisterNumber = (id: string, confirm: string) => write(() => call<NumberDetail>(base(id, 'deregister'), 'POST', { confirm }))
export const requestCode = (id: string, method: 'SMS' | 'VOICE') => write(() => call<{ ok: true }>(base(id, 'request-code'), 'POST', { method, language: 'en' }))
export const verifyCode = (id: string, code: string) => write(() => call<NumberDetail>(base(id, 'verify-code'), 'POST', { code }))
export const listBlocked = (id: string) => call<{ user: string }[]>(base(id, 'blocked'))
export const blockUser = (id: string, user: string) => write(() => call<{ ok: true }>(base(id, 'blocked'), 'POST', { user }))
export const unblockUser = (id: string, user: string) => write(() => call<{ ok: true }>(`${base(id, 'blocked')}/${encodeURIComponent(user)}`, 'DELETE'))
export const routeWebhook = (id: string, b: { target: 'console' } | { target: 'other'; url: string; verifyToken: string }) => write(() => call<NumberDetail>(base(id, 'webhook'), 'PUT', b))

/** Uploads a new profile photo (JPG or PNG, up to 5 MB). */
export async function uploadPhoto(id: string, file: File): Promise<NumberDetail> {
  return write(async () => {
    if (isDummyMode()) return dummyNumbers<NumberDetail>('POST', base(id, 'photo'), { file })
    return parse<NumberDetail>(await fetch(base(id, 'photo'), { method: 'POST', headers: { 'content-type': file.type }, body: file }))
  })
}
