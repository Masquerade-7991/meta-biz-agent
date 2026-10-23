import type { LucideIcon } from 'lucide-react'

// What the top bar's omnibar searches on the page someone is on. A page registers one with
// useOmnibarScope (OmnibarContext.tsx); the most specific one mounted wins.

/** A row the omnibar's dropdown can show under "On this page". */
export interface OmniItem {
  id: string
  label: string
  hint?: string
  icon?: LucideIcon
  /** More words it should match on (not shown). */
  keywords?: string
  run: () => void
}

export interface OmnibarScope {
  /** Where it belongs: 'inbox', 'settings/members', 'studio/knowledge/faq'. More segments = more specific. */
  id: string
  placeholder: string
  /** List pages: the omnibar's text is the page's own filter (the page keeps its server query, debounce, URL). */
  query?: { value: string; onChange: (q: string) => void }
  /** With a query, the page's top results; without one, everything the omnibar searches on this page. */
  items?: OmniItem[]
  /** A line at the top of the dropdown (e.g. what to paste on Settings › Activity). */
  note?: string
}

export interface ScopeEntry {
  scope: OmnibarScope
  seq: number
}
export type ScopeEntries = Record<string, ScopeEntry>

/** Adds, updates (keeping its place) or, with null, removes a page's scope. */
export function setScope(entries: ScopeEntries, id: string, scope: OmnibarScope | null, seq: number): ScopeEntries {
  if (!scope) {
    if (!(id in entries)) return entries
    const next = { ...entries }
    delete next[id]
    return next
  }
  return { ...entries, [id]: { scope, seq: entries[id]?.seq ?? seq } }
}

/** The innermost scope: the one with the most path segments; among equals, the latest mounted.
 *  (React mounts children before parents, so mount order alone would let Settings beat its tab.) */
export function activeScope(entries: ScopeEntries): OmnibarScope | null {
  let best: ScopeEntry | null = null
  const depth = (e: ScopeEntry) => e.scope.id.split('/').length
  for (const e of Object.values(entries)) {
    if (!best || depth(e) > depth(best) || (depth(e) === depth(best) && e.seq > best.seq)) best = e
  }
  return best?.scope ?? null
}
