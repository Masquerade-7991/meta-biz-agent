import type { BusinessHourRow, BusinessState } from './types'

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
