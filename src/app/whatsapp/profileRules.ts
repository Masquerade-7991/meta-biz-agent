// What WhatsApp accepts for a number's public profile, display name, ice breakers and commands
// (WhatsApp Business Profile and Conversational Components references). Shared: forms check as you
// type, the server enforces the same rules before calling Meta.

export const VERTICALS: { id: string; label: string }[] = [
  { id: 'OTHER', label: 'Other' },
  { id: 'AUTO', label: 'Automotive' },
  { id: 'BEAUTY', label: 'Beauty, spa and salon' },
  { id: 'APPAREL', label: 'Clothing and apparel' },
  { id: 'EDU', label: 'Education' },
  { id: 'ENTERTAIN', label: 'Entertainment' },
  { id: 'EVENT_PLAN', label: 'Event planning and service' },
  { id: 'FINANCE', label: 'Finance and banking' },
  { id: 'GROCERY', label: 'Food and grocery' },
  { id: 'GOVT', label: 'Public service' },
  { id: 'HOTEL', label: 'Hotel and lodging' },
  { id: 'HEALTH', label: 'Medical and health' },
  { id: 'NONPROFIT', label: 'Non-profit' },
  { id: 'PROF_SERVICES', label: 'Professional services' },
  { id: 'RETAIL', label: 'Shopping and retail' },
  { id: 'TRAVEL', label: 'Travel and transportation' },
  { id: 'RESTAURANT', label: 'Restaurant' },
  { id: 'ALCOHOL', label: 'Alcoholic beverages' },
  { id: 'ONLINE_GAMBLING', label: 'Online gambling and gaming' },
  { id: 'PHYSICAL_GAMBLING', label: 'Non-online gambling and gaming' },
  { id: 'OTC_DRUGS', label: 'Over-the-counter drugs' },
]

export const PROFILE_LIMITS = { about: 139, address: 256, description: 512, email: 128, websites: 2, website: 256 }
export const AUTOMATION_LIMITS = { prompts: 4, prompt: 80, commands: 30, commandName: 32, commandDescription: 256 }

export interface Profile {
  about: string
  address: string
  description: string
  email: string
  websites: string[]
  vertical: string
}
export interface Automation {
  prompts: string[]
  commands: { name: string; description: string }[]
}

/** Problems per field ({} = fine). Empty fields are allowed; they clear that part of the profile. */
export function profileErrors(p: Profile): Partial<Record<keyof Profile, string>> {
  const e: Partial<Record<keyof Profile, string>> = {}
  if (p.about.length > PROFILE_LIMITS.about) e.about = `Keep it to ${PROFILE_LIMITS.about} characters.`
  if (p.address.length > PROFILE_LIMITS.address) e.address = `Keep it to ${PROFILE_LIMITS.address} characters.`
  if (p.description.length > PROFILE_LIMITS.description) e.description = `Keep it to ${PROFILE_LIMITS.description} characters.`
  if (p.email && (p.email.length > PROFILE_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))) e.email = 'That email address doesn’t look right.'
  const sites = p.websites.filter((w) => w.trim())
  if (sites.length > PROFILE_LIMITS.websites) e.websites = `WhatsApp shows up to ${PROFILE_LIMITS.websites} websites.`
  else if (sites.some((w) => w.length > PROFILE_LIMITS.website || !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(w.trim()))) e.websites = 'Websites start with http:// or https:// and have a domain, like https://example.com.'
  if (!VERTICALS.some((v) => v.id === p.vertical)) e.vertical = 'Pick a category.'
  return e
}

