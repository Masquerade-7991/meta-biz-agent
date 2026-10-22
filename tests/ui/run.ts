// UI checks with playwright-core (the installed Chrome, headless) over the main pages:
//   dummy   Dummy mode's sample data, at 1440 and 390 wide, light and dark, plus axe colour contrast;
//   empty   a fresh workspace on a throwaway server (tests/e2e harness): every list empty;
//   error   the same, with every data API answering 500;
//   loading the same, with every data API never answering;
//   stale   a page's code can't be fetched (a tab left open across a deploy): the app must say so.
// Each load is checked for uncaught page errors, horizontal scroll, raw "undefined"/"NaN" text, and
// (error/loading) a visible error message or loader. Screenshots and results go to tests/ui/out/.
//
//   node tests/ui/run.ts [--modes=dummy,empty,error,loading] [--pages=home,inbox]
// Uses its own ports (Vite 5176, API 8797) and never the user's :5173 / :8787.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import { ROOT, startStack, type Stack } from '../e2e/harness.ts'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const MODES = (args.modes ?? 'dummy,empty,error,loading,stale').split(',')
const PAGES: [string, string][] = [
  ['home', '/'],
  ['inbox', '/inbox'],
  ['tickets', '/tickets'],
  ['contacts', '/contacts'],
  ['agents', '/agents'],
  ['whatsapp', '/whatsapp'],
  ['analytics', '/analytics'],
  ['reports', '/reports'],
  ['report-summary', '/reports/business_review'],
  ['report-records', '/reports/tickets'],
  ['report-schedules', '/reports/schedules'],
  ['settings', '/settings/support'],
  // Settings: the home, each area's first tab, the new tabs, and the addresses that redirect.
  ['settings-home', '/settings'],
  ['settings-general', '/settings/general'],
  ['settings-members', '/settings/members'],
  ['settings-profile', '/settings/profile'],
  ['settings-notifications', '/settings/notifications'],
  ['settings-security', '/settings/security'],
  ['settings-routing', '/settings/routing'],
  ['settings-escalation', '/settings/escalation'],
  ['settings-fields', '/settings/fields'],
  ['whatsapp-account', '/whatsapp?tab=account'],
  ['settings-whatsapp', '/settings/whatsapp'],
  ['settings-unknown', '/settings/nonsense'],
]
/** Addresses that must land somewhere else (path + query). */
const REDIRECTS: Record<string, string> = { '/settings/whatsapp': '/whatsapp?tab=account', '/settings/nonsense': '/settings' }
// Pages that load nothing visible (a fixed list): no loader or error to look for. The Reports library's
// reports load on their own pages, which are checked.
const NO_DATA = new Set(['reports', 'settings-home', 'settings-unknown'])
// Pages whose data is the account and workspace routes, which the error and loading modes keep
// working (DATA below): they're checked in dummy and empty modes only.
for (const id of ['settings-general', 'settings-members', 'settings-profile', 'settings-notifications', 'settings-security']) NO_DATA.add(id)
const pages = args.pages ? PAGES.filter(([id]) => args.pages.split(',').includes(id)) : PAGES
const OUT = path.join(import.meta.dirname, 'out')
mkdirSync(OUT, { recursive: true })
const VITE_PORT = 5176
const APP = `http://localhost:${VITE_PORT}`

interface Result {
  mode: string
  page: string
  width: number
  theme: string
  problems: string[]
  contrast?: number
}
const results: Result[] = []

async function startVite(apiPort: number) {
  let out = ''
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(VITE_PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  p.stdout.on('data', (b: Buffer) => (out += b))
  p.stderr.on('data', (b: Buffer) => (out += b))
  for (let i = 0; i < 120; i++) {
    if (p.exitCode !== null) throw new Error(`vite exited:\n${out}`)
    if ((await fetch(APP).catch(() => null))?.ok) return p
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`vite did not start:\n${out}`)
}

/** Lets the page settle: the route's code loaded, data in, page loaders gone (or `ms` passed). */
async function settle(page: Page, ms = 12_000) {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => document.querySelector('#root')?.childElementCount, null, { timeout: ms }).catch(() => {})
  await page.waitForTimeout(400)
  await page.waitForFunction(() => !document.querySelector('[role=status] .wavy-loader'), null, { timeout: ms }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
}

async function check(ctx: BrowserContext, mode: string, [id, url]: [string, string], width: number, theme: string, extra?: (p: Page) => Promise<string[]>, axe = false) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.split('\n')[0]}`))
  page.on('console', (m) => {
    // In stale mode the failed import is the point of the check (it must then show a message), so its
    // own error lines, and the error boundary's report of it, are expected.
    const expected = mode === 'stale' && /dynamically imported module|Page failed|^%o$/.test(m.text())
    if (m.type() === 'error' && !expected && !/Failed to load resource|status of 5\d\d|net::ERR_ABORTED/.test(m.text())) problems.push(`console error: ${m.text().split('\n')[0].slice(0, 200)}`)
  })
  try {
    await page.goto(APP + url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  } catch (err) {
    problems.push(`did not load: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
  }
  await settle(page, mode === 'loading' ? 2500 : 12_000)
  const layout = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    raw: (document.body.innerText.match(/\b(undefined|NaN)\b|\[object Object\]|Invalid Date/g) ?? []).slice(0, 3),
    path: location.pathname + location.search,
  }))
  if (layout.scroll > 1) problems.push(`horizontal scroll: ${layout.scroll}px`)
  if (layout.raw.length) problems.push(`raw values on screen: ${layout.raw.join(', ')}`)
  const want = REDIRECTS[url] ?? url
  if (layout.path !== want && !(url === '/agents' && layout.path.startsWith('/agents'))) problems.push(`${REDIRECTS[url] ? 'expected a redirect to ' + want + ', got' : 'redirected to'} ${layout.path}`)
  // A narrow screen starts a deep-linked Settings tab scrolled into view.
  if (width < 500 && /^\/settings\/[a-z]+$/.test(want)) {
    const offscreen = await page.evaluate(() => {
      const el = document.querySelector('[data-slot=tabs-trigger][data-state=active]')
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.left < 0 || r.right > window.innerWidth
    })
    if (offscreen) problems.push('the active Settings tab is off screen')
  }
  if (extra) problems.push(...(await extra(page)))
  let contrast: number | undefined
  if (axe) {
    const r = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
    contrast = r.violations.reduce((n, v) => n + v.nodes.length, 0)
    if (contrast) problems.push(`contrast: ${contrast} element(s) below AA, e.g. ${r.violations[0].nodes[0].target.join(' ')} (${r.violations[0].nodes[0].any[0]?.message?.slice(0, 120)})`)
  }
  await page.screenshot({ path: path.join(OUT, `${mode}-${id}-${width}-${theme}.png`), fullPage: false })
  results.push({ mode, page: id, width, theme, problems, contrast })
  console.log(`${problems.length ? '✖' : '✔'} ${mode.padEnd(7)} ${id.padEnd(10)} ${String(width).padEnd(4)} ${theme.padEnd(5)}${problems.length ? '\n    - ' + problems.join('\n    - ') : ''}`)
  await page.close()
}

