# Setting up a documentation site with Fumadocs

This is how the Helo.ai docs site (`docs-site/`, live at <https://helo-docs.vercel.app>) is built. Follow it to set up another product's docs the same way, so every Helo.ai docs site looks, reads and behaves alike.

It covers:

1. [Tech stack](#1-tech-stack) (exact versions)
2. [Project layout](#2-project-layout)
3. [Step-by-step setup](#3-step-by-step-setup), with every config file
4. [Content structure and writing rules](#4-content-structure-and-writing-rules)
5. [Frontend requirements](#5-frontend-requirements): brand tokens, typography, backdrop, layout, accessibility
6. [The API reference](#6-the-api-reference) (OpenAPI, Meta-style layout, Try in Playground)
7. [The API server's side](#7-what-the-api-server-must-do-for-try-in-playground) of Try in Playground
8. [Machine-readable docs](#8-machine-readable-docs-search-and-social-images) (llms.txt, Markdown, OG images) and search
9. [The in-browser editor](#9-the-in-browser-editor-fumadocs-studio) (Fumadocs Studio)
10. [Deploying on Vercel](#10-deploying-on-vercel)
11. [Checks before publishing](#11-checks-before-publishing)
12. [Known pitfalls](#12-known-pitfalls)
13. [Replication checklist](#13-replication-checklist)

The source of truth is always the code in `docs-site/`. When this guide and the code disagree, the code wins; fix this guide.

---

## 1. Tech stack

| Layer | Package | Version | Why |
| --- | --- | --- | --- |
| Runtime | Node.js | 24.x (24.5 tested) | Runs Next 16 and the `.ts` scripts directly |
| Package manager | npm | 11.x | One lockfile per app (`docs-site/package-lock.json`) |
| Framework | `next` | `16.3.8` | App Router, static generation, route handlers |
| UI runtime | `react`, `react-dom` | `^19.3.0` | Required by Next 16 and Fumadocs 16 |
| Docs core | `fumadocs-core` | `16.17.1` (pinned) | Page tree, search, source loader, Markdown negotiation, llms.txt |
| Docs UI | `fumadocs-ui` → `npm:@fumadocs/base-ui@16.17.1` | pinned alias | The Base UI build of Fumadocs UI (layouts, sidebar, TOC, Cards, Steps, Tabs, Accordions, Callout, OG images) |
| MDX | `fumadocs-mdx` | `15.4.7` (pinned) | Compiles `content/docs/**/*.mdx`; used through `fumadocs-mdx/macro` |
| API reference | `fumadocs-openapi` | `^12.4.1` | Generates pages from an OpenAPI 3.1 file, with code samples and a playground |
| Code highlighting | `shiki` | `^4.5.0` | Syntax colours in code blocks and API samples |
| Icons | `lucide-react` | `^1.50.0` | The same icon set as the console; also used for sidebar icons |
| Class helper | `cn` | `^0.4.0` | `cn()` for conditional class names (`lib/cn.ts`) |
| Styling | `tailwindcss`, `@tailwindcss/postcss`, `postcss` | `^4.3.3`, `^4.3.3`, `^8.5.28` | Tailwind 4 through PostCSS, theme tokens with `@theme` |
| Types | `typescript` | `^7.0.2` | `strict`, `moduleResolution: bundler` |
| Types | `@types/mdx`, `@types/node`, `@types/react`, `@types/react-dom` | as in `package.json` | |
| Editor (dev only) | `@fumadocs-editor/core`, `@fumadocs-editor/studio`, `@fumadocs-editor/ui` | `0.4.1`, `0.2.4`, `0.5.1` (pinned) | Fumadocs Studio, the in-browser MDX editor |
| Fonts | `next/font/google` | built in | Inter, Plus Jakarta Sans, JetBrains Mono, self-hosted by Next |
| Hosting | Vercel | | One Vercel project per docs site |
| Screenshots (optional) | `playwright-core` (+ `sharp`) | root workspace | `scripts/screenshots.mjs` captures product screens as `.webp` |

**Pin the Fumadocs packages exactly** (`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx` and the `@fumadocs-editor/*` packages). They move fast, and the editor round-trip check (§9) only holds for the versions it was run against. Upgrade them together, on purpose, then run every check in §11.

**`fumadocs-ui` is an alias.** Install it as `"fumadocs-ui": "npm:@fumadocs/base-ui@16.17.1"`, so every `import … from 'fumadocs-ui/…'` resolves to the Base UI build.

**Next 16 is not the Next.js most examples show.** Read the guides in `node_modules/next/dist/docs/` before writing Next code. `next dev` writes an `AGENTS.md` (and a `CLAUDE.md` that includes it) into the app saying this; keep them git-ignored (local AI-tool notes, not part of the public repo).

---

## 2. Project layout

The docs site is its own app inside the product repo, with its own install, build and Vercel project. The product's root lint ignores it.

```text
docs-site/
├── app/
│   ├── layout.tsx                    # <html>, fonts, metadata, RootProvider
│   ├── global.css                    # Tailwind, Fumadocs presets, brand tokens, typography, backdrop
│   ├── not-found.tsx                 # Branded 404 with a way on
│   ├── (home)/
│   │   ├── layout.tsx                # HomeLayout
│   │   └── page.tsx                  # Landing page: sections, common tasks, search
│   ├── docs/
│   │   ├── layout.tsx                # DocsLayout with the page tree
│   │   └── [[...slug]]/page.tsx      # Renders MDX pages and OpenAPI pages
│   ├── api/search/route.ts           # Search index (Orama, built in)
│   ├── llms.txt/route.ts             # Index for AI tools
│   ├── llms-full.txt/route.ts        # Every page as one Markdown file
│   ├── llms.mdx/docs/[[...slug]]/route.ts   # One page as Markdown
│   ├── og/docs/[...slug]/route.tsx   # Social preview image per page
│   └── version.json/route.ts         # The commit this deployment was built from
├── components/
│   ├── mdx.tsx                       # The MDX components pages may use
│   └── api-page.tsx                  # The API reference layout and playground
├── content/docs/                     # The pages (MDX) and their order (meta.json)
│   ├── index.mdx
│   ├── meta.json
│   ├── guide/                        # For customers
│   └── developers/                   # For engineers, including api/ (generated reference)
├── lib/
│   ├── shared.ts                     # Site name, URL, routes, GitHub location
│   ├── layout.shared.tsx             # Nav title (logo + name), shared by every layout
│   ├── source.ts                     # Content loader, OpenAPI pages, llms renderer
│   ├── openapi.ts                    # Reads the OpenAPI file, sets servers and security
│   └── cn.ts                         # export { cn } from 'cn'
├── public/
│   ├── favicon.svg
│   ├── helo-mark.svg                 # The logo mark in the nav
│   ├── screens/*.webp                # Product screenshots used in pages
│   ├── samples/                      # Downloadable samples (e.g. CSV)
│   └── uploads/                      # Images added through the in-browser editor
├── scripts/
│   ├── check-roundtrip.mjs           # Every page survives an editor save unchanged
│   ├── publish.mjs                   # Commit pages, push, wait for the live site
│   └── screenshots.mjs               # Retake product screenshots
├── proxy.ts                          # Serves Markdown when an AI tool asks for it
├── fumadocs-studio.config.ts         # In-browser editor config (runs in the browser)
├── studio.server.ts                  # In-browser editor's Node-only options (uploads)
├── next.config.mjs
├── postcss.config.mjs
├── tsconfig.json
├── vercel.json
├── package.json
├── README.md
└── AGENTS.md / CLAUDE.md             # Written by next dev for AI tools; git-ignored, local only
```

There is **no `source.config.ts`**. Content is declared in `lib/source.ts` with `defineDocs` from `fumadocs-mdx/macro`.

---

## 3. Step-by-step setup

### 3.1 Create the app

```bash
mkdir docs-site && cd docs-site
npm init -y
npm install next@16.3.8 react@^19.3.0 react-dom@^19.3.0 \
  fumadocs-core@16.17.1 fumadocs-mdx@15.4.7 "fumadocs-ui@npm:@fumadocs/base-ui@16.17.1" \
  fumadocs-openapi@^12.4.1 shiki@^4.5.0 lucide-react@^1.50.0 cn@^0.4.0
npm install -D typescript@^7.0.2 tailwindcss@^4.3.3 @tailwindcss/postcss@^4.3.3 postcss@^8.5.28 \
  @types/mdx @types/node @types/react @types/react-dom \
  @fumadocs-editor/core@0.4.1 @fumadocs-editor/studio@0.2.4 @fumadocs-editor/ui@0.5.1
```

Skip `fumadocs-openapi` if the product has no API. Skip the `@fumadocs-editor/*` packages if nobody will edit in the browser.

### 3.2 `package.json`

```json
{
  "name": "docs-site",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "dev": "next dev",
    "start": "next start",
    "types:check": "next typegen && tsc --noEmit",
    "edit": "fumadocs-studio",
    "check:editor": "node scripts/check-roundtrip.mjs",
    "publish-docs": "node scripts/publish.mjs"
  }
}
```

At the product's repo root, add shortcuts so nobody has to `cd`: `docs:edit`, `docs:check`, `docs:publish`, and `docs:openapi` (which writes the OpenAPI file, §6.1).

### 3.3 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 3.4 `next.config.mjs`

```js
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Its own app inside the product's repo: don't let Next pick the product's lockfile as the root.
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
};

export default withMDX(config);
```

### 3.5 `postcss.config.mjs`

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

### 3.6 `.gitignore`

```text
/node_modules
.source
/.next/
/out/
/build
/coverage
*.tsbuildinfo
next-env.d.ts
.env*
.vercel
.DS_Store
*.pem
```

`.source` is generated by `fumadocs-mdx`. Never commit it.

### 3.7 `lib/shared.ts`: names, routes and the GitHub location

```ts
import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'Helo.ai docs';                         // change per product
export const siteUrl = 'https://helo-docs.vercel.app';          // the live URL
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

/** "Open in GitHub" in each page's Open menu opens the file in GitHub's web editor. */
export const gitConfig = { user: '<github-owner>', repo: '<repo>', branch: 'main', contentDir: 'docs-site/content/docs' };

const getContentUrl = createGetUrl(docsContentRoute);
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];
  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);
export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];
  return { segments, url: getImageUrl(segments, page.locale) };
}
```

### 3.8 `lib/source.ts`: the content loader

```ts
import { llms, loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { docsRoute } from './shared';
import { openapi } from './openapi'; // only with an API reference

const docs = defineDocs({
  dir: 'content/docs',
  docs: { schema: pageSchema, postprocess: { includeProcessedMarkdown: true } },
  meta: { schema: metaSchema },
});

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // One page per API area (the spec's tags). Tag names like "Tickets & support" become plain
    // slugs (tickets-support): `&` and brackets in a URL path break links.
    openapi: await openapi.staticSource({
      baseDir: 'developers/api',
      per: 'tag',
      slugify: (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    }),
  },
  { baseUrl: docsRoute, plugins: [lucideIconsPlugin(), openapi.loaderPlugin()] },
);

export const docsLlms = llms(source, {
  renderPage: async (page) => {
    if (page.type === 'openapi') return `# ${page.data.title} (${page.url})\n\n${JSON.stringify(page.data.getSchema().bundled, null, 2)}`;
    return `# ${page.data.title} (${page.url})\n\n${await page.data.getText('processed')}`;
  },
});
```

Without an API reference, drop the `openapi` source, the `loaderPlugin()` and the `page.type === 'openapi'` branch.

### 3.9 `lib/layout.shared.tsx`: the nav title

```tsx
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 text-[15px] font-semibold text-(--text-strong)">
          <img src="/helo-mark.svg" alt="" width={20} height={23} />
          {appName}
        </span>
      ),
    },
  };
}
```

`lib/cn.ts` is one line: `export { cn } from 'cn';`.

### 3.10 `app/layout.tsx`: fonts, metadata, provider

```tsx
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { Metadata } from 'next';
import { siteUrl } from '@/lib/shared';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { template: '%s · Helo.ai docs', default: 'Helo.ai docs' },
  description: '<one sentence about the product>',
  icons: '/favicon.svg',
};

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-inter' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['600', '700'], display: 'swap', variable: '--font-jakarta' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-jetbrains' });

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
```

`suppressHydrationWarning` is needed because the theme (light/dark) is set on `<html>` before React loads.

### 3.11 Layouts

`app/docs/layout.tsx`:

```tsx
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return <DocsLayout tree={source.getPageTree()} {...baseOptions()}>{children}</DocsLayout>;
}
```

`app/(home)/layout.tsx`:

```tsx
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
}
```

### 3.12 `app/docs/[[...slug]]/page.tsx`: one renderer for both page types

```tsx
import { source } from '@/lib/source';
import { DocsBody, DocsDescription, DocsPage, DocsTitle, MarkdownCopyButton, ViewOptionsPopover } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { getPageImageUrl, getPageMarkdownUrl, gitConfig } from '@/lib/shared';
import { OpenAPIPage } from '@/components/api-page';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  if (page.type === 'openapi') {
    return (
      <DocsPage full>
        <DocsTitle>{page.data.title}</DocsTitle>
        {/* Full width and a container, so each endpoint's code samples sit pinned beside it. */}
        <DocsBody className="@container max-w-none!">
          <OpenAPIPage {...page.data.getOpenAPIPageProps()} />
        </DocsBody>
      </DocsPage>
    );
  }

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/edit/${gitConfig.branch}/${gitConfig.contentDir}/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description, openGraph: { images: getPageImageUrl(page).url } };
}
```

Every page is statically generated (`generateStaticParams`). `createRelativeLink` lets pages link to each other by file path.

### 3.13 `components/mdx.tsx`: the components pages may use

```tsx
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import type { MDXComponents } from 'mdx/types';

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Accordion, Accordions, Step, Steps, Tab, Tabs, ...components } satisfies MDXComponents;
}
export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
```

(`defaultMdxComponents` already brings `Callout`, `Cards`/`Card`, code blocks, headings and images.) **Any new component must also get a spec in `fumadocs-studio.config.ts`** (§9), or the in-browser editor shows it as raw source.

---

## 4. Content structure and writing rules

### 4.1 Sections and order

`content/docs/meta.json` lists the top level:

```json
{ "pages": ["index", "guide", "developers"] }
```

Each section is a **root folder**, which gives it its own entry in the sidebar's section switcher:

```json
{
  "title": "Guide",
  "description": "Using the console",
  "root": true,
  "icon": "BookOpen",
  "pages": ["index", "connect-number", "build-agent", "---Support desk---", "inbox", "tickets", "---Workspace---", "settings", "---Help---", "troubleshooting", "glossary"]
}
```

- `root: true` makes the folder a section.
- `icon` is a lucide icon name (resolved by `lucideIconsPlugin()`).
- `"---Label---"` adds a group heading in the sidebar.
- `"..."` means "every other page here, alphabetically" (the API reference uses `["index", "..."]`).

Sections we use: **Guide** (customers), **Developers** (engineers), with **API reference** under Developers › Reference.

### 4.2 Page frontmatter

```mdx
---
title: Tickets
description: One ticket per customer issue, with response targets, escalation and a full history.
---
```

`title` is the page's H1, so pages don't repeat it. `description` shows under the title, in search, in the social image and in llms.txt. Keep it to one sentence.

### 4.3 Components in use

| Component | Use it for |
| --- | --- |
| `<Steps>` / `<Step>` | Procedures. One action per step. |
| `<Accordions>` / `<Accordion title="…">` | FAQs and optional detail |
| `<Callout type="info\|warn\|error">` | Something the reader must not miss. Use sparingly. |
| `<Cards>` / `<Card title href>` | Section landing pages |
| `<Tabs items={[…]}>` / `<Tab>` | Same task, different variants |
| Images `![alt](/screens/name.webp)` | Product screenshots, always with real alt text |

### 4.4 Writing rules

- **Write for the reader of that section.** Guide pages are for business users: say what to do and what they'll see. Developer pages are for engineers: give file paths, commands and why.
- **Facts about third parties come from their docs**, cited with a *Source* line. Product steps come from the product. Use our own words.
- **Exact UI strings.** Bold the labels people click, written exactly as the product shows them (**Settings › API tokens**).
- **Technical terms go in `code`**, not italics: routes, fields, env vars, file names.
- **Structure:** an intro line, then **Before you start**, the task sections, then **If something goes wrong** as a table of the error message and what to do.
- **Screenshots** are `.webp` in `public/screens/`, taken from the product in its demo mode (`scripts/screenshots.mjs`). Retake them when the screen changes.
- **Customer-visible change → doc change.** When a feature changes what customers see, update its page in the same change.

---

## 5. Frontend requirements

### 5.1 Global CSS order (`app/global.css`)

```css
@import 'tailwindcss';
@import 'fumadocs-ui/css/neutral.css';
@import 'fumadocs-ui/css/preset.css';
@import 'fumadocs-openapi/css/preset.css';   /* only with an API reference */
```

Then, in this order: brand tokens (§5.2), the backdrop (§5.4), typography (§5.3), surfaces and components (§5.5).

### 5.2 Brand colour tokens

These map the product's own tokens (the console's `src/styles/theme.css`) onto Fumadocs' colour variables:

- Neutral greys and hairline borders.
- **Helo blue for actions, links and focus.**
- **Helo red only in the logo**, never in UI.

| Token | Light | Dark |
| --- | --- | --- |
| `--color-fd-background` | `#ffffff` | `#121315` |
| `--color-fd-foreground` | `#1f2937` | `#f3f4f6` |
| `--color-fd-muted` | `#f4f4f2` | `#1f2023` |
| `--color-fd-muted-foreground` | `#4b5563` | `#9ca3af` |
| `--color-fd-popover` | `#ffffff` | `#1b1c1f` |
| `--color-fd-popover-foreground` | `#1f2937` | `#ececea` |
| `--color-fd-card` | `#fafaf9` | `#17181b` |
| `--color-fd-card-foreground` | `#1f2937` | `#ececea` |
| `--color-fd-border` | `#e7e6e3` | `#2a2b2f` |
| `--color-fd-primary` | `#2270d0` | `#4c93ea` |
| `--color-fd-primary-foreground` | `#ffffff` | `#0b1220` |
| `--color-fd-secondary` | `#f4f4f2` | `#232427` |
| `--color-fd-secondary-foreground` | `#1c1b19` | `#ececea` |
| `--color-fd-accent` | `#eef4fc` | `#1a2a40` |
| `--color-fd-accent-foreground` | `#1d64bd` | `#8fbcf5` |
| `--color-fd-ring` | `#2270d0` | `#4c93ea` |

