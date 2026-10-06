import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { PageLoader } from '@/app/components/ui/wavy-loader'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { LOADING_LINES, type LoadingContext } from '@/app/lib/loadingLines'

/** Demo controls → Loader: shows the full-page loader for a few seconds, with any area's lines. */
export function LoaderPreview() {
  const [context, setContext] = useState<LoadingContext>('general')
  const [showing, setShowing] = useState(false)
  useEffect(() => {
    if (!showing) return
    const t = setTimeout(() => setShowing(false), 6000)
    return () => clearTimeout(t)
  }, [showing])

  const controls = useMemo(
    () => (
      <DemoControlsGroup label="Loader">
        <label htmlFor="demo-loader-area" className="text-xs text-muted-foreground">
          Area
        </label>
        <select id="demo-loader-area" value={context} onChange={(e) => setContext(e.target.value as LoadingContext)} className="rounded border border-border bg-background text-xs">
          {(Object.keys(LOADING_LINES) as LoadingContext[]).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setShowing(true)}>
          Show loader (6 s)
        </Button>
      </DemoControlsGroup>
    ),
    [context],
  )
  useRegisterDevControls('loader', controls)

  return showing ? (
    <div onClick={() => setShowing(false)}>
      <PageLoader fullscreen context={context} />
    </div>
  ) : null
}
