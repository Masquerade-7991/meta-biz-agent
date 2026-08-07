export function PlaceholderStep({ greyLine, body }: { greyLine: string; body: string }) {
  return (
    <div className="space-y-8">
      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
        {greyLine}
      </p>
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <p className="max-w-sm text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          {body}
        </p>
      </div>
    </div>
  )
}