The light values go in `@theme { … }`; the dark ones in `.dark { … }`. In dark mode the sidebar gets slightly lifted values (`.dark #nd-sidebar`: muted `#1f2023`, secondary `#232427`, muted-foreground `#b4b4af`). The global radius is `:root { --radius: 10px; }`.

For another product, swap in its own primary and accent, but keep the greys, the hairline border and the rule that the brand red never appears in UI.

### 5.3 Typography

**Faces** (loaded in `app/layout.tsx`, stacks built in `@theme`):

```css
--font-sans: var(--font-inter), system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
--font-display: var(--font-jakarta), var(--font-sans);
--font-mono: var(--font-jetbrains), 'Fira Code', SFMono-Regular, Consolas, monospace;
```

- Inter (400/500/600) for body text.
- Plus Jakarta Sans (600/700) for headings and display.
- JetBrains Mono (400/500) for code.

**Text colour tokens.** Every rule reads these; dark mode only swaps the tokens.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--text-strong` | `#1f2937` | `#f3f4f6` | Headings, bold, the nav title |
| `--text-body` | `#374151` | `#d1d5db` | Body copy |
| `--text-secondary` | `#4b5563` | `#9ca3af` | Descriptions, sidebar links |
| `--text-label` | `#6b7280` | `#9ca3af` | Group labels, TOC links |
| `--text-muted` | `#9ca3af` | `#6b7280` | **Decoration only**: below AA for text |
| `--code-fg` | `#dc2626` | `#f87171` | Inline code |
| `--measure` | `720px` | | Reading column width |

