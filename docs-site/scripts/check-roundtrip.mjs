// Guards the content against the in-browser editor (npm run edit): every page is parsed and
// written back exactly as the editor does on save, with the same component set
// (fumadocs-studio.config.ts). A page whose text would change, or that uses a component the
// editor doesn't know (shown as raw source there), fails. Run before editing and after
// upgrading @fumadocs-editor/*: npm run check:editor
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createSyntax, parseMdxToDoc, serializeDocToMdx } from '@fumadocs-editor/core'
import config from '../fumadocs-studio.config.ts'

const ROOT = path.resolve(import.meta.dirname, '..', config.root)
const syntax = createSyntax(config.components, config.syntax)

const files = []
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.mdx?$/.test(e)) files.push(p)
  }
}
walk(ROOT)

/** What the editor can't show as rich content: a component it has no spec for (its tags appear as
 *  raw text), an `{expression}`, or anything kept verbatim. */
const RAW = /^(mdxJsxFlowElement|mdxFlowExpression|verbatim)/
const rawNodes = (node, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (typeof node.type === 'string' && RAW.test(node.type))
    out.push(node.type === 'mdxJsxFlowElement' ? (node.content?.[0]?.content?.[0]?.text ?? '<?>').slice(0, 60) : node.type === 'mdxFlowExpression' ? `{${node.attrs?.value}}` : node.type)
  for (const c of node.content ?? []) rawNodes(c, out)
  return out
}

let bad = 0
for (const f of files) {
  const rel = path.relative(ROOT, f)
  const source = readFileSync(f, 'utf8')
  let out
  let raw = []
  try {
    const { doc, snapshot } = parseMdxToDoc(source, syntax)
    out = serializeDocToMdx(doc, snapshot)
    raw = rawNodes(typeof doc.toJSON === 'function' ? doc.toJSON() : doc)
  } catch (err) {
    console.log(`✖ ${rel}: the editor can't open it (${err instanceof Error ? err.message : err})`)
    bad++
    continue
  }
  if (out !== source) {
    const a = source.split('\n')
    const b = out.split('\n')
    const i = a.findIndex((l, n) => l !== b[n])
    console.log(`✖ ${rel}: saving would change it, from line ${i + 1}:\n    was: ${JSON.stringify(a[i])}\n    now: ${JSON.stringify(b[i])}`)
    bad++
  }
  if (raw.length) {
    console.log(`✖ ${rel}: the editor would show this as raw source: ${[...new Set(raw)].join(', ')} (add a component spec in fumadocs-studio.config.ts)`)
    bad++
  }
}
console.log(`${files.length} pages${bad ? `, ${bad} problem(s)` : ': every page opens as rich content and saves back unchanged.'}`)
process.exit(bad ? 1 : 0)
