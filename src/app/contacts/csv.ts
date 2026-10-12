// CSV for contact import and export (RFC 4180: quotes, doubled quotes, newlines inside quotes).

/** Rows of cells; blank lines are dropped. Each row also carries (non-enumerable) `line`: the file
 *  line it starts on, so a skipped row can be named as in the file. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let start = 1
  const keep = (r: string[]) => {
    if (!r.some((x) => x.trim())) return
    Object.defineProperty(r, 'line', { value: start, enumerable: false })
    rows.push(r)
  }
  const s = text.replace(/^﻿/, '') // Excel's byte-order mark
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else {
        if (c === '\n' || (c === '\r' && s[i + 1] !== '\n')) line++
        cell += c
      }
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      keep(row)
      row = []
      cell = ''
      start = ++line
    } else cell += c
  }
  row.push(cell)
  keep(row)
  return rows
}

/** One CSV cell: quoted when it must be. A value starting with = + - @, a tab or a carriage return is
 *  prefixed with ' so a spreadsheet shows it as text instead of running it as a formula (customer
 *  names come from their WhatsApp profiles, which they control). Shared by every CSV the console writes. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  const formula = /^[=+\-@\t\r]/.test(s)
  return formula || /[",\r\n]/.test(s) ? `"${(formula ? "'" : '') + s.replace(/"/g, '""')}"` : s
}
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

export interface ImportRow {
  phone: string
  name?: string
  email?: string
  tags?: string
  fields: Record<string, string>
  /** The file line this row came from, for naming skipped rows. */
  line?: number
}
/** Headers compare by their letters and digits in any script (Hindi vowel signs are marks, so kept). */
const norm = (h: string) =>
  h
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
const PHONE = ['phone', 'phone number', 'mobile', 'mobile number', 'whatsapp', 'whatsapp number', 'number', 'contact number']
const NAME = ['name', 'full name', 'customer name', 'contact name']

/** Which column feeds which contact property. Headers match by name; unknown columns are ignored. */
export function mapColumns(header: string[], fields: { key: string; label: string }[]) {
  return header.map((h) => {
    const n = norm(h)
    // A blank header feeds nothing (it would match any field whose name normalises to nothing).
    if (!n) return null
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
    const line = (cells as string[] & { line?: number }).line
    const r: ImportRow = { phone: '', fields: {}, ...(line && { line }) }
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
