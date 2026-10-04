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
export const PAYMENT_URL = 'https://business.facebook.com/wa/manage/home/'
export const STEP_LABEL: Record<StepName, string> = {
  exchange: 'Secure access to your account',
  subscribe: 'Connect your WhatsApp account to Helo.ai',
  register: 'Register your number',
  sync: 'Bring over your chats and contacts',
  details: 'Read your business details',
  billing: 'Set up billing',
}
