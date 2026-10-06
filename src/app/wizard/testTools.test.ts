import assert from 'node:assert/strict'
import test from 'node:test'
import { findToolCalls, isMetaFallback, readableName, toolCallsSince } from './testTools.ts'

const turn = (timestamp: number, tool?: string) => ({
  turn_id: String(timestamp),
  conversation_id: 'x',
  timestamp,
  steps: [...(tool ? [{ type: 'TOOL_CALL' as const, status: 'SUCCESS' as const, tool_name: tool, latency_ms: 2045 }] : []), { type: 'LLM_CALL' as const, status: 'SUCCESS' as const }],
})

test('takes the newest turn after the message, and names the tool and its connection', () => {
  const calls = toolCallsSince([turn(1_000, 'integration_1_Old__old_tool'), turn(10_000, 'integration_126711280073588_Shopify_store__Search_products')], 9_500)
  assert.deepEqual(calls, [{ tool: 'Search_products', connector: 'Shopify_store', status: 'SUCCESS', ms: 2045, input: undefined, output: undefined }])
})

test('a reply that used no tool reads as an empty list; a turn not there yet as null', () => {
  assert.deepEqual(toolCallsSince([turn(10_000)], 9_500), [])
  assert.equal(toolCallsSince([turn(1_000, 'a')], 9_500), null)
})

test('keeps checking until the turn shows up', async () => {
  let n = 0
  const calls = await findToolCalls(async () => (++n < 3 ? [] : [turn(5_000, 'integration_1_S__t')]), 5_000, [1, 1, 1, 1])
  assert.equal(n, 3)
  assert.equal(calls?.[0].tool, 't')
})

test('recognises Meta’s fallback reply, and only that', () => {
  assert.equal(isMetaFallback('I had trouble responding fully — could you rephrase or add more details?'), true)
  assert.equal(isMetaFallback('Email support@helo.ai or call 022 6785 6785.'), false)
})

test('names tools and connections the way people read them', () => {
  assert.equal(readableName('search_products'), 'Search products')
  assert.equal(readableName('Shopify_store'), 'Shopify store')
  assert.equal(readableName('lookUpOrder'), 'Look Up Order')
})
