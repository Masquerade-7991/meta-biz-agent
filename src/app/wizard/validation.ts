import type { BusinessHourRow, BusinessState, StepId, WizardState } from './types'
import { looksLikeInstruction } from './mockData'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Each check below is unchanged from the screen it came from — the restructure only regroups
// which checks gate which step's Next button, per the merges in the restructure spec.
function isIdentityValid(state: WizardState): boolean {
  return (
    state.identity.agentName.trim().length > 0 &&
    state.identity.agentName.trim().length <= 60 &&
    state.identity.agentRole.trim().length > 0 &&
    state.identity.agentRole.trim().length <= 250 &&
    !looksLikeInstruction(state.identity.agentName) &&
    !looksLikeInstruction(state.identity.agentRole)
  )
}

function isPersonalizationValid(state: WizardState): boolean {
  const { personalization } = state
  if (personalization.defaultLanguage.trim().length === 0) return false
  if (personalization.tone === 'custom') {
    const text = personalization.customToneInstructions.trim()
    if (text.length === 0 || text.length > 300 || looksLikeInstruction(text)) return false
  }
  return true
}

function isBusinessValid(state: WizardState): boolean {
  return state.business.businessDescription.trim().length > 0 && EMAIL_RE.test(state.business.contactEmail)
}

export function isStepValid(state: WizardState, step: StepId): boolean {
  switch (step) {
    case 'agent':
      return isIdentityValid(state) && isPersonalizationValid(state)
    case 'knowledge':
      return isBusinessValid(state)
    case 'connections':
      return true
    case 'safety':
      return true
    case 'publish':
      return false
    default:
      return false
  }
}

/** Business profile fields as labelled on screen; shared by the Business profile step and the
 *  Knowledge step's coverage line. */
export const FIELD_LABELS: Record<string, string> = {
  businessDescription: 'Business description',
  paymentMethods: 'Payment methods',
  returnPolicy: 'Cancellations & refunds',
  purchaseInfo: 'How customers buy or book',
  deliveryAndShipping: 'Delivery or fulfilment',
  contactEmail: 'Contact email',
  businessAddress: 'Business address',
  businessHours: 'Business hours',
}

export function hasHoursData(rows: BusinessHourRow[]): boolean {
  return rows.some((r) => r.closed || (r.open && r.close))
}

export function isFieldEmpty(key: string, business: BusinessState): boolean {
  if (key === 'paymentMethods') {
    return business.paymentSource === 'text'
      ? business.paymentPlainText.trim().length === 0
      : business.paymentMethods.length === 0
  }
  if (key === 'businessHours') {
    return !hasHoursData(business.businessHours)
  }
  const value = (business as unknown as Record<string, string>)[key]
  return !value || value.trim().length === 0
}

/** Used by the Knowledge step container to decide whether to say "Business details provided"
 *  in the coverage line, and whether the all-empty block should show. */
export function hasAnyBusinessDetails(business: BusinessState): boolean {
  return Object.keys(FIELD_LABELS).some((key) => !isFieldEmpty(key, business))
}
