import { Component, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/app/components/ui/button'

/** A page that failed to load or render: a message and a reload, instead of a blank app. The usual
 *  cause is a tab left open across a deploy, asking for page code that no longer exists. `resetKey`
 *  (the page) clears it when the person goes somewhere else. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error) {
    console.error('Page failed:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message)
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
        <p className="text-section font-semibold">{stale ? 'Helo.ai was updated' : 'This page couldn’t load'}</p>
        <p className="text-sm text-muted-foreground">
          {stale ? 'Reload to get the new version. Nothing you saved is lost.' : 'Something went wrong showing this page. Reload to try again; if it keeps happening, tell your Helo.ai contact.'}
        </p>
        <Button onClick={() => window.location.reload()}>
          <RefreshCw className="size-4" />
          Reload
        </Button>
      </div>
    )
  }
}
