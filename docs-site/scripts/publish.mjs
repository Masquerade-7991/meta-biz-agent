// Publishes docs edits (the in-browser editor's, or anyone's) to the hosted docs: commits only the
// pages and uploaded images, pushes main, and waits until the hosted site serves that commit.
//   npm run docs:publish             (from the repo root; `npm run publish-docs` in docs-site)
//   npm run docs:publish -- --dry-run   shows what would be published, changes nothing
// Refuses on another branch, with other files already staged, or when a page wouldn't build or
// wouldn't round-trip through the editor.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DOCS = path.resolve(import.meta.dirname, '..')
const REPO = path.resolve(DOCS, '..')
const { siteUrl } = await import('../lib/shared.ts').catch(() => ({ siteUrl: 'https://helo-docs.vercel.app' }))
// Only folders that exist: git refuses a whole command over a missing path (no uploads yet).
const PATHS = ['docs-site/content', 'docs-site/public/uploads'].filter((p) => existsSync(path.join(REPO, p)))
const dryRun = process.argv.includes('--dry-run')
const WAIT_MS = 5 * 60_000

// Right-trim only: `git status --porcelain` lines start with a significant space (" M file").
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trimEnd()
const stop = (message) => {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

// ---- what changed ----
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') stop(`You're on "${branch}". The hosted docs build from main: switch to main first (git switch main).`)

const changes = git('status', '--porcelain', '--untracked-files=all', '--', ...PATHS)
  .split('\n')
  .filter(Boolean)
  .map((l) => ({ code: l.slice(0, 2), file: l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() }))
if (!changes.length) {
  console.log('Nothing to publish: no page or uploaded image has changed.')
  process.exit(0)
}
const otherStaged = git('diff', '--cached', '--name-only')
  .split('\n')
  .filter((f) => f && !PATHS.some((p) => f.startsWith(p + '/')))
if (otherStaged.length) stop(`Other files are already staged (${otherStaged.slice(0, 3).join(', ')}${otherStaged.length > 3 ? '…' : ''}). Commit or unstage them first, so they don't go out with the docs.`)

// ---- checks ----
const pages = changes.filter((c) => /\.mdx?$/.test(c.file))
const titleOf = (file) => readFileSync(path.join(REPO, file), 'utf8').match(/^---\n[\s\S]*?^title:\s*(.+)$[\s\S]*?^---$/m)?.[1]?.trim()
for (const c of pages) {
  if (c.code.includes('D')) continue
  const src = readFileSync(path.join(REPO, c.file), 'utf8')
  // A page must start with its frontmatter, with a title: the site's navigation and search need it.
  if (!/^---\n[\s\S]*?\n---(\n|$)/.test(src) || !titleOf(c.file)) stop(`${c.file}: its frontmatter (the title block at the top) is missing or broken. Open it in the editor's MDX view and fix the first lines.`)
}
const check = spawnSync(process.execPath, [path.join(DOCS, 'scripts/check-roundtrip.mjs')], { cwd: DOCS, encoding: 'utf8' })
if (check.status !== 0) stop(`A page wouldn't survive the editor:\n${check.stdout}${check.stderr}`)

// ---- what will go out ----
const urlOf = (file) => {
  const rel = path.relative('docs-site/content/docs', file).replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')
  return `${siteUrl}/docs${rel ? '/' + rel : ''}`
}
const label = { 'A ': 'new', '??': 'new', ' M': 'changed', 'M ': 'changed', MM: 'changed', ' D': 'deleted', 'D ': 'deleted', RM: 'renamed', 'R ': 'renamed' }
console.log(`Publishing to ${siteUrl}:`)
for (const c of changes) console.log(`  ${(label[c.code] ?? c.code.trim()).padEnd(8)} ${c.file}`)
if (dryRun) {
  console.log('\nDry run: nothing was committed or pushed.')
  process.exit(0)
}

// ---- commit, sync, push ----
git('add', '-A', '--', ...PATHS)
const titles = [...new Set(pages.filter((c) => !c.code.includes('D')).map((c) => titleOf(c.file)).filter(Boolean))]
const images = changes.filter((c) => c.file.startsWith('docs-site/public/uploads/')).length
const subject = `Docs: ${titles.length ? titles.slice(0, 4).join(', ') + (titles.length > 4 ? ` and ${titles.length - 4} more` : '') : 'pages'}${images ? ` (${images} image${images > 1 ? 's' : ''})` : ''}`
git('commit', '-m', subject, '--', ...PATHS)
// Bring in main only when GitHub has moved on: a rebase also has to set aside every other uncommitted
// file, which can fail for reasons that have nothing to do with the docs.
spawnSync('git', ['fetch', 'origin', 'main'], { cwd: REPO })
const behind = Number(git('rev-list', '--count', 'HEAD..origin/main')) > 0
const pull = behind ? spawnSync('git', ['pull', '--rebase', '--autostash', 'origin', 'main'], { cwd: REPO, encoding: 'utf8' }) : { status: 0, stderr: '' }
if (pull.status !== 0) {
  spawnSync('git', ['rebase', '--abort'], { cwd: REPO })
  stop(`Couldn't bring in the latest main (someone changed the same lines?). Your edit is committed locally; run "git pull --rebase", resolve, then publish again.\n${pull.stderr}`)
}
const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: REPO, encoding: 'utf8' })
if (push.status !== 0) stop(`Push failed: your edit is committed locally. ${push.stderr.trim()}`)
const commit = git('rev-parse', 'HEAD')
console.log(`\nPushed ${commit.slice(0, 7)} "${subject}". Waiting for ${siteUrl} to build it (about 1–2 minutes)…`)

// ---- wait for the hosted site ----
const until = Date.now() + WAIT_MS
for (;;) {
  const live = await fetch(`${siteUrl}/version.json`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (live?.commit === commit) break
  if (Date.now() > until) stop(`The hosted docs aren't serving ${commit.slice(0, 7)} after 5 minutes. Check the build: https://vercel.com/soumikchoudhury-7216s-projects/helo-docs/deployments (a failed build leaves the previous version live).`)
  await new Promise((done) => setTimeout(done, 10_000))
  process.stdout.write('.')
}
console.log('\n✔ Live:')
for (const c of pages.filter((p) => !p.code.includes('D'))) console.log(`  ${urlOf(c.file)}`)
if (!pages.length) console.log(`  ${siteUrl}/docs`)
