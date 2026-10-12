// Run: node --test src/app/contacts/csv.edges.test.ts
// Contact import parsing at the edges: empty files, odd quoting, unicode, and Excel's habits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapColumns, parseCsv, toCsv, toImportRows } from './csv.ts'

test('empty input, blank lines and whitespace-only rows give nothing', () => {
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('\n\r\n  \n'), [])
  assert.deepEqual(toImportRows([], []), { rows: [], mapping: [] })
})

test('a header with no rows maps but imports nothing', () => {
  const r = toImportRows(parseCsv('Phone,Name\n'), [])
  assert.deepEqual(r.mapping, ['phone', 'name'])
  assert.deepEqual(r.rows, [])
})

test('a trailing comma, a missing cell and a final line without newline all parse', () => {
  assert.deepEqual(parseCsv('a,b,\n1'), [['a', 'b', ''], ['1']])
  const { rows } = toImportRows(parseCsv('Phone,Name,Email\n919800000001'), [])
  assert.deepEqual(rows, [{ phone: '919800000001', fields: {}, line: 2 }])
})

test('an unterminated quote swallows the rest of the file into one cell rather than throwing', () => {
  assert.deepEqual(parseCsv('Name\n"Asha\nRahul'), [['Name'], ['Asha\nRahul']])
})

test('unicode, emoji and right-to-left names survive import', () => {
  const { rows } = toImportRows(parseCsv('Phone,Name,City\n+91 98000 00001,प्रिया शर्मा 🌸,मुंबई\n+971 50 000 0001,محمد العلي,دبي'), [{ key: 'city', label: 'City' }])
  assert.deepEqual(rows.map((r) => r.name), ['प्रिया शर्मा 🌸', 'محمد العلي'])
  assert.equal(rows[1].fields.city, 'دبي')
})

test('headers match whatever their case, spacing and punctuation', () => {
  assert.deepEqual(mapColumns(['  PHONE ', 'WhatsApp-Number', 'E-mail', 'e mail', 'Email Address', 'LABELS', 'Customer_Name'], []), ['phone', 'phone', null, null, 'email', 'tags', 'name'])
})

test('a custom field matches by its key as well as its label', () => {
  assert.deepEqual(mapColumns(['loyalty_tier', 'Loyalty tier'], [{ key: 'loyalty_tier', label: 'Loyalty tier' }]), ['field:loyalty_tier', 'field:loyalty_tier'])
})

test('values are trimmed; a cell of spaces does not overwrite anything', () => {
  const { rows } = toImportRows(parseCsv('Phone,Name\n  919800000001  ,   '), [])
  assert.deepEqual(rows[0], { phone: '919800000001', fields: {}, line: 2 })
})

test('two phone columns: the last non-empty one wins (documented)', () => {
  const { rows } = toImportRows(parseCsv('Phone,Mobile\n111,222\n333,'), [])
  assert.deepEqual(rows.map((r) => r.phone), ['222', '333'])
})

test('non-Latin headers map to their own field, never to another non-Latin field', () => {
  // A Hindi label gets the key "field" on the server (contacts.ts slugs keys to a-z0-9), so one such field exists.
  const fields = [{ key: 'field', label: 'शहर' }]
  assert.deepEqual(mapColumns(['Phone', 'उम्र', '', 'शहर'], fields), ['phone', null, null, 'field:field'])
})

test('semicolon-separated files (European Excel) are not split', () => {
  // Documents today's behaviour: everything lands in one column, so no phone column is found.
  assert.deepEqual(toImportRows(parseCsv('Phone;Name\n919800000001;Asha'), []).mapping, [null])
})

test('a 10,000-row file parses in well under a second', () => {
  const big = 'Phone,Name\n' + Array.from({ length: 10_000 }, (_, i) => `9198${String(i).padStart(8, '0')},"Name, ${i}"`).join('\n')
  const t = Date.now()
  const { rows } = toImportRows(parseCsv(big), [])
  assert.equal(rows.length, 10_000)
  assert.equal(rows[9_999].name, 'Name, 9999')
  assert.ok(Date.now() - t < 1000)
})

test('export never lets a cell run as a spreadsheet formula', () => {
  const csv = toCsv([['=HYPERLINK("http://x","click")', '@SUM(1)', '-1+1', '+cmd']])
  for (const cell of csv.trim().split(',')) assert.doesNotMatch(cell, /^"?[=+\-@]/)
})

test('each row knows its line in the file, past blank lines and multi-line cells', () => {
  const { rows } = toImportRows(parseCsv('Phone,Note\r\n\r\n911,"two\nlines"\n\n912,x'), [])
  assert.deepEqual(rows.map((r) => r.line), [3, 6])
})
