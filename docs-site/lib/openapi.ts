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
      // The spec says "this server" ('/'), which code samples would print as example.com. Here they
      // name the local API server instead (docs: Running locally).
      doc.servers = [{ url: 'http://localhost:8787', description: 'The API server when running locally (in production: your console’s address)' }];
      return doc;
    },
  },
});