**Scale:**

| Element | Font | Size / line height | Weight | Other |
| --- | --- | --- | --- | --- |
| Page title (`#nd-page h1`) | display | `clamp(32px, 2.2vw + 1rem, 36px)` / 1.2 | 700 | letter-spacing −0.025em, `--text-strong` |
| Page description (`h1 + p`) | sans | 18px / 1.5 | 400 | `--text-secondary` |
| `h2` in prose | display | 24px / 1.3 | 600 | −0.01em; 2.5em above, 0.75em below |
| `h3` in prose | display | 18px / 1.3 | 600 | 2em above, 0.5em below |
| Body (`.prose`) | sans | 16px / 1.6 | 400 | `--text-body` |
| Inline code | mono | 0.85em | 500 | `--code-fg` on a 3% tint, 1px border at 18% tint, 4px radius, padding 0.1em 0.35em, no backticks |
| Code blocks | mono | 13.5px / 1.6 | | Shiki colours on `--color-fd-card` |
| Sidebar links | sans | 14px | 400; active 600 in primary | |
| Sidebar group labels | sans | 13px | 500 | `--text-label` |
| TOC title | sans | 12px uppercase | 500 | letter-spacing 0.06em |
| TOC links | sans | 13px / 1.4 | 400; active 500 in primary | `text-wrap: pretty` |
| Page action buttons | sans | 14px | 500 | no uppercase |

