// The in-browser editor for content/docs (npm run edit → http://localhost:5180). Edits save to the
// MDX files on disk; publish them with a commit. Also evaluated in the browser, so nothing Node-only
// here: server options live in studio.server.ts.
import { defineConfig } from '@fumadocs-editor/studio';
import { fumadocsUiComponents } from '@fumadocs-editor/ui';

export default defineConfig({
  root: 'content/docs',
  // The components the site renders (components/mdx.tsx): Callout, Cards, Steps, Accordions, Tabs.
  components: fumadocsUiComponents,
  // This machine only: the editor writes files and has no login.
  host: 'localhost',
  port: 5180,
  server: './studio.server.ts',
  // Uploaded images go to public/uploads and are written into the page as /uploads/<name>, so they
  // resolve from any page, in the editor and on the site (studio.server.ts explains why).
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
    onError(error) {
      alert(`Couldn’t upload the image: ${error instanceof Error ? error.message : String(error)}`);
    },
  },
});
