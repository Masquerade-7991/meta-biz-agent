// A load smoke, not a benchmark: the e2e harness (throwaway database, fake Meta), then 50 webhook
// deliveries and 200 inbox reads in flight at once. Prints p50/p95 and the error count, so a change
// to the server's plumbing can be compared with the run before it. Usage: node tests/load/run.ts
import { inbound, startStack } from '../e2e/harness.ts'

const s = await startStack('load')
const w = await s.seed.workspace()
const NUM = w.numbers[0]

const timed = async <T>(fn: () => Promise<T>) => {
  const t = performance.now()
  const r = await fn()
  return { ms: performance.now() - t, r }
}
const report = (name: string, rows: { ms: number; ok: boolean }[]) => {
  const ms = rows.map((r) => r.ms).sort((x, y) => x - y)
  const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(ms.length * p))])
  console.log(`${name.padEnd(28)} n=${rows.length}  p50=${q(0.5)}ms  p95=${q(0.95)}ms  max=${q(1)}ms  errors=${rows.filter((r) => !r.ok).length}`)
}

try {
  // Warm up: one of each, so cold caches don't count.
  await s.webhook(inbound(NUM, '919890000000', 'warm'))
  await s.api(w.owner, 'GET', '/api/inbox/conversations')

  const hooks = await Promise.all(Array.from({ length: 50 }, (_, i) => timed(() => s.webhook(inbound(NUM, `9198900${String(i).padStart(5, '0')}`, `load ${i}`)))))
  report('50 webhooks at once', hooks.map((h) => ({ ms: h.ms, ok: h.r.status === 200 })))

  const reads = await Promise.all(Array.from({ length: 200 }, () => timed(() => s.api(w.owner, 'GET', '/api/inbox/conversations'))))
  report('200 inbox reads at once', reads.map((h) => ({ ms: h.ms, ok: h.r.status === 200 && Array.isArray(h.r.json) })))

  const mixed = await Promise.all([
    ...Array.from({ length: 100 }, () => timed(() => s.api(w.agent, 'GET', '/api/tickets'))),
    ...Array.from({ length: 100 }, () => timed(() => s.api(w.owner, 'GET', '/api/analytics/overview?range=7d'))),
  ])
  report('100 tickets + 100 overview', mixed.map((h) => ({ ms: h.ms, ok: h.r.status === 200 })))
} finally {
  await s.stop()
}
