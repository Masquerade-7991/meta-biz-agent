# Helo.ai docs

The documentation site for the Helo.ai console (Fumadocs on Next.js). Its own app, with its own install and deploy.

```bash
npm install
npm run dev     # http://localhost:3000/docs
npm run build
```

- Pages: `content/docs/guide` (for customers) and `content/docs/developers` (for engineers). `meta.json` sets the order.
- API reference: generated at build time from the console's `../docs/openapi.json` (`lib/openapi.ts`). Run `npm run docs:openapi` at the repo root after changing a route.
- Editing in the browser: `npm run edit` (or `npm run docs:edit` from the repo root) opens Fumadocs Studio at http://localhost:5180 on `content/docs`; edits save to the MDX files, publish with a commit. Uploaded images go to `public/uploads`. Run `npm run check:editor` after upgrading `@fumadocs-editor/*` (pinned): it proves every page opens as rich content and saves back unchanged. "Open in GitHub" in each page's Open menu opens the file in GitHub's web editor, from any browser. See the Developers › Editing the docs page.
- Screenshots: `node docs-site/scripts/screenshots.mjs [names]` retakes them from the console in Dummy mode into `public/screens/`.
- Guide rule: WhatsApp facts come from Meta's docs (cite with a Source line), product steps from the console; our own words.
- Typography: Inter (body), Plus Jakarta Sans (headings), JetBrains Mono (code), loaded in `app/layout.tsx`; sizes, greys and the 720px reading column are tokens in `app/global.css`. Technical terms go in `code`, not italics.
- Look: the console's tokens (`src/styles/theme.css`) mapped onto Fumadocs' colours in `app/global.css`.
- Hosted at https://helo-docs.vercel.app (Vercel project `helo-docs`, root directory `docs-site`, files outside the root included so the spec is readable). `vercel.json` here and at the repo root skip builds that don't concern each project. Publish edits with `npm run docs:publish` (commits only pages and uploads, pushes, waits for the hosted site to serve the commit; `/version.json` shows it).
