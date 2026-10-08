// The workspace's WhatsApp accounts and Embedded Signup (/api/whatsapp/*). Dummy mode answers in this browser.
import { jsonClient } from './client'
import { dummyWhatsApp } from './supportDummy'

export type StepName = 'exchange' | 'subscribe' | 'register' | 'billing' | 'sync' | 'details'
export interface Step {
  state: 'done' | 'failed' | 'skipped'
  at: string
  error?: string
}
export interface WaAccount {
  wabaId: string
  wabaName: string
  businessId: string
  phoneNumbers: { id: string; display: string; verifiedName: string }[]
  source: 'env' | 'signup' | 'coexistence'
  billing: { mode: 'partner_credit' | 'own'; state: 'shared' | 'pending' | 'confirmed' | 'failed'; error?: string }
  steps: Partial<Record<StepName, Step>>
  hasPin: boolean
  canDisconnect: boolean
  /** The business's own account: the console reads it but never rewires it. */
  protected?: boolean
  needsAttention: boolean
  createdAt: string
}
export interface SignupConfig {
  ready: boolean
  missing: string[]
  appId: string | null
  configId: string | null
  sdkVersion: string
  /** Helo.ai's credit line can pay for this business's conversations. */
  partnerCredit: boolean
}
export type Billing = 'partner_credit' | 'own'
export type Flow = 'new' | 'coexistence'

const call = jsonClient(dummyWhatsApp)

export const getSignupConfig = () => call<SignupConfig>('/api/whatsapp/config')
export const listAccounts = () => call<WaAccount[]>('/api/whatsapp/accounts')
export const connectAccount = (b: { code: string; wabaId: string; phoneNumberId: string; businessId: string; flow: Flow; billing: Billing }) =>
  call<{ account: WaAccount; pin?: string }>('/api/whatsapp/connect', 'POST', b)
export const retryAccount = (wabaId: string) => call<WaAccount>(`/api/whatsapp/accounts/${wabaId}/retry`, 'POST', {})
export const setBilling = (wabaId: string, b: { mode: Billing; confirmed?: boolean }) => call<WaAccount>(`/api/whatsapp/accounts/${wabaId}/billing`, 'POST', b)
export const disconnectAccount = (wabaId: string) => call<{ ok: true }>(`/api/whatsapp/accounts/${wabaId}`, 'DELETE')
export const revealPin = (wabaId: string) => call<{ pin: string }>(`/api/whatsapp/accounts/${wabaId}/pin`)

/** Where a business adds its own payment method for WhatsApp conversations. */
/** Quality and limits per number, from Meta (server/health.ts). */
export interface NumberHealth {
  phoneNumberId: string
  display: string
  name: string | null
  /** GREEN | YELLOW | RED | UNKNOWN */
  quality: string
  nameStatus: string | null
  status: string | null
  limit: string | null
  limitLabel: string | null
  checkedAt: string
}
export const getNumberHealth = () => call<NumberHealth[]>('/api/whatsapp/health')
export const refreshNumberHealth = () => call<NumberHealth[]>('/api/whatsapp/health', 'POST', {})
/** Whether WhatsApp webhooks reach this app (they carry customers' words and media into the inbox). */
export interface WebhookStatus {
  lastAt: string | null
  callbackUrl: string
  verifyTokenSet: boolean
  signatureChecked: boolean
  /** How many apps' signatures the server accepts (WEBHOOK_APP_SECRETS). */
  appsAccepted?: number
  last24h?: { field: string; count: number }[]
  /** Deliveries stored but not processed yet, and how many of those failed. */
  pending?: number
  failed?: number
  /** Deliveries in the last 7 days for a number or account no workspace has. */
  unknownNumbers?: number
  /** This console's own listening app (its Meta app id), to point it out in the list. */
  listenerAppId?: string | null
  /** Apps receiving this account's events now (read from Meta), and the first list seen. */
  subscribedApps?: { id: string | null; name: string | null }[] | null
  baseline?: { apps: { id: string | null; name: string | null }[]; at: string } | null
}
export const getWebhookStatus = () => call<WebhookStatus>('/api/whatsapp/webhook-status')
/** Owner: the apps Meta lists now become the expected list (after an app was added or removed on purpose). */
export const resetWebhookBaseline = () => call<WebhookStatus>('/api/whatsapp/webhook-status/baseline', 'POST', {})
export const PAYMENT_URL = 'https://business.facebook.com/wa/manage/home/'
export const STEP_LABEL: Record<StepName, string> = {
  exchange: 'Secure access to your account',
  subscribe: 'Connect your WhatsApp account to Helo.ai',
  register: 'Register your number',
  sync: 'Bring over your chats and contacts',
  details: 'Read your business details',
  billing: 'Set up billing',
}
