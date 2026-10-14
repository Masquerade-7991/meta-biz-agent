// Writes the console's backdrop masks (src/styles/backdrop.css colours them with --backdrop-* tokens):
//   src/assets/backdrop/dither-ramp.svg  an ordered (Bayer 4×4) dither in 2 px squares, densest at the
//                                         top and empty at the bottom, tiling sideways
//   src/assets/backdrop/shapes.svg       two outlines of the Helo mark's silhouette and a few rules
// Both are masks (white = shown), so one file serves light and dark. Run after changing them:
//   node scripts/make-backdrop.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'src/assets/backdrop')

// ---- dither ----
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]
const CELL = 2 // px per dot
const ROWS_PER_STEP = 6 // 12 px per density step
const LEVELS = [7, 6, 5, 4, 3, 2, 1, 0] // dots lit per 16, step by step

/** The lit cells of the ramp as [column, row] pairs, one 4-cell-wide tile. */
export function ditherCells(levels = LEVELS) {
  const cells = []
  levels.forEach((level, step) => {
    for (let r = 0; r < ROWS_PER_STEP; r++) {
      const row = step * ROWS_PER_STEP + r
      for (let c = 0; c < 4; c++) if (BAYER[row % 4][c] < level) cells.push([c, row])
    }
  })
  return cells
}

const cells = ditherCells()
// Self-check: each step has fewer dots than the one above, and the last has none.
const perStep = LEVELS.map((_, s) => cells.filter(([, r]) => Math.floor(r / ROWS_PER_STEP) === s).length)
for (let s = 1; s < perStep.length; s++) assert.ok(perStep[s] < perStep[s - 1], `step ${s} isn't lighter than step ${s - 1}: ${perStep}`)
assert.equal(perStep.at(-1), 0)

const W = 4 * CELL
const H = LEVELS.length * ROWS_PER_STEP * CELL
const dither = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><path fill="#fff" d="${cells.map(([c, r]) => `M${c * CELL} ${r * CELL}h${CELL}v${CELL}h-${CELL}z`).join('')}"/></svg>\n`

// ---- shapes: the mark's outline (src/assets/helo-mark.svg), twice, offset like stacked cards ----
const mark = readFileSync(path.join(ROOT, 'src/assets/helo-mark.svg'), 'utf8')
const silhouette = mark.match(/<path fill="#0c0a0b" d="([^"]+)"/)?.[1]
assert.ok(silhouette, 'helo-mark.svg: the outline path (fill #0c0a0b) was not found')
const shapes = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240" fill="none" stroke="#fff" stroke-linecap="round">
  <g transform="translate(250 -64) scale(1.15)"><path d="${silhouette}" stroke-width="1.1"/></g>
  <g transform="translate(316 -20) scale(1.15)"><path d="${silhouette}" stroke-width="1.1" stroke-dasharray="3 6"/></g>
  <path d="M200 132H262M188 150H262M224 168H262" stroke-width="1.1"/>
  <circle cx="442" cy="212" r="2.5" fill="#fff" stroke="none"/>
</svg>
`

mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, 'dither-ramp.svg'), dither)
writeFileSync(path.join(OUT, 'shapes.svg'), shapes)
console.log(`backdrop: dither ${W}×${H} (${cells.length} dots, per step ${perStep.join('/')}), shapes 480×240`)
