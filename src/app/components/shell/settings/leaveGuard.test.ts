// Run: node --test src/app/components/shell/settings/leaveGuard.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

// QA-44: the browser's leave prompt is one listener added once, never taken away by a form cleaning up.
test('one beforeunload listener, added at load, quiet while nothing is unsaved', async () => {
  const added: { type: string; fn: (e: unknown) => void }[] = []
  const removed: string[] = []
  ;(globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, fn: (e: unknown) => void) => added.push({ type, fn }),
    removeEventListener: (type: string) => removed.push(type),
  }
  const { hasUnsaved, confirmLeave } = await import('./leaveGuard.ts')
  assert.deepEqual(added.map((a) => a.type), ['beforeunload'])
  assert.equal(hasUnsaved(), false)
  let prevented = false
  added[0].fn({ preventDefault: () => (prevented = true) })
  assert.equal(prevented, false)
  assert.equal(await confirmLeave(), true)
  assert.deepEqual(removed, [])
})