**Reading column:** title, description, actions and `.prose` are at most `var(--measure)` (720px) wide on every screen. API reference pages are the exception: their body is full width (§6.3).

Copy the typography block of `docs-site/app/global.css` as is. It's all token-driven.

### 5.4 Backdrop

One quiet, fixed field behind every screen, made only of CSS and inline SVG data URIs (no image requests):

1. **`body`**: four soft radial washes in the corners (`--bd-wash-a/b/c`: Helo blue, a cool violet, a warm sand), with `background-attachment: fixed`.
2. **`body::before`**: a fine dot grid with an isometric lattice (`--bd-pattern`, a 56×97 tile), masked away from the reading area: `mask-image: radial-gradient(ellipse 50% 60% at 52% 45%, transparent 30%, #000 95%)`.
3. **`body::after`**: outline geometry in two corners (`--bd-shapes-tr`: hexagons and a dotted arc; `--bd-shapes-bl`: rings and a triangle) plus a soft glow. On docs pages (`body:has(#nd-docs-layout)::after`) the hexagons move to the bottom right, because the TOC fills the top right.
4. **`html::after`**: film grain (`feTurbulence` noise, `--bd-grain`) at `--bd-grain-opacity` (0.2 light, 0.16 dark). It dithers the gradients so they never band.

