// How a website's reading is shown. Meta's states, in plain words, plus the one step of the process
// the site is at. Checked live (Oct 2026): Meta answers `completed` with pages_crawled 0 even when
// the agent clearly learned from the site, so a zero count is "not reported", never a fact.

import type { WebsiteSource } from './types.ts'

export type SiteStage = 'queued' | 'reading' | 'ready' | 'empty' | 'failed' | 'slow'
export interface SiteView {
  stage: SiteStage
  label: string
  tone: 'muted' | 'info' | 'success' | 'warning' | 'danger'
  /** One sentence: what's happening and, when stuck, what to do. */
  line: string
  /** Where it is in Queued → Reading → Ready, while it's still going; null once finished. */
  step: 0 | 1 | null
}

export function siteView(s: Pick<WebsiteSource, 'status' | 'pagesRead' | 'stalled' | 'crawlError'>): SiteView {
  const pages = s.pagesRead > 0 ? `${s.pagesRead} page${s.pagesRead === 1 ? '' : 's'}` : null
  if ((s.status === 'not_started' || s.status === 'waiting' || s.status === 'reading') && s.stalled)
    return { stage: 'slow', label: 'Taking a while', tone: 'warning', line: 'Meta is still working on it. Check back later, or read it again.', step: s.status === 'reading' ? 1 : 0 }
  switch (s.status) {
    case 'not_started':
    case 'waiting':
      return { stage: 'queued', label: 'Queued', tone: 'muted', line: 'Waiting for Meta to start reading.', step: 0 }
    case 'reading':
      return { stage: 'reading', label: 'Reading', tone: 'info', line: `Meta is reading the site${pages ? `: ${pages} so far` : ''}. Large sites can take a few minutes.`, step: 1 }
    case 'done':
      return { stage: 'ready', label: 'Ready', tone: 'success', line: `Your agent can answer from this site${pages ? ` (${pages})` : ''}.`, step: null }
    case 'done_no_data':
      return { stage: 'empty', label: 'Nothing usable', tone: 'warning', line: 'Meta read it but found no text it could use. Try a page with more written content, like your FAQ or help page.', step: null }
    case 'failed':
      return { stage: 'failed', label: 'Couldn’t read', tone: 'danger', line: s.crawlError ? `Meta couldn’t read it: ${s.crawlError}` : 'Meta couldn’t read it.', step: null }
  }
}

const parts = (url: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    return { host: u.host.replace(/^www\./, '').toLowerCase(), path: u.pathname.replace(/\/+$/, '') }
  } catch {
    return null
  }
}

/** Another listed site that already includes this address (Meta reads a whole site from where you point it). */
export function coveredBy<T extends { url: string }>(url: string, sites: T[]): T | undefined {
  const me = parts(url)
  if (!me) return undefined
  return sites.find((s) => {
    const o = parts(s.url)
    return !!o && o.host === me.host && o.path !== me.path && (o.path === '' || me.path.startsWith(`${o.path}/`))
  })
}
