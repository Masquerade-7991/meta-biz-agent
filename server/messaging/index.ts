// The messaging domain's public surface: what other domains may import (scripts/check-deps.mjs). Within the domain, import modules directly.
export { dismissReminder, dueReminders } from './followups.ts'
export { addMessage, conversations, currentNumber, ensureConversation, importTurns, sendInteractive, sendTemplateMessage, sendText, setControl } from './inbox.ts'
export type { Actor, Turn } from './inbox.ts'
