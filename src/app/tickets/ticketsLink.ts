/** The Tickets list with these filters (the same names its address uses). */
export const ticketsLink = (p: Record<string, string>) => {
  const q = new URLSearchParams(Object.entries(p).filter(([k, v]) => v && !(k === 'view' && v === 'open')))
  const s = q.toString()
  return `/tickets${s ? `?${s}` : ''}`
}
