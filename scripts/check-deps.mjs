// Module boundaries for server/: every folder under server/ is a domain whose public surface is its
// index.ts. Checks (npm run lint:deps):
//   1. a module of one domain imports another domain only through that domain's index.ts, except
//      platform, the foundation, whose modules are imported directly (an index there puts every
//      module behind one hub, and a top-level call such as addProtected() or defineJob() then runs
//      while the hub is half-evaluated); type-only imports, tests and the composition root
//      (server/*.ts, server/openapi) are free;
//   2. no new dependency cycles between domains. The cycles that exist today are listed in KNOWN_CYCLES;
//      that list may only shrink (breaking one: remove it here).
// Exit 1 with the offending imports, so the boundary can't erode quietly.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SERVER = path.join(ROOT, 'server')
const DOMAINS = readdirSync(SERVER).filter((d) => statSync(path.join(SERVER, d)).isDirectory() && d !== 'openapi')

/** Domain pairs that depend on each other today (a → b and b → a). Shrink it; never grow it. */
const KNOWN_CYCLES = new Set([
  'platform↔whatsapp', // jobs → assetsFor, db → migrateEnvAccount; whatsapp → db/context/http
  'messaging↔support', // inbox ↔ tickets: a reply opens a ticket, a release resolves it
  'messaging↔outreach', // inbox ↔ broadcasts: delivery ticks land on recipients
  'insights↔messaging', // collectors → importTurns; inbox/assist → aiUsage
  'insights↔whatsapp', // analytics/collectors → accounts/record/upstream; billing/store → aiUsage/collectors
])

const files = []
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.ts')) files.push(p)
  }
}
walk(SERVER)

const domainOf = (file) => {
  const rel = path.relative(SERVER, file).split(path.sep)
  return rel.length > 1 && DOMAINS.includes(rel[0]) ? rel[0] : null
}
const IMPORT = /^(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm

const deep = []
const edges = new Map() // 'a→b' -> [importing files]
for (const f of files) {
  const from = domainOf(f)
  if (!from || f.endsWith('.test.ts')) continue
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(IMPORT)) {
    if (m[2]) continue // type-only: no runtime dependency
    const target = path.resolve(path.dirname(f), m[3])
    const to = domainOf(target)
    if (!to || to === from) continue
    if (to !== 'platform' && path.basename(target) !== 'index.ts') deep.push(`${path.relative(ROOT, f)} imports ${path.relative(ROOT, target)} (use server/${to}/index.ts)`)
    const k = `${from}→${to}`
    if (!edges.has(k)) edges.set(k, [])
    edges.get(k).push(path.relative(ROOT, f))
  }
}

const cycles = []
for (const k of edges.keys()) {
  const [a, b] = k.split('→')
  if (a < b && edges.has(`${b}→${a}`)) cycles.push(`${a}↔${b}`)
}
const newCycles = cycles.filter((c) => !KNOWN_CYCLES.has(c))
const gone = [...KNOWN_CYCLES].filter((c) => !cycles.includes(c))

let bad = 0
if (deep.length) {
  console.log('Cross-domain imports that skip the index:')
  for (const d of deep) console.log('  ' + d)
  bad += deep.length
}
if (newCycles.length) {
  console.log('New dependency cycles between domains (break them, or import through an event):')
  for (const c of newCycles) console.log(`  ${c}: ${edges.get(c.replace('↔', '→')).join(', ')} / ${edges.get(c.split('↔').reverse().join('→')).join(', ')}`)
  bad += newCycles.length
}
if (gone.length) {
  console.log(`Cycles no longer present (remove from KNOWN_CYCLES in scripts/check-deps.mjs): ${gone.join(', ')}`)
  bad += gone.length
}
console.log(`${DOMAINS.length} domains, ${edges.size} cross-domain edges, ${cycles.length} cycles (${KNOWN_CYCLES.size} known)${bad ? '' : ': boundaries hold.'}`)
process.exit(bad ? 1 : 0)
