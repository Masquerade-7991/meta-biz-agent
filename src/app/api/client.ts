// One JSON caller per area of the server API (inbox, tickets, contacts, broadcasts). Errors and 401s
// go through parse(), like every Meta call; in dummy mode the area's in-browser stand-in answers.
import { isDummyMode } from './dummy'
import { parse } from './meta'

type Answer = <T>(method: string, path: string, body: unknown) => Promise<T>

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
