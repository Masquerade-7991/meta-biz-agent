import { useState } from 'react'

/** Which field errors show: a field's own once it has been left, or every one after Save was pressed. */
export function useTouched() {
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [all, setAll] = useState(false)
  return {
    shows: (field: string) => all || touched.has(field),
    touch: (field: string) => setTouched((t) => (t.has(field) ? t : new Set(t).add(field))),
    showAll: () => setAll(true),
    all,
  }
}
