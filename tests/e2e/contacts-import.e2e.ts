// Journey: contact fields, a CSV import exactly as the browser sends it (parsed by
// src/app/contacts/csv.ts), segments, editing, and deleting someone with their history.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { inbound, startStack, type Stack } from './harness.ts'
import { parseCsv, toImportRows } from '../../src/app/contacts/csv.ts'

let s: Stack
let w: Awaited<ReturnType<Stack['seed']['workspace']>>
before(async () => {
  s = await startStack('contacts')
  w = await s.seed.workspace()
})
after(() => s?.stop())

const contact = (phone: string) => s.db.collection('contacts').findOne({ workspaceId: w.id, phone })

test('custom fields: admins define them, names that slug the same are refused', async () => {
  const fields = [
    { label: 'City', type: 'text' },
    { label: 'Tier', type: 'select', options: 'gold, silver' },
    { label: 'Orders', type: 'number' },
  ]
  assert.equal((await s.api(w.supervisor, 'PUT', '/api/contacts/fields', { fields })).status, 403)
  const r = await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json.map((f: { key: string }) => f.key), ['city', 'tier', 'orders'])
  assert.equal((await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: [{ label: 'Tier' }, { label: 'tier!' }] })).status, 400)
})

test('a second field with a non-Latin name can be added', async () => {
  const r = await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: [{ label: 'City' }, { label: 'शहर' }, { label: 'उम्र' }] })
  assert.equal(r.status, 200, r.text)
  await s.api(w.admin, 'PUT', '/api/contacts/fields', { fields: [{ label: 'City', type: 'text' }, { label: 'Tier', type: 'select', options: 'gold, silver' }, { label: 'Orders', type: 'number' }] })
})

test('import: adds, updates, skips with reasons, and keeps unicode', async () => {
  await s.api(w.owner, 'POST', '/api/contacts', { phone: '+91 98500 00002', name: 'Old Name', tags: ['existing'] })
  const csv = [
    'Mobile Number,Full Name,Email,Tags,City,Tier,Orders',
    '+91 98500 00001,प्रिया शर्मा 🌸,priya@example.com,"VIP, Diwali",मुंबई,gold,3',
    '+91 98500 00002,Rahul Updated,,returning,Pune,,',
    'not a phone,Nobody,,,,,',
    '+971 50 000 0001,محمد العلي,,,دبي,silver,',
    '+44 20 7946 0000,Pat,,,,platinum,',
    '+1 202 555 0100,Sam,,,,,many',
    '+91 98500 00001,प्रिया (dup),,,,,',
  ].join('\r\n')
  const fields = (await s.api(w.owner, 'GET', '/api/contacts/fields')).json
  const { rows, mapping } = toImportRows(parseCsv(csv), fields)
  assert.deepEqual(mapping, ['phone', 'name', 'email', 'tags', 'field:city', 'field:tier', 'field:orders'])
  assert.equal((await s.api(w.agent, 'POST', '/api/contacts/import', { rows })).status, 403)
  const r = await s.api(w.supervisor, 'POST', '/api/contacts/import', { rows, tags: ['Imported Oct'] })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual([r.json.added, r.json.updated, r.json.skippedCount], [2, 2, 3])
  assert.deepEqual(
    r.json.skipped.map((x: { row: number }) => x.row),
    [4, 6, 7],
    'rows are numbered as in the file (header is row 1)',
  )
  assert.match(r.json.skipped[1].reason, /Tier must be one of: gold, silver/)
  assert.match(r.json.skipped[2].reason, /Orders must be a number/)
  const priya = (await contact('919850000001'))!
  assert.equal(priya.name, 'प्रिया (dup)', 'a later row for the same number wins')
  assert.deepEqual(priya.tags.sort(), ['diwali', 'imported oct', 'vip'])
  assert.equal(priya.fields.city, 'मुंबई')
  const rahul = (await contact('919850000002'))!
  assert.equal(rahul.name, 'Rahul Updated')
  assert.deepEqual(rahul.tags.sort(), ['existing', 'imported oct', 'returning'], 'import adds tags, never removes')
})

