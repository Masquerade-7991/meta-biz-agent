import * as React from "react"
import { Table } from "./table"

// The plain `table.tsx` primitives with no card treatment of their own — this adds the
// rounded, bordered container every row-list in this product already wraps them in, so
// call sites stop hand-rolling `rounded-lg border border-border` around a table.
function TableExtended({ className, ...props }: React.ComponentProps<typeof Table>) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table className={className} {...props} />
    </div>
  )
}

export { TableExtended }
export {
  TableHeader as TableExtendedHeader,
  TableBody as TableExtendedBody,
  TableRow as TableExtendedRow,
  TableHead as TableExtendedHead,
  TableCell as TableExtendedCell,
} from "./table"