/** A display-name request's first problem, or null. Meta reviews the rest against its guidelines. */
export function displayNameError(name: string): string | null {
  const n = name.trim()
  if (n.length < 3) return 'Use at least 3 characters.'
  if (n.length > 75) return 'Keep it under 75 characters.'
  if (/https?:\/\/|www\./i.test(n)) return 'A display name can’t be a web address.'
  if (n === n.toUpperCase() && /[A-Z]{4,}/.test(n)) return 'Avoid all capitals unless your brand is written that way (e.g. IBM).'
  if (/[!?*~#@$%^&_=<>{}[\]|\\]{2,}/.test(n) || /(.)\1{3,}/.test(n)) return 'Avoid repeated or decorative punctuation.'
  return null
}

export function automationErrors(a: Automation): string | null {
  const prompts = a.prompts.filter((x) => x.trim())
  if (prompts.length > AUTOMATION_LIMITS.prompts) return `WhatsApp shows up to ${AUTOMATION_LIMITS.prompts} ice breakers.`
  if (prompts.some((x) => x.length > AUTOMATION_LIMITS.prompt)) return `Ice breakers can be ${AUTOMATION_LIMITS.prompt} characters at most.`
  const cmds = a.commands.filter((c) => c.name.trim() || c.description.trim())
  if (cmds.length > AUTOMATION_LIMITS.commands) return `WhatsApp allows ${AUTOMATION_LIMITS.commands} commands.`
  for (const c of cmds) {
    if (!/^[a-z0-9_]+$/i.test(c.name.trim())) return `Command “/${c.name.trim()}”: use letters, numbers and _ only, no spaces.`
    if (c.name.trim().length > AUTOMATION_LIMITS.commandName) return `Command names can be ${AUTOMATION_LIMITS.commandName} characters at most.`
    if (!c.description.trim()) return `Say what /${c.name.trim()} does.`
    if (c.description.length > AUTOMATION_LIMITS.commandDescription) return `Command descriptions can be ${AUTOMATION_LIMITS.commandDescription} characters at most.`
  }
  if (new Set(cmds.map((c) => c.name.trim().toLowerCase())).size !== cmds.length) return 'Each command needs a different name.'
  return null
}

/** What each phone-number status means for the business, and the one thing to do about it. */
export const STATUS_HELP: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad'; help: string; action?: 'verify' | 'register' | 'manager' }> = {
  CONNECTED: { label: 'Live', tone: 'ok', help: 'Sending and receiving messages.' },
  PENDING: { label: 'Pending verification', tone: 'warn', help: 'Prove you own this number with a code by SMS or call, then register it.', action: 'verify' },
  UNVERIFIED: { label: 'Not verified', tone: 'warn', help: 'Prove you own this number with a code by SMS or call.', action: 'verify' },
  DISCONNECTED: { label: 'Disconnected', tone: 'bad', help: 'The number isn’t registered for messaging. Register it again with its PIN.', action: 'register' },
  MIGRATED: { label: 'Moved away', tone: 'bad', help: 'This number now lives in another WhatsApp account.', action: 'manager' },
  FLAGGED: { label: 'Flagged', tone: 'warn', help: 'Quality is low. WhatsApp may lower its daily limit if it doesn’t improve within 7 days.', action: 'manager' },
  RESTRICTED: { label: 'Restricted', tone: 'bad', help: 'It reached its daily limit or broke a policy, so it can only reply to customers for now.', action: 'manager' },
  RATE_LIMITED: { label: 'Rate limited', tone: 'warn', help: 'Too many messages too fast. It recovers on its own.' },
  BANNED: { label: 'Banned', tone: 'bad', help: 'WhatsApp banned this number. You can appeal in WhatsApp Manager.', action: 'manager' },
  DELETED: { label: 'Deleted', tone: 'bad', help: 'This number was removed from the WhatsApp account.' },
  UNKNOWN: { label: 'Unknown', tone: 'warn', help: 'WhatsApp hasn’t reported a status yet.' },
}
export const statusHelp = (s: string | null | undefined) => STATUS_HELP[String(s ?? 'UNKNOWN').toUpperCase()] ?? STATUS_HELP.UNKNOWN

export const MANAGER_URL = 'https://business.facebook.com/wa/manage/phone-numbers/'
