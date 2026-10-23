// Focusing the omnibar (src/app/omnibar/Omnibar.tsx) from a button, as ⌘K does.
export const OPEN_COMMAND_PALETTE = 'helo:command-palette'
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))
/** How the shortcut is written on this computer. */
export const PALETTE_SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
