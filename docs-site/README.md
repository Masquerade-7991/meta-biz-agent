# Helo.ai docs

The documentation site for the Helo.ai console (Fumadocs on Next.js). Its own app, with its own install and deploy.

```bash
npm install
npm run dev     # http://localhost:3000/docs
npm run build
```

- Pages: `content/docs/guide` (for customers) and `content/docs/developers` (for engineers). `meta.json` sets the order.
- API reference: generated at build time from the console's `../docs/openapi.json` (`lib/openapi.ts`). Run `npm run docs:openapi` at the repo root after changing a route.
- Look: the console's tokens (`src/styles/theme.css`) mapped onto Fumadocs' colours in `app/global.css`.
- Deploy: a separate Vercel project with root directory `docs-site`, keeping "Include files outside the root directory" on so the spec is readable.
