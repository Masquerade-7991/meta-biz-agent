import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createOpenAPI } from 'fumadocs-openapi/server';

// The console's spec (npm run docs:openapi at the repo root writes it). Tag names are already
// readable ("AI help", "WhatsApp"); without x-displayName Fumadocs re-splits them ("A I help").
export const openapi = createOpenAPI({
  input: {
    console: async () => {
      const doc = JSON.parse(await readFile(path.resolve(process.cwd(), '../docs/openapi.json'), 'utf8'));
      for (const tag of doc.tags ?? []) tag['x-displayName'] ??= tag.name;
      // The spec says "this server" ('/'), which only makes sense inside the console. Here the reader
      // picks a console (an editable address, like Stripe's or Scalar's references) or the local API
      // server; "Try it" calls it straight from the browser (the console allows this origin, CORS).
      doc.servers = [
        {
          url: '{console}',
          description: 'Your console',
          variables: { console: { default: process.env.NEXT_PUBLIC_CONSOLE_URL || 'https://meta-biz-agent.vercel.app', description: 'Your console’s address, with https://' } },
        },
        { url: 'http://localhost:8787', description: 'The API server running locally (npm run dev:server)' },
      ];
      // From another site only an API token works (cookies never cross origins), so the reference
      // shows that one; the session cookie is for the console itself (developers/api).
      doc.security = [{ apiToken: [] }];
      return doc;
    },
  },
});
