import { useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/app/components/ui/command'
import { cn } from '@/app/lib/utils'

/** Searchable single-select combobox, e.g. for "Default language". */
export function LanguageSelect({
  options,
  value,
  onChange,
  placeholder = 'Select a language',
}: {
  options: string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {value || placeholder}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: 'var(--radix-popover-trigger-width)' }} align="start">
        <Command>
          <CommandInput placeholder="Search languages..." />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value === option ? 'opacity-100' : 'opacity-0')} />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Searchable multi-select combobox with removable chips, e.g. for "Additional languages". */
export function LanguageMultiSelect({
  options,
  selected,
  onToggle,
  disabled,
  triggerLabel = 'Add a language',
}: {
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  disabled?: boolean
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {triggerLabel}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" style={{ width: 'var(--radix-popover-trigger-width)' }} align="start">
          <Command>
            <CommandInput placeholder="Search languages..." />
            <CommandList>
              <CommandEmpty>No language found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem key={option} value={option} onSelect={() => onToggle(option)}>
                    <Check className={cn('size-4', selected.includes(option) ? 'opacity-100' : 'opacity-0')} />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', disabled && 'opacity-50')}>
          {selected.map((lang) => (
            <span
              key={lang}
              className="badge flex items-center gap-1 rounded-full border border-primary bg-accent px-3 py-1.5 text-accent-foreground"
            >
              {lang}
              <button type="button" disabled={disabled} onClick={() => onToggle(lang)} aria-label={`Remove ${lang}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
