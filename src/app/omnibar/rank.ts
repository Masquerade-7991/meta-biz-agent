// The omnibar's own ranking (no fuzzy library): every typed word has to appear in the row's label
// or keywords (the hint is only shown: a section's hint is its tab, which would match every row);
// rows whose label starts with what was typed come first, then a word in the label that starts
// with it, then the label containing it, then anything matching only on keywords.

interface Rankable {
  label: string
  hint?: string
  keywords?: string
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim()

export function score(row: Rankable, query: string): number {
  const q = norm(query)
  if (!q) return 1
  const label = norm(row.label)
  const all = `${label} ${norm(row.keywords ?? '')}`
  if (!q.split(/\s+/).every((w) => all.includes(w))) return 0
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.split(/[\s›/·,-]+/).some((w) => w.startsWith(q))) return 60
  if (label.includes(q)) return 40
  return 10
}

/** The best `limit` rows for the query, best first; equal scores keep the given order. */
export function rank<T extends Rankable>(rows: T[], query: string, limit: number): T[] {
  return rows
    .map((row, i) => ({ row, i, s: score(row, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.row)
}

/** For pages that filter a list in the browser: every typed word appears in one of the fields. */
export const matchesText = (query: string, ...fields: (string | null | undefined)[]) => score({ label: fields.filter(Boolean).join(' ') }, query) > 0
