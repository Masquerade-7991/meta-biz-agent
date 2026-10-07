// Meta's title rule for skills and rich replies (UI skills): lowercase letters, numbers and hyphens,
// max 64, no hyphen at either end. Meta answers a 400 otherwise; the console keeps the readable name.

/** "Order status" → "order-status". Cut first, then trim, so the cut never leaves a hyphen at the end.
 *  A name with no a-z or 0-9 (e.g. Hindi, emoji) gets `fallback`. */
export const skillTitle = (t: string, fallback = 'skill') =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '') || fallback

/** True when `name` would reach Meta with the same title as one of `others`. */
export const titleTaken = (name: string, others: string[]) => {
  const t = skillTitle(name)
  return others.some((o) => skillTitle(o) === t)
}
