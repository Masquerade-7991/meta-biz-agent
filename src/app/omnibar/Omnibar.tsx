import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Search, X } from 'lucide-react'
import { OPEN_COMMAND_PALETTE, openCommandPalette, PALETTE_SHORTCUT } from '@/app/lib/commandPalette'
import { navFor, pathFor } from '@/app/nav'
import { useAuth } from '@/app/auth/AuthContext'
import { useWizard } from '@/app/wizard/WizardContext'
import { setTheme } from '@/app/lib/theme'
import { setDensity } from '@/app/lib/density'
import { switchWorkspace } from '@/app/auth/workspaceSwitch'
import { confirmLeave } from '@/app/components/shell/settings/leaveGuard'
import { HEADER_ICON_BUTTON } from '@/app/components/shell/headerButton'
import { cn } from '@/app/lib/utils'
import { useOmnibarActiveScope } from './OmnibarContext'
import { goToEntries, type GoToEntry } from './goTo'
import { rank } from './rank'
import type { OmniItem } from './scope'

type Row = { group: 'page'; item: OmniItem } | { group: 'go'; item: GoToEntry }

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

/** The top bar's one search. It filters the page you're on (its registered scope, useOmnibarScope)
 *  and lists the best matches on the page and a short Go to list. ⌘K / Ctrl K or / focuses it; on
 *  phones it opens as a bar under the header (OmnibarButton). */
export function Omnibar({ className }: { className?: string }) {
  const scope = useOmnibarActiveScope()
  const { me } = useAuth()
  const { state } = useWizard()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [active, setActive] = useState(-1)

  // The text is the page's filter in query mode. While typing, the field leads; otherwise it follows
  // the page (a saved view, the address), and a new page or scope starts from the page's value.
  const pageQuery = scope?.query?.value
  const scopeKey = `${pathname}|${scope?.id ?? ''}`
  const lastKey = useRef(scopeKey)
  useEffect(() => {
    const switched = lastKey.current !== scopeKey
    lastKey.current = scopeKey
    if (switched || document.activeElement !== inputRef.current) setDraft(pageQuery ?? '')
    if (switched) setActive(-1)
  }, [pageQuery, scopeKey])

  useEffect(() => {
    const focus = () => {
      setMobileOpen(true)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // An open dialog or side panel keeps the keyboard (its focus trap would pull focus back anyway).
      if (document.querySelector('[role=dialog][data-state=open]')) return
      if ((mod && e.key.toLowerCase() === 'k') || (e.key === '/' && !mod && !e.altKey && !isTyping(e.target))) {
        e.preventDefault()
        focus()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_COMMAND_PALETTE, focus)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_COMMAND_PALETTE, focus)
    }
  }, [])

  const agentName = state.gate.gatePassed ? state.identity.agentName.trim() || 'Your agent' : null
  const goTo = useMemo(
    () =>
      me?.role
        ? goToEntries({
            role: me.role,
            pages: navFor(me.role).map((p) => ({ id: p.id, label: p.label, icon: p.icon, path: pathFor(p.id) })),
            agentName,
            otherWorkspaces: me.workspaces.filter((w) => w.id !== me.workspace?.id),
          })
        : [],
    [me, agentName],
  )

  const queryMode = !!scope?.query
  const rows: Row[] = useMemo(() => {
    const page = scope?.items ? (queryMode ? scope.items.slice(0, 6) : rank(scope.items, draft, 6)) : []
    // A Go to row that repeats one on the page (Home's Inbox card and the Inbox page) is left out.
    const shown = new Set(page.map((i) => i.label))
    const go = rank(goTo.filter((g) => !shown.has(g.label)), draft, 5)
    return [...page.map((item) => ({ group: 'page' as const, item })), ...go.map((item) => ({ group: 'go' as const, item }))]
  }, [scope, queryMode, draft, goTo])
  const hi = active < rows.length ? active : -1

  function change(v: string) {
    setDraft(v)
    scope?.query?.onChange(v)
    setOpen(true)
    setActive(!queryMode && v.trim() ? 0 : -1)
  }

  function close() {
    setOpen(false)
    setActive(-1)
    setMobileOpen(false)
    inputRef.current?.blur()
  }

  function run(row: Row) {
    close()
    if (!queryMode) setDraft('')
    if (row.group === 'page') return row.item.run()
    const a = row.item.action
    if (a.kind === 'path') void confirmLeave().then((ok) => ok && navigate(a.path))
    else if (a.kind === 'tab') window.open(a.url, '_blank', 'noopener')
    else if (a.kind === 'theme') setTheme(a.theme)
    else if (a.kind === 'density') setDensity(a.density)
    else void switchWorkspace(a.id)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const n = rows.length
      if (n) setActive(e.key === 'ArrowDown' ? (hi + 1) % n : hi <= 0 ? n - 1 : hi - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (hi >= 0) run(rows[hi])
      else setOpen(false)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (draft) change('')
      else close()
    }
  }

  const placeholder = scope?.placeholder ?? 'Search or jump to…'
  const pageRows = rows.filter((r) => r.group === 'page')
  const goRows = rows.filter((r) => r.group === 'go')
  const option = (row: Row) => {
    const i = rows.indexOf(row)
    const Icon = row.item.icon
    return (
      <div
        key={`${row.group}:${row.item.id}`}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={i === hi}
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={() => i !== hi && setActive(i)}
        onClick={() => run(row)}
        className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', i === hi && 'bg-accent text-accent-foreground')}
      >
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">{row.item.label}</span>
        {row.item.hint && <span className="max-w-[45%] shrink-0 truncate text-meta text-muted-foreground">{row.item.hint}</span>}
      </div>
    )
  }
  const group = (id: string, heading: string, list: Row[]) =>
    list.length > 0 && (
      <div role="group" aria-labelledby={`${listId}-${id}`}>
        <div id={`${listId}-${id}`} role="presentation" className="px-2 pt-1.5 pb-1 text-meta font-medium text-muted-foreground">
          {heading}
        </div>
        {list.map(option)}
      </div>
    )

  return (
    <div
      className={cn(
        'md:relative md:ml-auto md:block',
        'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:z-40 max-md:border-b max-md:border-border max-md:bg-background max-md:p-2',
        !mobileOpen && 'max-md:hidden',
        className,
      )}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={placeholder}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && hi >= 0 ? `${listId}-${hi}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => change(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            if (!draft) setMobileOpen(false)
          }}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-md border border-border bg-muted/50 pr-12 pl-9 text-sm transition-colors outline-none placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
        />
        {draft ? (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => change('')}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-card px-1.5 font-mono text-micro text-muted-foreground max-md:hidden">
            {PALETTE_SHORTCUT}
          </kbd>
        )}
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-float max-md:inset-x-2">
          {scope?.note && <p className="px-2 py-1.5 text-meta text-muted-foreground">{scope.note}</p>}
          <div id={listId} role="listbox" aria-label="Search results">
            {group('page', 'On this page', pageRows)}
            {group('go', 'Go to', goRows)}
          </div>
          {rows.length === 0 && <p className="px-2 py-3 text-center text-sm text-muted-foreground">Nothing matches.</p>}
        </div>
      )}
    </div>
  )
}

/** Phones: the header's search icon opens the omnibar as a bar under the header. */
export function OmnibarButton() {
  return (
    <button type="button" onClick={openCommandPalette} aria-label="Search" className={`${HEADER_ICON_BUTTON} md:hidden`}>
      <Search className="size-5" />
    </button>
  )
}
