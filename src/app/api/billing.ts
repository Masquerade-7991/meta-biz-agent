// WhatsApp spend and the monthly budget (/api/billing, server/billing.ts). Dummy mode answers in this browser.
import { jsonClient } from './client'
import { dummyBilling } from './supportDummy'

export interface Billing {
  currency: string | null
  budget: number | null
  lastSyncAt: string | null
  lastSyncError: string | null
  month: { total: number; byCategory: { category: string; cost: number; volume: number }[] }
  days: { day: string; cost: number; volume: number }[]
}

const call = jsonClient(dummyBilling)
export const getBilling = () => call<Billing>('/api/billing')
export const setBudget = (budget: number | null) => call<Billing>('/api/billing', 'PUT', { budget })
export const syncBilling = () => call<Billing>('/api/billing/sync', 'POST', {})
