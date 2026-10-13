// The insights domain's public surface: what other domains may import (scripts/check-deps.mjs). Within the domain, import modules directly.
export { aiUsageMonth, recordAiUsage } from './aiUsage.ts'
export { addDays, dayIn, ensureDays } from './collectors.ts'
