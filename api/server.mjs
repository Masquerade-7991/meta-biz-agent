// The API on Vercel: every /api/* request (except /api/shopify-mcp) arrives here through vercel.json.
// The handler is the bundled server (npm run build writes api/_server/app.mjs; see scripts/bundle-server.mjs).
export { default } from './_server/app.mjs'
