// Opening the ⌘K palette (src/app/components/shell/CommandPalette.tsx) from a button.
export const OPEN_COMMAND_PALETTE = 'helo:command-palette'
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))
/** How the shortcut is written on this computer. */
export const PALETTE_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
