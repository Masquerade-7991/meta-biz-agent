// Every MongoDB collection has one owning domain; other domains reach it through that domain's
// functions, not by name. Uses outside the owner that exist today are listed in SHARED (the debt
// to pay down); a new one fails here. Keeping this true is what makes a future service extraction cheap.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SERVER = import.meta.dirname
const OWNER: Record<string, string> = {
  platform: 'jobs events api_calls audit_log alerts request_locks relay_cache rate_hits locks schema_meta',
  identity: 'users workspaces memberships sessions magic_links invites api_tokens',
  whatsapp: 'whatsapp_accounts phone_numbers number_health webhook_baseline billing spend_daily agents agent_drafts agent_events eval_runs test_conversations',
  messaging: 'conversations messages webhook_inbox whatsapp_webhooks message_charges presence canned_responses reminders saved_views conversation_traces',
  support: 'tickets counters teams routing_rules escalation_policies support_settings contacts contact_fields segments',
  insights: 'metrics_daily agent_usage agent_usage_state ai_usage report_schedules connector_logs connector_stats handoff_snapshots',
}
/** Collection → domains besides the owner that still name it directly. Shrink, never grow. */
const SHARED: Record<string, string[]> = {
  agents: ['insights'],
  agent_events: ['insights'],
  api_calls: ['whatsapp'],
  audit_log: ['whatsapp'],
  billing: ['insights'],
  contacts: ['insights', 'messaging', 'whatsapp'],
  conversation_traces: ['insights', 'whatsapp'],
  counters: [],
  events: ['insights', 'whatsapp'],
  handoff_snapshots: ['whatsapp'],
  jobs: ['insights', 'whatsapp'],
  memberships: ['insights', 'messaging', 'platform', 'support'],
  message_charges: ['insights', 'whatsapp'],
  messages: ['insights', 'support'],
  spend_daily: ['insights'],
  teams: ['insights', 'messaging'],
  test_conversations: ['messaging'],
  tickets: ['insights', 'messaging'],
  users: ['insights', 'platform', 'support', 'whatsapp'],
  webhook_inbox: ['whatsapp'],
  whatsapp_webhooks: ['whatsapp'],
  workspaces: ['insights', 'platform', 'whatsapp'],
}

const owner = new Map<string, string>()
for (const [d, names] of Object.entries(OWNER)) for (const n of names.split(' ')) owner.set(n, d)

const uses = new Map<string, Set<string>>()
for (const d of Object.keys(OWNER)) {
  const dir = path.join(SERVER, d)
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'index.ts') continue
    const src = readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/\b(?:col|collection)(?:<[^>]*>)?\(\s*'([a-z_]+)'\s*\)/g)) {
      if (!uses.has(m[1])) uses.set(m[1], new Set())
      uses.get(m[1])!.add(d)
    }
  }
}

test('every collection the code names has an owner', () => {
  const unowned = [...uses.keys()].filter((n) => !owner.has(n) && statSync(path.join(SERVER, 'platform')).isDirectory())
  assert.deepEqual(unowned, [], 'add these to OWNER in server/ownership.test.ts')
})

test('collections are only named outside their owning domain where already allowed', () => {
  const grown: string[] = []
  const shrunk: string[] = []
  for (const [name, domains] of uses) {
    const o = owner.get(name)
    if (!o) continue
    const others = [...domains].filter((d) => d !== o).sort()
    const allowed = SHARED[name] ?? []
    for (const d of others) if (!allowed.includes(d)) grown.push(`${name}: ${d} (owner ${o})`)
    for (const d of allowed) if (!others.includes(d)) shrunk.push(`${name}: ${d}`)
  }
  assert.deepEqual(grown, [], 'a new domain names a collection it does not own; go through the owner’s functions')
  assert.deepEqual(shrunk, [], 'good: a shared use is gone; remove it from SHARED so it stays gone')
})
