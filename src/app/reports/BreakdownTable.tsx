import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import { cn } from '@/app/lib/utils'
import { cellValue, changes, colLabel, formatCell, rollUp, sortRows, totalRow, type Breakdown, type Col, type Grain, type Row } from './summary'

const isNum = (c: Col) => c.kind !== 'text' && c.kind !== 'period'
const signed = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 100))}%`)
const TOTAL_TITLE: Partial<Record<string, string>> = { rate: 'Weighted by volume', minutes: 'The median for the whole period' }

/**
 * A summary's table: click a header to sort (again to reverse), a Total row pinned at the bottom
 * (sums for counts, weighted rates, the period's medians), and for tables by time the grain and a
 * Change column against the row before. The header sticks inside the table's own scroll area.
 * `print`: no scroll area, no sorting.
 */
export function BreakdownTable({ b, currency, grain = 'day', print }: { b: Breakdown; currency: string | null; grain?: Grain; print?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const columns = b.columns
  const rows = useMemo(() => {
    const base = b.byTime ? rollUp(b.rows, columns, grain) : b.rows
    const by = b.changeKey ? columns.find((c) => c.key === b.changeKey) : undefined
    const ch = by ? changes(base, by) : []
    const withChange: Row[] = base.map((r, i) => ({ ...r, _change: ch[i] ?? null }))
    const col = sort && (sort.key === '_change' ? CHANGE : columns.find((c) => c.key === sort.key))
    return col ? sortRows(withChange, col, sort.dir) : withChange
  }, [b, columns, grain, sort])
  const total = useMemo(() => totalRow(b), [b])
  const showChange = !!(b.byTime && b.changeKey)
  const all = showChange ? [...columns, CHANGE] : columns

  if (!b.rows.length) return <p className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">Nothing in this period. Try a longer date range.</p>
  const click = (c: Col) => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: isNum(c) ? 'desc' : 'asc' }))
  const show = (r: Row, c: Col) => (c === CHANGE ? signed(r._change as number | null) : formatCell(cellValue(r, c), c, currency, grain))

  return (
    <div className={cn('rounded-lg border border-border bg-card', print ? 'text-xs' : 'max-h-[70vh] overflow-auto')}>
      <table className="w-full caption-bottom text-sm">
        <TableHeader className={cn(!print && 'sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]')}>
          <TableRow className="hover:bg-transparent">
            {all.map((c) => {
              const on = sort?.key === c.key ? sort.dir : null
              const Icon = on === 'asc' ? ArrowUp : on === 'desc' ? ArrowDown : ArrowUpDown
              return (
                <TableHead key={c.key} className={cn('whitespace-nowrap', isNum(c) && 'text-right')} aria-sort={on ? (on === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {print ? (
                    colLabel(c, grain)
                  ) : (
                    <button type="button" onClick={() => click(c)} className={cn('group inline-flex items-center gap-1 hover:text-foreground', isNum(c) && 'flex-row-reverse')}>
                      {colLabel(c, grain)}
                      <Icon className={cn('size-3.5', !on && 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60')} aria-hidden />
                    </button>
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={String(r[columns[0].key] ?? i)} data-density-row>
              {all.map((c, j) => (
                <TableCell key={c.key} className={cn('whitespace-nowrap', isNum(c) && 'text-right tabular-nums', !j && 'font-medium')}>
                  {show(r, c)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {rows.length > 1 && (
          <TableFooter className={cn('bg-card', !print && 'sticky bottom-0 shadow-[inset_0_1px_0_var(--border)]')}>
            <TableRow className="hover:bg-transparent">
              {all.map((c, j) => (
                <TableCell key={c.key} className={cn('whitespace-nowrap font-semibold', isNum(c) && 'text-right tabular-nums')} title={j ? TOTAL_TITLE[c.kind] : undefined}>
                  {!j ? 'Total' : c === CHANGE || !isNum(c) ? '' : show(total, c)}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </table>
    </div>
  )
}

const CHANGE: Col = { key: '_change', label: 'Change', kind: 'count' }
