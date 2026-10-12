import { llms, loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { openapi } from './openapi';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    // One page per API area (the spec's tags), generated from the console's OpenAPI file.
    openapi: await openapi.staticSource({ baseDir: 'developers/api', per: 'tag' }),
  },
  {
    baseUrl: docsRoute,
    plugins: [lucideIconsPlugin(), openapi.loaderPlugin()],
  },
);

export const docsLlms = llms(source, {
  renderPage: async (page) => {
    if (page.type === 'openapi') return `# ${page.data.title} (${page.url})\n\n${JSON.stringify(page.data.getSchema().bundled, null, 2)}`;
    return `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`;
  },
});
