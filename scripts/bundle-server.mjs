// Bundles the API (server/vercel.ts and everything it imports) into api/_server/app.mjs for the
// Vercel Function in api/server.mjs. Vercel doesn't resolve our `.ts` import paths at runtime, so
// our own code becomes one plain JS file; npm packages (mongodb, nodemailer) stay as imports and are
// shipped from node_modules. The email images are copied next to it (mail.ts reads them from there).
import { build } from 'rolldown'
import { cpSync, rmSync } from 'node:fs'

const out = 'api/_server'
rmSync(out, { recursive: true, force: true })
await build({
  input: 'server/vercel.ts',
  platform: 'node',
  // Bare specifiers (npm packages, node: built-ins) stay imports; only our own files are bundled.
  external: [/^[^./]/],
  output: { file: `${out}/app.mjs`, format: 'esm' },
  logLevel: 'warn',
})
cpSync('server/assets', `${out}/assets`, { recursive: true })
console.log(`API bundled into ${out}/app.mjs`)
