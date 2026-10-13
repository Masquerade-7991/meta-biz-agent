// Run: node --test server/record.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resourceOf, summarize } from './record.ts'
import { stripSecrets } from './store.ts'

test('audit summary of a connector body keeps no secret', () => {
  const body = {
    name: 'Orders API',
    base_url: 'https://orders.example.com',
    auth_type: 'API_KEY',
    auth_config: { api_key: { headers: [{ field_name: 'X-Key', value: 'sk_live_SECRET123' }] }, oauth2_client_credentials: { client_secret: 'cs_SECRET' } },
    token: 'tok_SECRET',
    password: 'pw_SECRET',
  }
  const s = summarize(body)
  assert.deepEqual(s, { name: 'Orders API', base_url: 'https://orders.example.com', auth_type: 'API_KEY' })
  assert.doesNotMatch(JSON.stringify(s), /SECRET/)
  assert.deepEqual(summarize({ handoff: { message_selection: 'AGENT', message: 'hi' } }), { 'handoff.message_selection': 'AGENT' })
})

test('resource names drop ids and the run verb', () => {
  assert.deepEqual(resourceOf('agent_connectors/42/tools/77/run'), { resource: 'agent_connectors/tools', resourceId: '77' })
  assert.deepEqual(resourceOf('agent_config/faq/id_3'), { resource: 'faq', resourceId: 'id_3' })
  assert.deepEqual(resourceOf('agent-eval/run'), { resource: 'agent-eval/run', resourceId: null })
})

test('drafts lose connector secrets', () => {
  const state = {
    connections: { connections: [{ name: 'A', apiKeys: [{ value: 'sk_SECRET', fieldName: 'X-Key' }], clientSecret: 'cs_SECRET' }] },
    connectors: { apiKey: 'k_SECRET', clientSecret: 'c_SECRET' },
    identity: { value: 'kept' },
  }
  const out = JSON.stringify(stripSecrets(state))
  assert.doesNotMatch(out, /SECRET/)
  assert.match(out, /"fieldName":"X-Key"/)
  assert.match(out, /"value":"kept"/)
})
