// Thin pass-through to the Meta Business Agent API (or Helo.ai's server in front of it).
// The browser calls /api/meta/<path>; we forward to <upstream>/<path> with the Meta headers.
// Literal WABA_ID / PHONE_NUMBER_ID segments in <path> are swapped for the .env values, so the
// browser never needs to know them. Run: npm run dev:server
import http from 'node:http'

process.loadEnvFile?.('.env')
const env = (k: string) => (process.env[k] ?? '').trim()

// UPSTREAM=meta → BASE_URL_1 (needs META_TOKEN); anything else → BASE_URL_2 (Helo.ai server).
const upstream = (env('UPSTREAM') === 'meta' ? env('BASE_URL_1') : env('BASE_URL_2')).replace(/\/+$/, '')
const PORT = Number(env('SERVER_PORT') || 8787)
const ids: Record<string, string> = { WABA_ID: env('WABA_ID'), PHONE_NUMBER_ID: env('PHONE_NUMBER_ID') }

function buildTarget(url: string): string {
  const rest = url.replace(/^\/api\/meta/, '')
  return upstream + rest.replace(/\/(WABA_ID|PHONE_NUMBER_ID)(?=\/|\?|$)/g, (_, k: string) => '/' + ids[k])
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/'
  if (url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    // IDs aren't secrets; the Create Agent picker shows them. The token never leaves this process.
    res.end(
      JSON.stringify({
        ok: true,
        upstream,
        hasToken: !!env('META_TOKEN'),
        businessName: env('BUSINESS_NAME'),
        wabaId: ids.WABA_ID,
        phoneNumberId: ids.PHONE_NUMBER_ID,
      }),
    )
    return
  }
  if (!url.startsWith('/api/meta/')) {
    res.writeHead(404).end()
    return
  }

  const target = buildTarget(url)
  const headers: Record<string, string> = {
    // Thread Control is the one endpoint on the 1.0.0 contract.
    'X-API-Version': url.includes('/thread_control') ? '1.0.0' : '2.0.0',
  }
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
  if (env('META_TOKEN')) headers.authorization = `Bearer ${env('META_TOKEN')}`

  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
    const r = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(20_000) })
    const text = await r.text()
    console.log(`${req.method} ${target} → ${r.status}`)
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' })
    res.end(text)
  } catch (err) {
    // Same StandardError shape Meta uses, so the UI handles one error format.
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.log(`${req.method} ${target} → 502 (${detail})`)
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ title: 'Upstream unreachable', detail: `${upstream} did not respond. ${detail}`, status: 502 }))
  }
})

server.listen(PORT, () => console.log(`API proxy on :${PORT} → ${upstream || '(no upstream set)'}`))
