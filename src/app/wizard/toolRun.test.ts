import assert from 'node:assert/strict'
import test from 'node:test'
import { readToolRun } from './toolRun.ts'

const run = (status: object, body: object) => JSON.stringify({ status, body: JSON.stringify(body) })

test('a finished run with a 2xx answer is a success and shows the reply data', () => {
  const r = readToolRun('success', run({ code: 1 }, { output: { status: 200, data: { products: [1] } } }))
  assert.equal(r.ok, true)
  assert.deepEqual(JSON.parse(r.body), { products: [1] })
})

test('code 2 with a failure_code is a failure, even when Meta says success', () => {
  const r = readToolRun('success', run({ code: 2, failure_code: 20 }, { message: 'Credentials refresh didn’t work' }))
  assert.equal(r.ok, false)
  assert.equal(r.body, 'Credentials refresh didn’t work')
})

test('a finished run whose system answered 4xx is a failure', () => {
  assert.equal(readToolRun('success', run({ code: 1 }, { output: { status: 401, data: { errors: 'x' } } })).ok, false)
})

test("Meta's documented shape still works", () => {
  assert.equal(readToolRun('success', '{"order_id":"1"}').ok, true)
  assert.equal(readToolRun('error', '{"error_message":"Order not found"}').ok, false)
})