All four layers are `position: fixed; inset: 0; z-index: -1; pointer-events: none`. Every colour and opacity is a `--bd-*` token with its own dark value. Copy the exact data URIs from `docs-site/app/global.css`, and recolour the SVG `stroke` for another brand.

### 5.5 Surfaces and components

- **Sidebar:** translucent, so the backdrop reads through: `color-mix(in oklab, var(--color-fd-card) 70%, transparent)` with `backdrop-filter: blur(14px) saturate(1.2)`.
- **Page and layout** (`#nd-page`, `#nd-docs-layout`) are transparent.
- **Content that must stay legible is solid:** code blocks and tables are on `--color-fd-card`; tables have a 10px radius.
- **Cards** (`a[data-card="true"]`):
  - Translucent card (75%) with an 8px blur and a hairline border.
  - On hover: lifts 1px, the border tints toward primary and the shadow is `0 1px 2px rgb(28 27 25 / .04), 0 10px 28px -12px rgb(34 112 208 / .25)`.
  - The lift is removed under `prefers-reduced-motion`.
- **Screenshots** (`.prose img`): framed like a window, with a 1px border, a 10px radius and the shadow `0 1px 2px rgb(28 27 25 / .04), 0 12px 32px -16px rgb(28 27 25 / .18)`.
- **Focus:** `:focus-visible { outline-color: var(--color-fd-ring); }`.
- **No layout shift:**
  - `html { scrollbar-gutter: stable; }`.
  - When a dialog locks scrolling, keep the margin: `html > body[data-scroll-locked] { margin-right: 0 !important; --removed-body-scroll-bar-size: 0px !important; }`.
- **Dark code comments:** Shiki's comment grey is 3.7:1 on the dark background; lift it to AA with `.dark .shiki code span[style][style*='--shiki-dark:#6A737D'] { color: #9ca3af; }`.

### 5.6 Landing page (`app/(home)/page.tsx`)

- **Hero:**
  - A pill line with a primary dot.
  - An H1 in the display font: `text-4xl sm:text-5xl`, `tracking-tight`, `text-balance`, max-w-2xl.
  - One supporting sentence.
- **Search:** `<FullSearchTrigger />` (from `fumadocs-ui/layouts/shared/slots/search-trigger`), `max-w-md`, translucent card.
- **Sections:** two cards (Guide, Developers) in a `sm:grid-cols-2` grid. Each has a lucide icon in primary, a title with an arrow that nudges on hover, and one line of body.
- **Common tasks:** links straight to the most-used guide pages.
- **Container:** `max-w-4xl`, `px-4`, `pt-20 sm:pt-28`, `pb-24`.

### 5.7 404 page (`app/not-found.tsx`)

The 404 uses `HomeLayout`, so it gets the same header and backdrop. It has:

- a "404" eyebrow in primary
- the heading "This page doesn’t exist"
- one line saying what to do
- two section cards (Guide, Developers)
- a "Back to the docs home" link

Never show Next's bare 404.

### 5.8 Accessibility and quality bar

- Text contrast meets **WCAG AA** in light and dark mode. `--text-muted` is never used for readable text.
- Every image has meaningful `alt` text. The decorative logo in the nav has `alt=""`.
- Decorative icons get `aria-hidden`. Lists of links get an `aria-label` (e.g. `<nav aria-label="Endpoints">`).
- Everything works by keyboard, with a visible focus ring.
- Motion respects `prefers-reduced-motion`.
- Layouts work from 360px wide upward. The reference's two columns stack on narrow screens.
- Light and dark mode both work; the toggle comes from Fumadocs' layout.
- No horizontal page scroll. Wide tables scroll inside their own box.

---

## 6. The API reference

### 6.1 Source: one OpenAPI 3.1 file

The product writes its spec to a committed file (here `docs/openapi.json`, written by `npm run docs:openapi` at the repo root). The docs site reads it at build time. Requirements for the spec:

