import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // API_PROXY_TARGET lets a second relay (e.g. a test one on another port) serve this dev server.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8787' },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
