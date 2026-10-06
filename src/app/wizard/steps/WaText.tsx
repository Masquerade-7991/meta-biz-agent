import type { ReactNode } from 'react'

// Message text the way WhatsApp shows it: *bold*, _italic_, ~strike~, `code`, ```blocks```,
// and "- " / "* " list lines as bullets. Agents write WhatsApp formatting, so the test phone
// should render it instead of showing the asterisks.

const INLINE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`
    const inner = part.slice(1, -1)
    // A marker only counts when it hugs the words, like WhatsApp: "* not bold *" stays as typed.
    const hugs = inner.length > 0 && inner.trim() === inner
    if (hugs && part.startsWith('*') && part.endsWith('*')) return <strong key={k}>{inner}</strong>
    if (hugs && part.startsWith('_') && part.endsWith('_')) return <em key={k}>{inner}</em>
    if (hugs && part.startsWith('~') && part.endsWith('~')) return <s key={k}>{inner}</s>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={k} className="rounded bg-black/5 px-1 font-mono" style={{ fontSize: '0.92em' }}>
          {inner}
        </code>
      )
    return part
  })
}

export function WaText({ text }: { text: string }) {
  const blocks = text.split(/```/)
  return (
    <span className="whitespace-pre-wrap wrap-break-word">
      {blocks.map((block, b) =>
        b % 2 === 1 ? (
          <span key={b} className="my-1 block rounded bg-black/5 p-1.5 font-mono" style={{ fontSize: '0.88em' }}>
            {block.replace(/^\n|\n$/g, '')}
          </span>
        ) : (
          block.split('\n').map((line, l, all) => {
            const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
            const last = l === all.length - 1
            return (
              <span key={`${b}-${l}`}>
                {bullet ? (
                  <span className="flex gap-1.5">
                    <span aria-hidden>•</span>
                    <span>{inline(bullet[1], `${b}-${l}`)}</span>
                  </span>
                ) : (
                  <>
                    {inline(line, `${b}-${l}`)}
                    {!last && '\n'}
                  </>
                )}
              </span>
            )
          })
        ),
      )}
    </span>
  )
}
