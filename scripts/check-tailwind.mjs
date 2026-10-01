#!/usr/bin/env node
// Reports the Tailwind CSS IntelliSense v4 class diagnostics (suggestCanonicalClasses, cssConflict)
// for every string in src/, using the project's own Tailwind design system, plus a "review" list
// of class-like tokens Tailwind can't parse (likely typos). `--fix` applies canonical rewrites
// whose generated CSS is identical to the original.
//
// Usage: npm run lint:tw [-- --fix]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(root, 'package.json'))
// @tailwindcss/node comes with @tailwindcss/vite; it's what the IntelliSense extension uses for v4
const { __unstable__loadDesignSystem } = await import(require.resolve('@tailwindcss/node'))

const cssBase = path.join(root, 'src/styles')
const ds = await __unstable__loadDesignSystem(fs.readFileSync(path.join(cssBase, 'tailwind.css'), 'utf8'), { base: cssBase })
const REM = 16 // tailwindCSS.rootFontSize default
const FIX = process.argv.includes('--fix')
const CLASS_ATTRS = new Set(['className', 'class'])
const CLASS_FNS = new Set(['cn', 'clsx', 'cx', 'cva', 'twMerge', 'twJoin'])

// IntelliSense warnings reviewed and deliberately kept, as 'file:class'. Still printed, don't fail.
const ACCEPTED = new Set([
  // Suggested `rounded-lg` is var(--radius) = 8px at runtime (theme.css), not 4px
  'src/app/components/ui/checkbox.tsx:rounded-[4px]',
  // Suggested `*:`/`**:` forms emit a different (equivalent) selector, so the CSS isn't identical
  ...['[&_[cmdk-group-heading]]:', '[&_[cmdk-group]]:', '[&_[cmdk-input]]:', '[&_[cmdk-item]]:'].flatMap((v) =>
    ['px-2', 'py-1.5', 'py-3', 'h-12', 'text-xs', 'font-medium', 'text-muted-foreground'].map((u) => `src/app/components/ui/command.tsx:${v}${u}`),
  ),
  'src/app/components/ui/table.tsx:[&>[role=checkbox]]:translate-y-0.5',
])

// Custom properties the app sets outside @theme (e.g. `--radius: 8px` in theme.css). Tailwind's
// canonicalizer assumes their default-theme value, so they are never inlined when comparing CSS.
const runtimeVars = new Set(
  fs.readdirSync(path.join(root, 'src/styles'))
    .filter((f) => f.endsWith('.css'))
    .flatMap((f) => [...fs.readFileSync(path.join(root, 'src/styles', f), 'utf8').replace(/@theme[^{]*\{[^}]*\}/g, '').matchAll(/(--[\w-]+)\s*:/g)])
    .map((m) => m[1]),
)

// ---- design-system helpers --------------------------------------------------------------

const cssCache = new Map()
const toCss = (c) => {
  if (!cssCache.has(c)) cssCache.set(c, ds.candidatesToCss([c])[0])
  return cssCache.get(c)
}

// CSS.escape, which is what Tailwind uses for selectors
const escape = (s) => s.replace(/(^-?\d)|[^\w-]|^-$/g, (m, lead) => (lead ? `\\3${lead.at(-1)} ` : `\\${m}`))

// Comparable form of a class's CSS: selector stripped, theme vars inlined, rem/calc folded to px
function normalizedCss(c) {
  let css = toCss(c)
  if (css == null) return null
  css = css.replaceAll(`.${escape(c)}`, '&')
  for (let i = 0; i < 5; i++) {
    css = css.replace(/var\((--[\w-]+)\)/g, (m, v) => (runtimeVars.has(v) ? m : (ds.theme.get([v]) ?? m)))
  }
  const px = (n, unit) => (unit === 'rem' ? n * REM : n)
  css = css.replace(/calc\(\s*(-?[\d.]+)(rem|px)\s*\*\s*(-?[\d.]+)\s*\)/g, (_, a, u, b) => `${+(px(+a, u) * +b).toFixed(4)}px`)
  css = css.replace(/(-?\d*\.?\d+)rem\b/g, (_, n) => `${+(n * REM).toFixed(4)}px`)
  return css
}

const canonical = (c) => ds.canonicalizeCandidates([c], { rem: REM })[0]

// Mirrors the extension's cssConflict: same properties in the same selector/at-rule context
function ruleInfo(classes) {
  const asts = ds.candidatesToAst(classes)
  return classes.map((c, i) => {
    const out = []
    const walk = (nodes, ctx) => {
      for (const n of nodes) {
        if (n.kind !== 'rule' && n.kind !== 'at-rule') continue
        const here = [...ctx, n.kind === 'rule' ? n.selector.replaceAll(`.${escape(c)}`, '&') : `${n.name} ${n.params}`]
        const props = (n.nodes ?? []).filter((d) => d.kind === 'declaration').map((d) => d.property)
        if (props.length) out.push({ props: props.sort().join(), ctx: here.filter((s) => s && s !== '&').sort().join('|') })
        walk(n.nodes ?? [], here)
      }
    }
    walk(asts[i] ?? [], [])
    return out
  })
}

function conflicts(tokens) {
  const info = ruleInfo(tokens.map((t) => t.cls))
  const same = (a, b) => a.length && a.length === b.length && a.every((r, k) => r.props === b[k].props && r.ctx === b[k].ctx)
  const found = []
  tokens.forEach((t, i) => {
    const others = tokens.filter((u, j) => j !== i && same(info[i], info[j])).map((u) => u.cls)
    if (others.length) found.push({ tok: t, others })
  })
  return found
}

