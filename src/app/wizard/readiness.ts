import type { StudioSectionId, WizardState } from './types'

// What an agent needs before it goes live, in order. Overview shows it as a checklist and Publish
// as its pre-flight, so both read the same facts.

export interface ReadinessItem {
  id: 'number' | 'identity' | 'knowledge' | 'tested' | 'audience' | 'live'
  label: string
  /** Short state shown beside the label, e.g. "3 sources". */
  detail?: string
  done: boolean
  section: StudioSectionId
}

export function readiness(state: WizardState): ReadinessItem[] {
  const k = state.knowledge
  const sources = k.faqs.length + k.documents.length + k.websites.length
  const reading = k.websites.filter((w) => w.status === 'waiting' || w.status === 'reading').length
  const p = state.publish
  const testers = p.allowlistNumbers.length
  return [
    { id: 'number', label: 'Connect a WhatsApp number', detail: state.gate.selectedPhoneNumber || undefined, done: !!state.gate.selectedPhoneNumberId, section: 'overview' },
    { id: 'identity', label: 'Say what your agent does', done: state.identity.agentRole.trim().length > 0, section: 'identity' },
    {
      id: 'knowledge',
      label: 'Give it knowledge',
      detail: sources
        ? `${sources} source${sources === 1 ? '' : 's'}${reading ? `, ${reading} still reading` : ''}`
        : state.business.businessDescription.trim()
          ? 'Business details'
          : 'Website, FAQs or documents',
      done: sources > 0 || state.business.businessDescription.trim().length > 0,
      section: 'knowledge',
    },
    { id: 'tested', label: 'Try it in Test & Eval', done: !!p.chatTested || p.standardChecksRun, section: 'testEval' },
    {
      id: 'audience',
      label: 'Choose who it answers',
      detail: p.audienceMode === 'everyone' ? 'Everyone' : testers ? `${testers} test number${testers === 1 ? '' : 's'}` : undefined,
      done: p.audienceMode === 'everyone' || testers > 0,
      section: 'publish',
    },
    { id: 'live', label: 'Go live', done: p.activated && !p.stopped, section: 'publish' },
  ]
}
