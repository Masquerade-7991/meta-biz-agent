// CSV for contact import and export (RFC 4180: quotes, doubled quotes, newlines inside quotes).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '') // Excel's byte-order mark
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  return rows
}

const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'

export interface ImportRow {
  phone: string
  name?: string
  email?: string
  tags?: string
  fields: Record<string, string>
}
const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const PHONE = ['phone', 'phone number', 'mobile', 'mobile number', 'whatsapp', 'whatsapp number', 'number', 'contact number']
const NAME = ['name', 'full name', 'customer name', 'contact name']

/** Which column feeds which contact property. Headers match by name; unknown columns are ignored. */
export function mapColumns(header: string[], fields: { key: string; label: string }[]) {
  return header.map((h) => {
    const n = norm(h)
    if (PHONE.includes(n)) return 'phone'
    if (NAME.includes(n)) return 'name'
    if (n === 'email' || n === 'email address') return 'email'
    if (n === 'tags' || n === 'labels') return 'tags'
    const f = fields.find((x) => norm(x.label) === n || norm(x.key) === n)
    return f ? `field:${f.key}` : null
  })
}

export function toImportRows(table: string[][], fields: { key: string; label: string }[]): { rows: ImportRow[]; mapping: (string | null)[] } {
  const [header = [], ...body] = table
  const mapping = mapColumns(header, fields)
  const rows = body.map((cells) => {
    const r: ImportRow = { phone: '', fields: {} }
    mapping.forEach((m, i) => {
      const v = (cells[i] ?? '').trim()
      if (!m || !v) return
      if (m.startsWith('field:')) r.fields[m.slice(6)] = v
      else r[m as 'phone' | 'name' | 'email' | 'tags'] = v
    })
    return r
  })
  return { rows, mapping }
}
