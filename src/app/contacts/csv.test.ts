// Run: node --test src/app/contacts/csv.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, toCsv, toImportRows } from './csv.ts'

test('parses quotes, doubled quotes, newlines in cells, CRLF and BOM', () => {
  const t = parseCsv('﻿Name,Note\r\n"Rao, Asha","said ""hi""\nthen left"\r\n\r\nRahul,ok')
  assert.deepEqual(t, [
    ['Name', 'Note'],
    ['Rao, Asha', 'said "hi"\nthen left'],
    ['Rahul', 'ok'],
  ])
})

test('round-trips through toCsv', () => {
  const rows = [['a,b', 'c"d', 'e\nf'], ['1', '2', '3']]
  assert.deepEqual(parseCsv(toCsv(rows)), rows)
})

test('maps common headers and custom fields, ignores the rest', () => {
  const { rows, mapping } = toImportRows(parseCsv('Mobile Number,Full Name,Email,Tags,City,Notes\n+91 99000 00101,Priya,p@x.com,"vip, billing",Pune,skip me'), [{ key: 'city', label: 'City' }])
  assert.deepEqual(mapping, ['phone', 'name', 'email', 'tags', 'field:city', null])
  assert.deepEqual(rows[0], { phone: '+91 99000 00101', name: 'Priya', email: 'p@x.com', tags: 'vip, billing', fields: { city: 'Pune' } })
})
