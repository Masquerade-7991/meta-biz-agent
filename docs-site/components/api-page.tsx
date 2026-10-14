'use client';
import type { ReactNode } from 'react';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import { useOperation } from 'fumadocs-openapi/operation';
import { useComponents, useOpenAPI } from 'fumadocs-openapi';

// Laid out like Meta's reference: an endpoints table on top, then each endpoint with its parameters,
// body and every response (child attributes fold away), and the code samples pinned beside it.
// "Try in Playground" sends the request from the reader's browser to the console they pick (lib/openapi.ts
// servers) with an API token from Settings › API tokens; the console allows this origin (CORS, no cookies).
export const OpenAPIPage = createOpenAPIPage({
  playground: {
    enabled: true,
    // The field starts as "Bearer "; a token pasted over it still goes out as "Bearer hk_…".
    authProviders: [
      {
        on: 'apiToken',
        onRequest(data, value) {
          const v = String(value ?? '').trim();
          data.header.Authorization = /^bearer\s/i.test(v) ? v : `Bearer ${v}`;
        },
      },
    ],
  },
  // The token and chosen server are remembered in this browser only.
  storageKeyPrefix: 'helo-docs:',
  // Shown by <Responses /> instead: all of them at once, not one at a time.
  showResponseSchema: false,
  content: {
    renderPageLayout: ({ operations }) => (
      <>
        {operations && operations.length > 1 && <Endpoints items={operations.map((o) => o.item)} />}
        {operations?.map(({ item, children }) => (
          <section key={anchorOf(item)} id={anchorOf(item)} className="mt-12 scroll-mt-24 border-t pt-10 first:mt-0 first:border-t-0 first:pt-0">
            {children}
          </section>
        ))}
      </>
    ),
    renderOperationLayout: (slots) => (
      <div className="flex flex-col gap-x-8 gap-y-6 @3xl:flex-row @3xl:items-start">
        <div className="min-w-0 flex-1">
          {slots.header}
          {slots.apiPlayground}
          {slots.description}
          {slots.authSchemes}
          {slots.parameters}
          {slots.body}
          <Responses />
          {slots.callbacks}
        </div>
        {/* Pinned while its endpoint is on screen; scrolls inside itself when the samples are long. */}
        <div className="@3xl:sticky @3xl:top-[calc(var(--fd-docs-row-1,2rem)+1rem)] @3xl:max-h-[calc(100dvh-var(--fd-docs-row-1,2rem)-2rem)] @3xl:w-[min(440px,42%)] @3xl:shrink-0 @3xl:overflow-y-auto">
          {slots.apiExample}
        </div>
      </div>
    ),
  },
});

type Item = { path: string; method: string };
const anchorOf = ({ method, path }: Item) =>
  `${method}-${path}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const METHOD_COLOR: Record<string, string> = {
  get: 'text-green-700 dark:text-green-400',
  post: 'text-blue-700 dark:text-blue-400',
  put: 'text-amber-700 dark:text-amber-400',
  patch: 'text-orange-700 dark:text-orange-400',
  delete: 'text-red-700 dark:text-red-400',
};
function Method({ method }: { method: string }) {
  return <span className={`font-mono text-xs font-semibold uppercase ${METHOD_COLOR[method] ?? 'text-fd-muted-foreground'}`}>{method}</span>;
}

/** Every endpoint on this page, linking to its section (Meta's "Endpoints" box). */
function Endpoints({ items }: { items: Item[] }) {
  const { dereferenced } = useOpenAPI().doc;
  const summaryOf = (i: Item) => (dereferenced.paths?.[i.path] as Record<string, { summary?: string }> | undefined)?.[i.method]?.summary;
  return (
    <nav aria-label="Endpoints" className="not-prose mb-12">
      <h2 className="mb-3 text-lg font-semibold">Endpoints</h2>
      <div className="overflow-x-auto rounded-xl border bg-fd-card">
        <table className="w-full text-sm">
          <tbody>
            {items.map((i) => (
              <tr key={anchorOf(i)} className="border-t first:border-t-0">
                <td className="w-0 py-2 ps-3 pe-4 align-top">
                  <Method method={i.method} />
                </td>
                <td className="py-2 pe-3">
                  <a href={`#${anchorOf(i)}`} className="font-mono text-[0.8125rem] text-fd-primary hover:underline">
                    {i.path}
                  </a>
                  {summaryOf(i) && <span className="ms-2 text-fd-muted-foreground">{summaryOf(i)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </nav>
  );
}

const STATUS_COLOR = (s: string) =>
  s.startsWith('2') ? 'bg-green-500/10 text-green-700 dark:text-green-400' : s.startsWith('5') ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400';

/** Every status the endpoint answers, each with its schema behind "Show child attributes". */
function Responses() {
  const { responses, method, path } = useOperation();
  const { SchemaUI, Markdown, CodeBlock } = useComponents();
  if (!responses.length) return null;
  return (
    <div className="mt-10">
      <h3 className="mb-3 text-base font-semibold">Responses</h3>
      <div className="not-prose divide-y rounded-xl border bg-fd-card">
        {responses.map(({ status, response, content }) => {
          const [mediaType, media] = Object.entries(content)[0] ?? [];
          return (
            <div key={status} className="px-3 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={`rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${STATUS_COLOR(status)}`}>{status}</span>
                {response.description && (
                  <div className="min-w-0 flex-1 text-sm text-fd-muted-foreground [&_p]:m-0">
                    <Markdown md={response.description} />
                  </div>
                )}
              </div>
              {mediaType && (
                <p className="mt-1.5 text-xs text-fd-muted-foreground">
                  Content type: <code>{mediaType}</code>
                </p>
              )}
              {media?.schema && (
                <details className="group mt-2" open={status.startsWith('2')}>
                  <summary className="cursor-pointer text-xs font-medium text-fd-primary select-none">
                    <span className="group-open:hidden">Show child attributes</span>
                    <span className="hidden group-open:inline">Hide child attributes</span>
                  </summary>
                  <div className="mt-2">
                    <SchemaUI
                      client={{ rootId: anchorOf({ method, path }) + `-response-${status}`, name: 'response', as: 'body' }}
                      root={media.schema}
                      readOnly
                      writeOnly={false}
                      renderMarkdown={(md: string): ReactNode => <Markdown md={md} />}
                      renderCodeblock={(props) => <CodeBlock {...props} />}
                    />
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
