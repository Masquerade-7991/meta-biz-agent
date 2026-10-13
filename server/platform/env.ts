// One reader for settings, trimmed; '' when unset. Every module takes settings through here.
export const env = (k: string) => (process.env[k] ?? '').trim()
