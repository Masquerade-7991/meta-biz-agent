// The workspace's WhatsApp accounts and Embedded Signup (/api/whatsapp/*). Dummy mode answers in this browser.
import { jsonClient, supportDummy } from './client'

export type StepName = 'exchange' | 'subscribe' | 'register' | 'billing' | 'sync' | 'details'
export interface Step {
  /** waiting: on the business (its own payment method); expired: Meta's time for it passed. */
  state: 'done' | 'failed' | 'skipped' | 'waiting' | 'expired'
  at: string
  error?: string
}
export interface WaAccount {
  wabaId: string
  wabaName: string
  businessId: string
  phoneNumbers: { id: string; display: string; verifiedName: string; /** A Meta test number: replies reach only up to 5 verified recipients. */ sandbox?: boolean }[]
  source: 'env' | 'signup' | 'coexistence'
  /** The number signed up (the one the PIN belongs to). */
  primaryNumberId?: string
  billing: { mode: 'partner_credit' | 'own'; state: 'shared' | 'pending' | 'confirmed' | 'failed'; error?: string }
  steps: Partial<Record<StepName, Step>>
  hasPin: boolean
  canDisconnect: boolean
  /** The business's own account: the console reads it but never rewires it. */
  protected?: boolean
  needsAttention: boolean
  createdAt: string
}
/**
 * How connecting works on this server: `sdk`, the full signup (Meta's window, then the console
 * finishes the connection); `hosted`, Meta's hosted signup link only (Meta's real flow opens and
 * Helo.ai completes the connection on its side); `none`, not switched on.
 */
export interface SignupConfig {
  mode: 'sdk' | 'hosted' | 'none'
  /** Helo.ai's credit line can pay for this business's conversations. */
  partnerCredit: boolean
  /** sdk, owners only. */
  appId?: string
  configId?: string
  sdkVersion?: string
  /** hosted, owners only: Meta's signup page as configured (what Connect opens), and for each flow. */
  link?: string
  links?: Record<Flow, string>
}
export type Billing = 'partner_credit' | 'own'
export type Flow = 'new' | 'coexistence'

const call = jsonClient(supportDummy('dummyWhatsApp'))

export const getSignupConfig = () => call<SignupConfig>('/api/whatsapp/config')
export const listAccounts = () => call<WaAccount[]>('/api/whatsapp/accounts')
export const connectAccount = (b: { code: string; wabaId: string; phoneNumberId: string; businessId: string; flow: Flow; billing: Billing }) =>
  call<{ account: WaAccount; pin?: string }>('/api/whatsapp/connect', 'POST', b)
export const retryAccount = (wabaId: string) => call<WaAccount>(`/api/whatsapp/accounts/${wabaId}/retry`, 'POST', {})
export const setBilling = (wabaId: string, b: { mode: Billing; confirmed?: boolean }) => call<WaAccount>(`/api/whatsapp/accounts/${wabaId}/billing`, 'POST', b)
export const disconnectAccount = (wabaId: string) => call<{ ok: true }>(`/api/whatsapp/accounts/${wabaId}`, 'DELETE')
export const revealPin = (wabaId: string) => call<{ pin: string }>(`/api/whatsapp/accounts/${wabaId}/pin`)

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
  /** The last real event (routed to one of this workspace's numbers). */
  lastAt: string | null
  /** The last sample event from Meta's "Test" button: proves the callback and signature work. */
  lastTestAt?: string | null
  callbackUrl: string
  verifyTokenSet: boolean
  signatureChecked: boolean
  /** How many apps' signatures the server accepts (WEBHOOK_APP_SECRETS). */
  appsAccepted?: number
  last24h?: { field: string; count: number }[]
  /** Deliveries stored but not processed yet, and how many of those failed. */
  pending?: number
  failed?: number
  /** Numbers on this account that are Meta test numbers (sandbox). */
  sandboxNumbers?: number
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
/** Where a business adds its own payment method for WhatsApp conversations. */
export const PAYMENT_URL = 'https://business.facebook.com/wa/manage/home/'
export const STEP_LABEL: Record<StepName, string> = {
  exchange: 'Secure access to your account',
  subscribe: 'Connect your WhatsApp account to Helo.ai',
  register: 'Register your number',
  sync: 'Bring over your chats and contacts',
  details: 'Read your business details',
  billing: 'Set up billing',
}
