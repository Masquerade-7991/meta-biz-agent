/** The quiet background behind a whole screen (styles in src/styles/backdrop.css). Put it first
 *  inside the screen's root element, which needs `relative isolate`. */
export function Backdrop() {
  return <div aria-hidden className="backdrop" />
}
