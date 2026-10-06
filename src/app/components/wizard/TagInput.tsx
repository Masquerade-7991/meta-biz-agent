import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  /** The input's placeholder clears once chips exist, so this is the only way to keep it
   *  reachable by assistive tech (and by tests) once the list isn't empty. */
  'aria-label'?: string
}

export function TagInput({ values, onChange, placeholder = 'Type and press Enter', 'aria-label': ariaLabel }: TagInputProps) {
  const [draft, setDraft] = useState('')

  function commit() {
    const value = draft.trim()
    if (!value) return
    if (!values.includes(value)) onChange([...values, value])
    setDraft('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && draft.length === 0 && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="badge flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-accent-foreground"
        >
          {value}
          <button type="button" onClick={() => onChange(values.filter((v) => v !== value))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
        className="min-w-24 flex-1 bg-transparent outline-none text-sm"
      />
    </div>
  )
}
