// Meta's title rule for skills and rich replies (UI skills): lowercase letters, numbers and hyphens,
// max 64, no hyphen at either end. Meta answers a 400 otherwise; the console keeps the readable name.

/** A short stable tag for a name (FNV-1a), so two names in another script get different titles. */
const tag = (s: string) => {
  let h = 0x811c9dc5
  for (const ch of s.trim().normalize('NFC')) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0
  return h.toString(36).slice(0, 6)
}

/** "Order status" → "order-status". Cut first, then trim, so the cut never leaves a hyphen at the end.
 *  A name with no a-z or 0-9 (Hindi, Arabic, emoji) gets `fallback`, by default "skill-" plus a tag of
 *  the name, so "ऑर्डर" and "रिफंड" can both exist. */
export const skillTitle = (t: string, fallback = `skill-${tag(t)}`) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64).replace(/^-+|-+$/g, '') || fallback

/** True when `name` would reach Meta with the same title as one of `others`. */
export const titleTaken = (name: string, others: string[]) => {
  const t = skillTitle(name)
  return others.some((o) => skillTitle(o) === t)
}