- Every operation has an `operationId`, a `summary` (shown in the endpoints table and as the playground's title), and a `tags` entry. **One tag = one reference page.**
- Readable tag names ("Tickets & support"). Set `x-displayName` to the same name, or Fumadocs re-splits it ("A I help").
- Every response status has a `description`. Error bodies share one schema (ours is `{title, detail, status}`).
- Request bodies mark required fields with `required`. Fields have `description`, `enum`, `default` and limits (`maxLength`, `minimum`) where they apply. All of these show in the reference.
- A security scheme the browser can use, e.g. `apiToken: {type: http, scheme: bearer}` (§7).

### 6.2 `lib/openapi.ts`

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createOpenAPI } from 'fumadocs-openapi/server';

export const openapi = createOpenAPI({
  input: {
    console: async () => {
      const doc = JSON.parse(await readFile(path.resolve(process.cwd(), '../docs/openapi.json'), 'utf8'));
      for (const tag of doc.tags ?? []) tag['x-displayName'] ??= tag.name;
      // The reader picks a server: an editable address (like Stripe's or Scalar's references) or local.
      doc.servers = [
        {
          url: '{console}',
          description: 'Your console',
          variables: { console: { default: process.env.NEXT_PUBLIC_CONSOLE_URL || 'https://<product>.vercel.app', description: 'Your console’s address, with https://' } },
        },
        { url: 'http://localhost:8787', description: 'The API server running locally' },
      ];
      // From another site only a token works (cookies never cross origins).
      doc.security = [{ apiToken: [] }];
      return doc;
    },
  },
});
```

The file lives outside `docs-site/`, so the Vercel project must **include files outside the root directory** (§10).

### 6.3 Layout requirements (Meta's reference pattern)

Each tag page must show, in order:

1. **Endpoints table.** One row per operation: the method (colour-coded, mono, uppercase), the path (mono, primary, links to the operation's anchor), and the summary (muted). Shown only when a page has more than one operation.
2. **Each operation** in its own `<section id="{method}-{path-slug}">` with `scroll-mt-24`, separated by a top border and `mt-12 pt-10`. Inside it:
   - **Left column:** the header, the endpoint bar with **Try in Playground**, the description, Authorization, the parameters (grouped Header / Path / Query) and the request body. Then **Responses: every status listed at once**, each with a status chip (2xx green, 4xx amber, 5xx red), its description, its content type and a `<details>` toggle reading **Show child attributes** / **Hide child attributes**. 2xx starts open, errors start closed. Nested objects stay collapsible inside.
   - **Right column (pinned):** the code samples (cURL, JavaScript, Go, Python, Java, C#, Rust) and the example response for each status. It's `sticky` at `top: calc(var(--fd-docs-row-1, 2rem) + 1rem)`, `w-[min(440px,42%)]`, with `max-h-[calc(100dvh-var(--fd-docs-row-1,2rem)-2rem)]` and `overflow-y-auto`. It stays beside its endpoint and scrolls away with it.
   - The two columns sit side by side from the `@3xl` container width and stack below it.

**The page body must be a size container and must not be capped at 720px**: `<DocsBody className="@container max-w-none!">`. Without `@container` the container query never matches. Without the `!`, `.prose`'s 720px max-width wins. Either one silently keeps the code column from ever appearing.

Method colours: GET green, POST blue, PUT amber, PATCH orange, DELETE red (the `-700` shade in light mode, `-400` in dark).

### 6.4 `components/api-page.tsx`

The full implementation is `docs-site/components/api-page.tsx`. Its parts:

- `createOpenAPIPage({...})` from `fumadocs-openapi/ui`, with:
  - `playground.enabled: true`
  - `playground.authProviders`: for the `apiToken` scheme, `onRequest` sets `Authorization` and adds `Bearer ` when the reader pasted over the pre-filled prefix
  - `storageKeyPrefix: 'helo-docs:'` (the token and chosen server persist per browser; use a prefix per product)
  - `showResponseSchema: false` (our own `<Responses />` replaces the one-at-a-time selector)
  - `content.renderPageLayout`: the endpoints table, then each operation wrapped in its anchored `<section>`
  - `content.renderOperationLayout`: the two columns described above
- `Responses` uses the public hooks:
  - `useOperation()` from `fumadocs-openapi/operation`, for `responses`, `method` and `path`
  - `useComponents()` from `fumadocs-openapi`, for `SchemaUI`, `Markdown` and `CodeBlock`
  - It renders `SchemaUI` with `client={{ rootId: '<op-anchor>-response-<status>', name: 'response', as: 'body' }}`, `root={schema}`, `readOnly`, `renderMarkdown` and `renderCodeblock`.
- `Endpoints` reads summaries through `useOpenAPI().doc.dereferenced.paths[path][method].summary`.

The file starts with `'use client'`.

### 6.5 Try in Playground

Fumadocs' built-in playground is the modal. Don't build another. The reader:

1. clicks **Try in Playground** on an endpoint
2. picks a server: **Your console** (with its address editable under *Variables*) or **localhost**
3. pastes a token into **Authorization**
4. fills the path, query, header and body fields (required ones are marked; the body has Form and JSON views)
5. presses **Send** (⌘↵) and sees the status, time, size, body and headers. The cURL in the modal updates live.

The request goes **straight from the reader's browser** to the chosen server, so it also reaches `localhost` and VPN-only servers. That's why the API must allow CORS (§7). Fumadocs' server-side proxy is not used.

---

## 7. What the API server must do for Try in Playground

A docs site on another origin can only call the API if the API cooperates:

1. **Accept a header token.** Browsers never send another site's cookies cross-origin, so the API needs personal tokens:
   - sent as `Authorization: Bearer <prefix>_…` (ours: `hk_…`)
   - created in the product's settings
   - stored hashed (sha256) and shown once
   - each acting as one person in one workspace, with that person's current role
   - expiring when chosen (30 / 90 / 365 days / never), revocable, and dead when the person leaves
   - refused (403) for account changes: password, email, workspaces, other tokens
2. **Answer CORS for the docs origins only.**
   - Keep an allowlist in an env var: ours is `DOCS_ORIGINS`, default `https://helo-docs.vercel.app,http://localhost:3000`.
   - Answer a preflight (`OPTIONS`) from an allowed origin with `204` and these headers:
     - `Access-Control-Allow-Origin: <origin>`
     - `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE`
     - `Access-Control-Allow-Headers: authorization, content-type, idempotency-key, x-api-version`
     - `Access-Control-Max-Age: 600`
     - `Vary: Origin`
   - On real responses, add `Access-Control-Allow-Origin` and `Access-Control-Expose-Headers` (ours: `x-trace-id, idempotent-replayed, retry-after`).
   - **Never send `Access-Control-Allow-Credentials`.** Cookie sessions stay same-origin only.
