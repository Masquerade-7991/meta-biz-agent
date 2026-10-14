import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'Helo.ai docs';
/** The hosted docs (Vercel project helo-docs). With a custom domain, change it here. */
export const siteUrl = 'https://helo-docs.vercel.app';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

/** Where the pages live on GitHub: "Open in GitHub" (each page's Open menu) opens the file in GitHub's web editor. */
export const gitConfig = { user: 'Masquerade-7991', repo: 'meta-biz-agent', branch: 'main', contentDir: 'docs-site/content/docs' };



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
