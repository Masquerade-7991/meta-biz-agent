import type { StudioSectionId } from './types'

// The agent studio's addresses: /agents/studio/<section>. Readable words, not internal ids.
const SLUGS: Record<StudioSectionId, string> = {
  overview: 'overview',
  identity: 'identity',
  abilities: 'abilities',
  knowledge: 'knowledge',
  connections: 'connections',
  safety: 'safety',
  testEval: 'test',
  publish: 'publish',
  analytics: 'performance',
  activity: 'logs',
}
export const STUDIO_BASE = '/agents/studio'
export const studioPath = (section: StudioSectionId) => `${STUDIO_BASE}/${SLUGS[section]}`
export const sectionFromSlug = (slug: string | undefined): StudioSectionId | null =>
  (Object.entries(SLUGS).find(([, s]) => s === slug)?.[0] as StudioSectionId | undefined) ?? null
