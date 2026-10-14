// Writes the console's backdrop masks (src/styles/backdrop.css colours them with --backdrop-* tokens):
//   src/assets/backdrop/halftone.svg  an 8 px tile with two 1 px dots on a diagonal screen
//   src/assets/backdrop/shapes.svg    two large outlines of the Helo mark's silhouette
// Both are masks (white = shown), so one file serves light and dark. Run after changing them:
//   node scripts/make-backdrop.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'src/assets/backdrop')

// A diagonal halftone screen: one dot per 4×4 px cell, every other cell offset, so the dots never
// line up into stripes (the eye reads aligned rows as lines; offset dots read as an even tint).
const TILE = 8
const DOTS = [
  [0, 0],
  [4, 4],
]
assert.ok(DOTS.every(([x, y]) => x < TILE && y < TILE))
const halftone = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}" shape-rendering="crispEdges"><path fill="#fff" d="${DOTS.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')}"/></svg>\n`

// The mark's outline (src/assets/helo-mark.svg), twice, large and offset like stacked cards.
const mark = readFileSync(path.join(ROOT, 'src/assets/helo-mark.svg'), 'utf8')
const silhouette = mark.match(/<path fill="#0c0a0b" d="([^"]+)"/)?.[1]
assert.ok(silhouette, 'helo-mark.svg: the outline path (fill #0c0a0b) was not found')
const shapes = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640" fill="none" stroke="#fff">
  <g transform="translate(150 120) scale(2.2)"><path d="${silhouette}" stroke-width="0.5"/></g>
  <g transform="translate(250 230) scale(2.2)"><path d="${silhouette}" stroke-width="0.5" stroke-dasharray="2 4"/></g>
</svg>
`

mkdirSync(OUT, { recursive: true })
rmSync(path.join(OUT, 'dither-ramp.svg'), { force: true }) // the earlier, chunkier dither
writeFileSync(path.join(OUT, 'halftone.svg'), halftone)
writeFileSync(path.join(OUT, 'shapes.svg'), shapes)
console.log(`backdrop: halftone ${TILE}×${TILE} (${DOTS.length} dots), shapes 640×640`)