3. **Say clearly when a token is bad:** `401 {"title":"Invalid API token", …}`, not the generic "Not logged in".
4. **Describe the token scheme in the OpenAPI file** (`components.securitySchemes.apiToken`), and keep the cookie scheme for the product's own Swagger page.

Our implementation: `server/identity/auth.ts` (`getSession()` accepts tokens; routes under `/api/account/tokens` and `/api/workspace/tokens`), `server/app.ts` (`cors()`), and the Settings › API tokens tab (`src/app/components/shell/ApiTokensSettings.tsx`). `tests/e2e/api-tokens.e2e.ts` proves the flow.

---

## 8. Machine-readable docs, search and social images

| Route | File | What it serves |
| --- | --- | --- |
| `/api/search` | `app/api/search/route.ts` | `export const { GET } = createFromSource(source);` (built-in search, ⌘K) |
| `/llms.txt` | `app/llms.txt/route.ts` | `docsLlms.index()`, an index of every page for AI tools |
| `/llms-full.txt` | `app/llms-full.txt/route.ts` | `docsLlms.full()`, every page as one Markdown file |
| `/llms.mdx/docs/<slug>/content.md` | `app/llms.mdx/docs/[[...slug]]/route.ts` | One page as Markdown (`text/markdown`), statically generated |
| `/og/docs/<slug>/image.png` | `app/og/docs/[...slug]/route.tsx` | `generateOGImage({ title, description, site: appName })` from `fumadocs-ui/og` |
| `/version.json` | `app/version.json/route.ts` | `{ commit: VERCEL_GIT_COMMIT_SHA, builtAt }`, static, so publishing can wait for the live site |

The route handlers set `export const revalidate = false;` (and `version.json` sets `dynamic = 'force-static'`).

**Markdown negotiation (`proxy.ts`):**

- `/docs/<page>.md` rewrites to the page's Markdown.
- A request whose `Accept` prefers Markdown (`isMarkdownPreferred`) gets the Markdown too, with `Vary: Accept`.
- It uses `rewritePath` from `fumadocs-core/negotiation`.
- Each page's **Copy Markdown** and **Open** menu use the same URLs.

---

## 9. The in-browser editor (Fumadocs Studio)

People who don't use Git can edit pages at `http://localhost:5180` (`npm run edit`). Edits save to the MDX files on disk; publish them with a commit (`npm run docs:publish`).

`fumadocs-studio.config.ts` runs in the browser, so it has nothing Node-only:

```ts
import { defineConfig } from '@fumadocs-editor/studio';
import { fumadocsUiComponents } from '@fumadocs-editor/ui';

export default defineConfig({
  root: 'content/docs',
  components: fumadocsUiComponents,   // Callout, Cards, Steps, Accordions, Tabs; add specs for custom components
  host: 'localhost',                  // this machine only: the editor writes files and has no login
  port: 5180,
  server: './studio.server.ts',
  media: {
    async upload(file) {
      const r = await fetch('/__helo_upload', {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
        body: file,
      });
      const out = (await r.json().catch(() => ({}))) as { src?: string; error?: string };
      if (!r.ok || !out.src) throw new Error(out.error ?? `Upload failed (${r.status})`);
      return out.src;
    },
  },
});
```

`studio.server.ts` (Node-only) does three things:

- **Uses `public/` as the editor's public folder**, so `/screens/*.webp` and `/uploads/*` show in the editor as on the site.
- **Adds a small Vite plugin** that saves uploads to `public/uploads/<timestamp>-<name>` and returns `/uploads/<name>`:
  - images only, at most 5 MB
  - file names sanitised
  - new uploads served from disk at once
- **Avoids the studio's own upload**, which writes `./assets/<name>`. That path only resolves for top-level pages and breaks the build for nested ones.

`scripts/check-roundtrip.mjs` (`npm run check:editor`) parses every page and writes it back exactly as the editor does on save, using the same component set. It fails if:

- any page's text would change, or
- a page uses a component the editor has no spec for (it would show as raw source).

Run it after every content change and after upgrading `@fumadocs-editor/*`.

---

## 10. Deploying on Vercel

- **One Vercel project per docs site**, connected to the product's GitHub repo, with these settings:
  - **Root Directory:** `docs-site`
  - **Include files outside the root directory in the Build Step:** on (the OpenAPI file lives at `../docs/openapi.json`)
  - **Framework preset:** Next.js. Build `next build`, install `npm install`.
  - **Production branch:** `main`. A push to `main` deploys it.
