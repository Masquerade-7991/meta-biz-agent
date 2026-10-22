// One JSON caller per area of the server API (inbox, tickets, contacts, templates). Errors and 401s
// go through parse(), like every Meta call; in dummy mode the area's in-browser stand-in answers.
import { isDummyMode } from './dummy'
import { parse } from './meta'
import { stampOf, type Stamp } from '@/app/components/shell/settings/formCore'

type Answer = <T>(method: string, path: string, body: unknown, headers?: Record<string, string>) => Promise<T>

type SupportDummy = typeof import('./supportDummy')
type AnswerName = { [K in keyof SupportDummy]: SupportDummy[K] extends Answer ? K : never }[keyof SupportDummy]

/** One area's dummy-mode answerer from supportDummy.ts, loaded on first use: it's sample data and
 *  in-browser logic people outside dummy mode never need, so it stays out of their download. */
export const supportDummy =
  (name: AnswerName): Answer =>
  <T>(method: string, path: string, body: unknown, headers?: Record<string, string>) =>
    import('./supportDummy').then((m) => (m[name] as Answer)<T>(method, path, body, headers))

export const jsonClient =
  (dummy: Answer) =>
  async <T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> => {
    if (isDummyMode()) return dummy<T>(method, path, body, headers)
    const res = await fetch(path, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return parse<T>(res)
  }

/** The header a settings save sends so the server refuses it (409) when someone else saved since
 *  `updatedAt`; none = save regardless ("Keep mine"). */
export const guard = (updatedAt: string | null | undefined): Record<string, string> | undefined => (updatedAt ? { 'if-unmodified-since': updatedAt } : undefined)

/** Like jsonClient, but also says when the answer was last saved and by whom: from the
 *  x-updated-at / x-updated-by headers (lists like the routing rules), or from the body's own
 *  updatedAt / updatedBy. Dummy mode puts them in the body. */
export const stampedClient =
  (dummy: Answer) =>
  async <T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<{ data: T; stamp: Stamp }> => {
    if (isDummyMode()) {
      const data = await dummy<T>(method, path, body, headers)
      return { data, stamp: stampOf(data) }
    }
    const res = await fetch(path, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const at = res.headers.get('x-updated-at')
    const by = res.headers.get('x-updated-by')
    const data = await parse<T>(res)
    const own = stampOf(data)
    return { data, stamp: at ? { updatedAt: at, updatedBy: by ? decodeURIComponent(by) : null } : own }
  }
