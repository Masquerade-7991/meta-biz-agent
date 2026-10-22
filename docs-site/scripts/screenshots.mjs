// Console screenshots for the user guide, taken in Dummy mode (no API server needed).
// Usage: node docs-site/scripts/screenshots.mjs [shot,shot...]   (BASE_URL=http://localhost:5176 reuses a running Vite)
// Writes docs-site/public/screens/<name>.webp (or .png when sharp is missing).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, '../public/screens')
const PORT = 5176
const rootRequire = createRequire(path.join(ROOT, 'package.json'))
const { chromium } = rootRequire('playwright-core')
let sharp = null
for (const base of [path.join(ROOT, 'docs-site/package.json'), path.join(ROOT, 'package.json')]) {
  try { sharp = createRequire(base)('sharp'); break } catch { /* try next */ }
}

let vite = null
let APP = process.env.BASE_URL
if (!APP) {
  APP = `http://localhost:${PORT}`
  vite = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore',
  })
  for (let i = 0; i < 120 && !(await fetch(APP).catch(() => null))?.ok; i++) await new Promise((r) => setTimeout(r, 250))
}

const dialog = '[role=dialog]'
const click = (name) => async (p) => { await p.getByRole('button', { name }).first().click() }
const tab = (name) => async (p) => { await p.getByRole('tab', { name }).first().click() }
const openChat = (name) => async (p) => { await p.getByText(name, { exact: true }).first().click(); await p.getByRole('button', { name: /Take over|Hand back/ }).waitFor() }
const studio = (s) => [`/agents/studio/${s}`]
/** [name, url, prepare(page), clip selector or rect, viewport height] */
const SHOTS = [
  ['home', '/'],
  ['inbox', '/inbox', openChat('Priya Sharma')],
  ['inbox-takeover', '/inbox', openChat('Mohit Kapoor'), { x: 380, y: 44, width: 1060, height: 856 }],
  ['tickets', '/tickets'],
  ['ticket-sheet', '/tickets', async (p) => { await p.locator('tr.cursor-pointer').first().click(); await p.locator(dialog).waitFor() }],
  ['contacts', '/contacts'],
  ['contacts-import', '/contacts', click(/Import CSV/), dialog],
  ['template-new', '/whatsapp', async (p) => { await tab('Message templates')(p); await click(/^New template/)(p) }, dialog],
  ['analytics', '/analytics'],
  ['reports', '/reports'],
  ['whatsapp', '/whatsapp'],
  ['connect-number', '/whatsapp', click(/Connect a number/), dialog, 1150],
  ['whatsapp-account', '/whatsapp?tab=account'],
  ...['identity', 'knowledge', 'abilities', 'connections', 'safety', 'test', 'publish'].map((s) => [`studio-${s}`, ...studio(s)]),
  ['settings-home', '/settings'],
  ['settings-members', '/settings/members'],
  ['settings-routing', '/settings/routing'],
  ['settings-escalation', '/settings/escalation'],
  ['settings-hours', '/settings/support'],
  ['settings-activity', '/settings/activity'],
]

const only = process.argv[2]?.split(',')
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' })
await ctx.addInitScript(() => {
  try { localStorage.setItem('helo-theme', 'light'); localStorage.setItem('meta-agent-dummy-mode', '1') } catch { /* storage blocked */ }
})
try {
  // The studio needs an agent: make one once (Dummy mode keeps it in this context's localStorage).
  if (!only || only.some((n) => n.startsWith('studio'))) {
    const page = await ctx.newPage()
    await page.goto(APP + '/agents')
    await page.getByRole('button', { name: 'Create agent' }).first().click()
    await page.getByLabel('Agent name').fill('Helo Support')
    await page.getByRole('dialog').getByRole('combobox').click()
    await page.getByRole('option').first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Create agent' }).click()
    await page.waitForURL('**/agents/studio/**')
    await page.close()
  }
  for (const [name, url, prepare, clip, height = 900] of SHOTS) {
    if (only && !only.includes(name)) continue
    const page = await ctx.newPage()
    await page.setViewportSize({ width: 1440, height })
    try {
      await page.goto(APP + url, { waitUntil: 'domcontentloaded' })
      page.setDefaultTimeout(15_000)
      await page.locator('#root *').first().waitFor()
      await page.waitForFunction(() => !document.querySelector('[role=status] .wavy-loader'))
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(600)
      await prepare?.(page)
      if (prepare) await page.waitForFunction(() => !document.querySelector('[role=status] .wavy-loader'))
      await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { const r = b.getBoundingClientRect(); if (getComputedStyle(b.parentElement).position === 'fixed' || getComputedStyle(b).position === 'fixed' ? r.right > innerWidth - 100 && r.bottom > innerHeight - 100 : false) b.style.display = 'none' }))
      await page.waitForTimeout(600)
      const png = path.join(OUT, `${name}.png`)
      const opts = { path: png, animations: 'disabled' }
      if (clip && typeof clip === 'object') await page.screenshot({ ...opts, clip })
      else await (clip ? page.locator(clip).first() : page).screenshot(opts)
      if (sharp) { await sharp(png).webp({ quality: 80 }).toFile(png.replace('.png', '.webp')); fs.unlinkSync(png) }
      console.log('ok  ', name)
    } catch (e) {
      console.log('FAIL', name, String(e.message).split('\n')[0])
    }
    await page.close()
  }
} finally {
  await browser.close()
  vite?.kill()
}
