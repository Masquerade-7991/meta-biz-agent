// One JSON caller per area of the server API (inbox, tickets, contacts, templates). Errors and 401s
// go through parse(), like every Meta call; in dummy mode the area's in-browser stand-in answers.
import { isDummyMode } from './dummy'
import { parse } from './meta'

type Answer = <T>(method: string, path: string, body: unknown) => Promise<T>

type SupportDummy = typeof import('./supportDummy')
type AnswerName = { [K in keyof SupportDummy]: SupportDummy[K] extends Answer ? K : never }[keyof SupportDummy]

/** One area's dummy-mode answerer from supportDummy.ts, loaded on first use: it's sample data and
 *  in-browser logic people outside dummy mode never need, so it stays out of their download. */
export const supportDummy =
  (name: AnswerName): Answer =>
  <T>(method: string, path: string, body: unknown) =>
    import('./supportDummy').then((m) => (m[name] as Answer)<T>(method, path, body))

export const jsonClient =
  (dummy: Answer) =>
  async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    if (isDummyMode()) return dummy<T>(method, path, body)
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return parse<T>(res)
  }
