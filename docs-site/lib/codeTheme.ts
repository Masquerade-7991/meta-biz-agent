// The code colour theme for every code block: the guides' MDX blocks (lib/source.ts) and the API
// reference's samples and responses (components/api-page.tsx). Catppuccin: one soft hue per kind of
// token, so curl lines and JSON bodies read at a glance. Pale Latte shades are lifted to AA in app/global.css.
export const CODE_THEMES = { light: 'catppuccin-latte', dark: 'catppuccin-mocha' } as const;