test('import: skipped rows are numbered as in the file even with blank lines', async () => {
  const { rows } = toImportRows(parseCsv('Phone,Name\n\n\nbad,X'), [])
  const r = await s.api(w.owner, 'POST', '/api/contacts/import', { rows })
  assert.equal(r.json.skipped[0].row, 4)
})

test('import: a 10-digit number without a country code is not taken as international', async () => {
  const r = await s.api(w.owner, 'POST', '/api/contacts/import', { rows: [{ phone: '9850000003', fields: {} }] })
  assert.equal(r.json.added, 0)
})

test('import: an empty or oversized payload is handled', async () => {
  const empty = await s.api(w.owner, 'POST', '/api/contacts/import', { rows: [] })
  assert.deepEqual([empty.json.added, empty.json.updated, empty.json.skippedCount], [0, 0, 0])
  assert.equal((await s.api(w.owner, 'POST', '/api/contacts/import', { rows: 'nope' })).json.added, 0)
})

test('segments count by tag and leave out people who opted out', async () => {
  await s.api(w.owner, 'PUT', '/api/contacts/919850000002', { name: 'Rahul Updated', tags: ['returning', 'imported oct'], optedOut: true })
  const r = await s.api(w.supervisor, 'POST', '/api/contacts/segments', { name: 'Imported', filter: { tags: ['Imported Oct'] } })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.json.count, 2, 'Priya and the UAE contact; Rahul opted out')
  assert.equal((await s.api(w.agent, 'POST', '/api/contacts/segments', { name: 'x', filter: {} })).status, 403)
  const listed = await s.api(w.agent, 'GET', `/api/contacts?segment=${r.json.id}`)
  assert.equal(listed.json.length, 2)
  assert.equal((await s.api(w.agent, 'GET', '/api/contacts?segment=000000000000000000000000')).status, 404)
})

test('search finds names in any script, emails and phone digits', async () => {
  const q = async (x: string) => (await s.api(w.agent, 'GET', `/api/contacts?q=${encodeURIComponent(x)}`)).json.map((c: { phone: string }) => c.phone)
  assert.deepEqual(await q('प्रिया'), ['919850000001'])
  assert.deepEqual(await q('العلي'), ['971500000001'])
  assert.deepEqual(await q('PRIYA@EXAMPLE'), ['919850000001'])
  assert.deepEqual(await q('98500 00001'), ['919850000001'])
  assert.deepEqual(await q('.*'), [], 'regex characters are literal')
})

test('editing validates email and field types; a missing contact is 404', async () => {
  assert.equal((await s.api(w.agent, 'PUT', '/api/contacts/919850000001', { name: 'P', email: 'not-an-email' })).status, 400)
  assert.equal((await s.api(w.agent, 'PUT', '/api/contacts/919850000001', { name: 'P', fields: { orders: 'lots' } })).status, 400)
  assert.equal((await s.api(w.agent, 'PUT', '/api/contacts/919899999999', { name: 'P' })).status, 404)
  assert.equal((await s.api(w.agent, 'POST', '/api/contacts', { phone: '+91 98500 00001' })).status, 409)
})

test('a stale edit form does not re-subscribe someone who opted out meanwhile', async () => {
  await s.webhook(inbound(w.numbers[0], '919850000001', 'STOP'))
  assert.equal((await contact('919850000001'))!.optedOut, true)
  // The edit sheet was opened before STOP arrived: it still holds optedOut false.
  await s.api(w.agent, 'PUT', '/api/contacts/919850000001', { name: 'Priya S', email: 'priya@example.com', tags: ['vip'], fields: {}, optedOut: false })
  assert.equal((await contact('919850000001'))!.optedOut, true)
})

test('deleting a contact removes their chat, messages and tickets; agents can’t', async () => {
  await s.webhook(inbound(w.numbers[0], '919850000004', 'delete me later'))
  assert.ok(await s.db.collection('messages').findOne({ phone: '919850000004' }))
  assert.equal((await s.api(w.agent, 'DELETE', '/api/contacts/919850000004')).status, 403)
  assert.equal((await s.api(w.supervisor, 'DELETE', '/api/contacts/919850000004')).status, 200)
  for (const c of ['contacts', 'conversations', 'messages', 'tickets']) assert.equal(await s.db.collection(c).countDocuments({ phone: '919850000004' }), 0, c)
})
