import { createContext } from 'react'
import type { Member } from './api'

/** The Settings area loads the workspace's people once and shares them with every tab (useMembers). */
export const MembersContext = createContext<{ members: Member[]; reload: () => void } | null>(null)
