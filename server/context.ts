// Who a piece of work is for: the workspace, and the WhatsApp account it acts through. Set per
// request (index.ts), per webhook event (inbox.ts) and per background job (collectors, broadcasts).
// Imports nothing from the app, so upstream.ts can read it without a cycle.
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/** The WhatsApp account calls are made through. The token stays on the server. */
export interface Assets {
  wabaId: string
  /** The default number: what PHONE_NUMBER_ID means in a path. */
  phoneNumberId: string
  businessId: string
  /** This customer's business token; null = the server's own token (the .env account). */
  token: string | null
  /** Every real ID this workspace may name in a Meta path: its WABA, numbers and business. */
  ids: ReadonlySet<string>
  /** Token per ID, so a call naming a second account's number uses that account's token. */
  tokens: ReadonlyMap<string, string | null>
}
interface Context {
  id: string
  assets: Assets | null
  /** Ties one piece of work together across logs: request → Meta calls → events → later webhooks. */
  traceId: string
  /** The signed-in member the work is for; absent for webhooks and background jobs. */
  userId?: string
}
const store = new AsyncLocalStorage<Context>()

/** The current workspace; 'default' outside any (records from before accounts existed). */
export const ws = () => store.getStore()?.id ?? 'default'
/** The current workspace's WhatsApp account, if it has one. undefined = not inside a workspace. */
export const currentAssets = (): Assets | null | undefined => {
  const c = store.getStore()
  return c ? c.assets : undefined
}
export const traceId = () => store.getStore()?.traceId
export const currentUserId = () => store.getStore()?.userId
/** Nested runs keep the caller's trace and user unless `extra` names others. */
export const runIn = <T>(id: string, assets: Assets | null, fn: () => T, extra: { traceId?: string; userId?: string } = {}): T => {
  const outer = store.getStore()
  return store.run({ id, assets, traceId: extra.traceId ?? outer?.traceId ?? randomUUID(), userId: extra.userId ?? outer?.userId }, fn)
}
