import { useWizard } from '@/app/wizard/WizardContext'
import { MetaError } from '@/app/api/meta'

/** Demo controls' "fail the next call": run `guard()` before a write; it throws once when armed. */
export function useForcedFailure() {
  const { state, patch } = useWizard()
  return () => {
    if (!state.demo.forceNextFailure) return
    patch('demo', { forceNextFailure: false })
    throw new MetaError(502, 'WhatsApp didn’t accept it', 'Forced failure from Demo controls.')
  }
}
