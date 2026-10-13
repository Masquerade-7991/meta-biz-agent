// The support domain's public surface: what other domains may import (scripts/check-deps.mjs). Within the domain, import modules directly.
export { contactNames, segmentQuery } from './contacts.ts'
export type { SegmentFilter } from './contacts.ts'
export { cleanUpMember, getTeams } from './supportOps.ts'
export { closeOnRelease, ensureTicket, getSettings, needCanAssign, needInScope, onAgentReply, onCustomerMessage, scopeFor } from './tickets.ts'
