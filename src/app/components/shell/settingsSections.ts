import { createContext } from 'react'

// A Settings tab's sections tell its page they're on screen (SettingsSection), so the omnibar can
// list their titles and scroll to one (AreaPage in SettingsPage.tsx).
export type RegisterSection = (id: string, title: string) => () => void
export const SettingsSectionsContext = createContext<RegisterSection | null>(null)

/** The section's element id, from its title: "Business hours" → settings-business-hours. */
export const sectionId = (title: string) => `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