- **`docs-site/vercel.json`** skips builds that don't concern the docs:

  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "ignoreCommand": "git diff --quiet HEAD^ HEAD -- . ../docs/openapi.json"
  }
  ```

  The product's own `vercel.json` excludes the docs the same way: `"ignoreCommand": "git diff --quiet HEAD^ HEAD -- . ':(exclude)docs-site'"`.

- **Env vars:** `NEXT_PUBLIC_CONSOLE_URL` sets the default playground server. On the product: `DOCS_ORIGINS` (§7).
- **Publishing content** with `npm run docs:publish` (`scripts/publish.mjs`). It:
  - refuses off `main`, or when other files are already staged
  - builds and runs the editor round-trip check
  - commits only `content/` and `public/uploads/`, and pushes
  - polls `<siteUrl>/version.json` until the live site serves that commit (up to 5 minutes)
  - has a `--dry-run` that shows what it would publish
- **Checking a deploy by hand:**

  ```bash
  curl -s https://<docs-site>/version.json                  # commit should match the push
  curl -s -o /dev/null -w "%{http_code}\n" https://<docs-site>/docs/developers/api/<tag>   # 200
  curl -si -X OPTIONS https://<product>/api/<route> \
    -H 'origin: https://<docs-site>' -H 'access-control-request-method: GET' | head -8   # 204 + CORS headers
  ```

---

## 11. Checks before publishing

From `docs-site/`:

| Command | Proves |
| --- | --- |
| `npm run types:check` | Next's generated route types and the TypeScript compile |
| `npm run build` | Every page, the OpenAPI pages and every route generate |
| `npm run check:editor` | Every page round-trips through the in-browser editor |

By hand, in `npm run dev` (<http://localhost:3000/docs>):

- **Landing, a guide page, a developer page and an API page**, in light and dark mode, at 1440px and 375px wide.
- **On an API page:**
  - the endpoints table links work
  - every status shows, with child attributes that toggle
  - the code column stays pinned beside its endpoint on a wide screen and stacks on a narrow one
- **Try in Playground against the local API:**
  - a wrong token returns the API's "Invalid API token" message in the modal
  - a real token returns data
- **Search (⌘K)** finds a page by a word in its body.

If the product has an API change, also run its own checks (ours: `npm run build`, `lint`, `lint:tw`, `lint:deps`, `npm test`, `npm run test:e2e`, and `npm run docs:openapi` to refresh the spec).

---

## 12. Known pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| The API code column never appears; the reference is a single narrow column | `.prose` caps the body at 720px and nothing sets a size container | `<DocsBody className="@container max-w-none!">` on OpenAPI pages |
| Tag pages 404 or links break | Tag names with `&` or brackets used raw in URLs | `slugify` in `openapi.staticSource` (§3.8) |
| Tag names render as "A I help" | Fumadocs splits camel-case-looking names | `tag['x-displayName'] ??= tag.name` |
| Playground calls go out without `Bearer ` | The reader pasted over the pre-filled prefix | `authProviders` `onRequest` adds it (§6.4) |
| Playground fails with a CORS error | The API doesn't allow the docs origin, or sends `Allow-Credentials` | §7; check the preflight with `curl` |
| An uploaded image breaks the build on a nested page | Studio's default upload writes `./assets/…`, relative to the page | Upload to `public/uploads` (§9) |
| The editor shows a component as raw source | No spec for it in `fumadocs-studio.config.ts` | Add the spec; run `npm run check:editor` |
| Next picks the wrong project root or lockfile | The docs app sits inside another Node project | `turbopack.root` in `next.config.mjs` (§3.4) |
| "Hydration mismatch … `caret-color`" only in Playwright screenshots | Playwright hides the caret by styling inputs | Not a site bug. Pass `caret: 'initial'` to `screenshot()` to silence it. |
| Code differs from what tutorials show | Next 16 / Fumadocs 16 APIs changed | Read `node_modules/next/dist/docs/` and the installed packages' `.d.ts` files |

---

## 13. Replication checklist

1. [ ] Create `docs-site/` with the exact versions in §1 (Fumadocs packages pinned, `fumadocs-ui` aliased to `@fumadocs/base-ui`).
2. [ ] Add every config file in §3 (`package.json` scripts, `tsconfig`, `next.config.mjs`, `postcss.config.mjs`, `.gitignore`).
3. [ ] Set the product's name, URL and GitHub location in `lib/shared.ts`, and its logo and favicon in `public/`.
4. [ ] Copy `app/global.css` and swap only the brand primary and accent values (§5.2), keeping the greys, the typography, the backdrop structure and the AA contrast.
5. [ ] Add the layouts, the page renderer, `components/mdx.tsx`, the landing page and the 404 (§3.10–3.13, §5.6–5.7).
6. [ ] Create `content/docs` with `index.mdx`, `meta.json` and the **Guide** and **Developers** root folders (§4).
7. [ ] Add search, the llms routes, OG images, `version.json` and `proxy.ts` (§8).
8. [ ] If the product has an API:
   - export an OpenAPI 3.1 file (§6.1)
   - add `lib/openapi.ts` and `components/api-page.tsx` (§6.2–6.4)
   - implement tokens and CORS on the API (§7)
9. [ ] Add Fumadocs Studio, its upload server and the round-trip check (§9).
10. [ ] Create the Vercel project (root `docs-site`, outside files included), add both `ignoreCommand`s and set the env vars (§10).
11. [ ] Run every check in §11, then push to `main` and confirm `/version.json` serves the new commit.