// "looks like Tailwind" for unparseable tokens: a known utility root, or one edit from a real class
const knownClasses = new Set(ds.getClassList().map(([c]) => c))
function nearMiss(c) {
  const base = c.slice(c.lastIndexOf(':') + 1).replace(/^!|!$/g, '').replace(/^-/, '')
  if (base.length < 4) return null
  for (let k = base.indexOf('-'); k > 0; k = base.indexOf('-', k + 1)) {
    if (ds.utilities.has(base.slice(0, k), 'functional')) return 'unknown value for a Tailwind utility'
  }
  for (const k of knownClasses) if (Math.abs(k.length - base.length) <= 1 && within1(k, base)) return `did you mean \`${k}\`?`
  return null
}
function within1(a, b) {
  if (a === b) return true
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i)
}

// ---- source scanning --------------------------------------------------------------------

function isClassContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p) && CLASS_ATTRS.has(p.name.getText())) return true
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && CLASS_FNS.has(p.expression.text)) return true
    if (ts.isImportDeclaration(p) || ts.isLiteralTypeNode(p)) return false
  }
  return false
}

// A string literal (or template) becomes one class list: tokens with their source offsets.
// Tokens glued to a `${}` are partial class names and are skipped.
function tokensOf(node, src) {
  const parts = []
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    parts.push([node.getStart() + 1, node.getEnd() - 1, false, false])
  } else if (ts.isTemplateExpression(node)) {
    parts.push([node.head.getStart() + 1, node.head.getEnd() - 2, false, true])
    node.templateSpans.forEach((s, i) => {
      const last = i === node.templateSpans.length - 1
      parts.push([s.literal.getStart() + 1, s.literal.getEnd() - (last ? 1 : 2), true, !last])
    })
  }
  const tokens = []
  for (const [start, end, gluedStart, gluedEnd] of parts) {
    const text = src.slice(start, end)
    for (const m of text.matchAll(/\S+/g)) {
      if (gluedStart && m.index === 0) continue
      if (gluedEnd && m.index + m[0].length === text.length) continue
      tokens.push({ cls: m[0], pos: start + m.index })
    }
  }
  return tokens
}

function* walkFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walkFiles(p)
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) yield p
  }
}

const findings = [] // { file, line, rule, cls, msg, fix? }
const edits = new Map() // file -> [{ pos, from, to }]

for (const file of walkFiles(path.join(root, 'src'))) {
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = path.relative(root, file)
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const add = (f) => findings.push({ file: rel, ...f })

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const tokens = tokensOf(node, src)
      const classCtx = isClassContext(node)
      // Outside className/cn/cva, only treat a string as classes when every token is a real class
      const valid = tokens.filter((t) => toCss(t.cls) != null)
      const list = classCtx ? valid : valid.length === tokens.length ? valid : []
      for (const t of list) {
        const c = canonical(t.cls)
        if (c === t.cls) continue
        const safe = normalizedCss(c) === normalizedCss(t.cls)
        add({ line: lineOf(t.pos), rule: ACCEPTED.has(`${rel}:${t.cls}`) ? 'accepted (reviewed)' : safe ? 'suggestCanonicalClasses' : 'needs review (canonical CSS differs)', cls: t.cls, msg: `can be written as \`${c}\`` })
        if (safe) (edits.get(file) ?? edits.set(file, []).get(file)).push({ pos: t.pos, from: t.cls, to: c })
      }
      for (const { tok, others } of conflicts(list)) {
        add({ line: lineOf(tok.pos), rule: 'cssConflict', cls: tok.cls, msg: `applies the same CSS properties as ${others.map((o) => `'${o}'`).join(', ')}` })
      }
      if (classCtx) {
        for (const t of tokens) {
          if (toCss(t.cls) != null) continue
          const why = nearMiss(t.cls)
          if (why) add({ line: lineOf(t.pos), rule: 'needs review (not a Tailwind class)', cls: t.cls, msg: why })
        }
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// ---- output -----------------------------------------------------------------------------

if (FIX) {
  for (const [file, list] of edits) {
    let src = fs.readFileSync(file, 'utf8')
    for (const e of list.sort((a, b) => b.pos - a.pos)) src = src.slice(0, e.pos) + e.to + src.slice(e.pos + e.from.length)
    fs.writeFileSync(file, src)
  }
  const n = [...edits.values()].reduce((s, l) => s + l.length, 0)
  console.log(`Fixed ${n} class(es) in ${edits.size} file(s). Re-run without --fix to see what's left.`)
  process.exit(0)
}

const byFile = Object.groupBy(findings, (f) => f.file)
for (const [file, list] of Object.entries(byFile)) {
  console.log(`\n${file}`)
  for (const [rule, items] of Object.entries(Object.groupBy(list, (f) => f.rule))) {
    console.log(`  ${rule} (${items.length})`)
    for (const f of items.sort((a, b) => a.line - b.line)) console.log(`    ${file}:${f.line}  ${f.cls}  ${f.msg}`)
  }
}
const counts = Object.entries(Object.groupBy(findings, (f) => f.rule)).map(([r, l]) => `${r}: ${l.length}`)
// Unparseable classes aren't IntelliSense warnings, so they're informational only
const failing = findings.filter((f) => !f.rule.includes('not a Tailwind class') && !ACCEPTED.has(`${f.file}:${f.cls}`))
console.log(findings.length ? `\n${findings.length} finding(s) — ${counts.join(', ')}` : 'No Tailwind class warnings.')
console.log(failing.length ? `${failing.length} not yet fixed or accepted.` : 'Nothing left to fix (anything listed above is reviewed/accepted).')
process.exit(failing.length ? 1 : 0)
