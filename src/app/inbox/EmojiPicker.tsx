import { Smile } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'

// The emoji support teams reach for most; the OS picker (⌃⌘Space, Win + .) has the rest.
const GROUPS: { label: string; emoji: string }[] = [
  { label: 'Smileys', emoji: '😀 😊 🙂 😉 😍 🥰 😄 😅 😂 🤗 🤔 😇 😎 🥳 😢 😔 🙏 👍 👎 👌 👏 🙌 💪 🤝' },
  { label: 'Hearts and marks', emoji: '❤️ 🧡 💛 💚 💙 💜 ✅ ❌ ⚠️ ❗ ❓ ⭐ 🌟 ✨ 🔥 🎉 🎁 💯' },
  { label: 'Things', emoji: '📦 🚚 🛒 💳 💰 🧾 📅 ⏰ 📍 📞 ✉️ 📎 🔗 🔒 🛠️ 💡 📣 🏷️' },
]

/** A small emoji palette for the composer; `onPick` inserts at the cursor. */
export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={disabled} aria-label="Insert emoji">
          <Smile className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="mb-1 text-muted-foreground text-xs">
              {g.label}
            </p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.emoji.split(' ').map((e) => (
                <button key={e} type="button" className="rounded p-1 text-lg leading-none hover:bg-muted" onClick={() => onPick(e)} aria-label={`Insert ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-muted-foreground text-xs">
          More: press ⌃⌘Space on a Mac, or Windows + . on a PC.
        </p>
      </PopoverContent>
    </Popover>
  )
}
