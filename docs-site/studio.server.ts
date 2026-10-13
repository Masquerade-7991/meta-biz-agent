// Node-only options for the in-browser editor (fumadocs-studio.config.ts points here).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineServerConfig } from '@fumadocs-editor/studio';

const here = import.meta.dirname;
const PUBLIC = path.join(here, 'public');
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' };

/**
 * Uploads land in public/uploads and are referenced as /uploads/<name>, like the screenshots in
 * public/screens. The studio's own upload writes content/docs/assets and puts `./assets/<name>`
 * in the page, which only resolves for pages at the top of content/docs: in guide/tickets.mdx it
 * would point at guide/assets and break the site build. fumadocs-studio.config.ts sends uploads here.
 */
function uploads(): Plugin {
  return {
    name: 'helo-docs-uploads',
    configureServer(server) {
      // Vite lists public files once, at startup: serve new uploads from disk so they show at once.
      server.middlewares.use('/uploads/', async (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        if (req.method !== 'GET' || !/^[\w.-]+$/.test(name)) return next();
        try {
          const body = await readFile(path.join(PUBLIC, 'uploads', name));
          res.setHeader('content-type', TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream');
          res.end(body);
        } catch {
          next();
        }
      });
      server.middlewares.use('/__helo_upload', (req, res) => {
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: message }));
        };
        if (req.method !== 'POST') return fail(405, 'POST an image.');
        const type = String(req.headers['content-type'] ?? '');
        if (!/^image\//.test(type)) return fail(415, 'Only images can be uploaded.');
        if (Number(req.headers['content-length']) > MAX_BYTES) return fail(413, 'Images must be 5 MB or smaller.');
        const original = decodeURIComponent(String(req.headers['x-filename'] ?? 'image'))
          .replace(/[^\w.-]+/g, '-')
          .replace(/^[-.]+/, '');
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= MAX_BYTES) chunks.push(c);
        });
        req.on('end', async () => {
          if (size > MAX_BYTES) return fail(413, 'Images must be 5 MB or smaller.');
          const name = `${Date.now().toString(36)}-${original || 'image'}`;
          try {
            await mkdir(path.join(PUBLIC, 'uploads'), { recursive: true });
            await writeFile(path.join(PUBLIC, 'uploads', name), Buffer.concat(chunks));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ src: `/uploads/${name}` }));
          } catch (err) {
            fail(500, err instanceof Error ? err.message : String(err));
          }
        });
      });
    },
  };
}

export default defineServerConfig({
  // Pages reference the site's own files (/screens/*.webp, /samples/*.csv, /uploads/*) from
  // docs-site/public: serve the same folder so the editor shows what the site shows.
  vite: { publicDir: PUBLIC, plugins: [uploads()] },
  // The studio's built-in upload endpoint (unused, see above) keeps the same limits.
  upload: { maxBytes: MAX_BYTES, types: /^image\// },
});