/** Runs in the page before the app: the theme choice and the Dummy mode switch. */
const prime = (s: { theme: string; dummy: boolean }) => {
  try {
    localStorage.setItem('helo-theme', s.theme)
    if (s.dummy) localStorage.setItem('meta-agent-dummy-mode', '1')
    else localStorage.removeItem('meta-agent-dummy-mode')
  } catch {
    // storage blocked
  }
}

let stack: Stack | null = null
let vite: ReturnType<typeof spawn> | null = null
let browser: Browser | null = null
try {
  stack = await startStack('ui')
  const w = await stack.seed.workspace({ name: 'Fresh workspace' })
  vite = await startVite(Number(new URL(stack.base).port))
  browser = await chromium.launch({ channel: 'chrome', headless: true })

  const context = async (theme: string, dummy: boolean) => {
    const ctx = await browser!.newContext({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
    await ctx.addInitScript(prime, { theme, dummy })
    if (!dummy) await ctx.addCookies([{ name: 'sid', value: w.owner.token, domain: 'localhost', path: '/' }])
    return ctx
  }
  // Data APIs only: signing in, health and the live stream keep working.
  const DATA = (u: URL) => u.pathname.startsWith('/api/') && !/^\/api\/(auth\/|account|workspace\b|health|stream)/.test(u.pathname)

  if (MODES.includes('dummy'))
    for (const theme of ['light', 'dark']) {
      const ctx = await context(theme, true)
      for (const p of pages) for (const width of [1440, 390]) await check(ctx, 'dummy', p, width, theme, undefined, width === 1440)
      await ctx.close()
    }
  if (MODES.includes('empty')) {
    const ctx = await context('light', false)
    for (const p of pages) for (const width of [1440, 390]) await check(ctx, 'empty', p, width, 'light')
    await ctx.close()
  }
  if (MODES.includes('error')) {
    const ctx = await context('light', false)
    await ctx.route(DATA, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', detail: 'Injected by the UI checks.', status: 500 }) }))
    for (const p of pages.filter(([name]) => !NO_DATA.has(name)))
      await check(ctx, 'error', p, 1440, 'light', async (page) => {
        // Waits for it (up to 8 s): a page under load can still be between its loader and its message.
        const shown = await page
          .waitForFunction(() => /couldn|could not|went wrong|try again|server error|injected by the ui checks|unavailable|failed/i.test(document.body.innerText), null, { timeout: 8000 })
          .then(() => true, () => false)
        return shown ? [] : ['no error message on screen while every data call fails']
      })
    await ctx.close()
  }
  if (MODES.includes('loading')) {
    const ctx = await context('light', false)
    await ctx.route(DATA, () => {
      // never answer: the page must show it's loading
    })
    for (const p of pages.filter(([name]) => !NO_DATA.has(name)))
      await check(ctx, 'loading', p, 1440, 'light', async (page) => {
        const loading = await page.evaluate(() => !!document.querySelector('[role=status], [aria-busy=true], .animate-pulse, .animate-spin'))
        return loading ? [] : ['no loading indicator while data is on its way']
      })
    await ctx.close()
  }
  if (MODES.includes('stale')) {
    const ctx = await context('light', false)
    // Vite serves each lazily loaded page as its own module (a hashed chunk after a build).
    const LAZY = /^\/src\/app\/(pages\/|analytics\/AnalyticsDashboard|reports\/ReportsPage|components\/shell\/SettingsPage)/
    await ctx.route((u) => LAZY.test(u.pathname), (r) => r.abort())
    for (const p of pages.filter(([id]) => id !== 'agents'))
      await check(ctx, 'stale', p, 1440, 'light', async (page) => {
        const reload = await page
          .getByRole('button', { name: 'Reload' })
          .waitFor({ timeout: 8000 })
          .then(() => true, () => false)
        return reload ? [] : ['no message and no way to reload when the page’s code fails to load']
      })
    await ctx.close()
  }
} finally {
  await browser?.close().catch(() => {})
  vite?.kill('SIGTERM')
  await stack?.stop()
}

writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => r.problems.length)
console.log(`\n${results.length} checks · ${results.length - failed.length} clean · ${failed.length} with problems (tests/ui/out/results.json, screenshots alongside)`)
process.exitCode = failed.length ? 1 : 0
