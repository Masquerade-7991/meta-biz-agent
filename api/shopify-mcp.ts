// Bridge between Meta's MCP connector and a Shopify store's MCP server (UCP, /api/ucp/mcp).
// Shopify requires every tool call to carry params.arguments.meta["ucp-agent"].profile, which
// Meta's connector can't add. This hides `meta` from the tool list (so Meta's agent never has to
// fill it) and adds the profile to each call. Everything else passes through unchanged.
//
// MCP server address to enter in the console: https://<public host>/api/shopify-mcp?store=<shop>.myshopify.com
// Runs as a Vercel function (this file) and on the local relay (server/index.ts imports it).
// Meta's servers must reach it, so for real testing it needs a public URL (e.g. the Vercel deploy).

// Shopify's published example profile, advertising catalog and checkout capabilities.
// ponytail: borrowed profile; host our own UCP profile when this goes beyond a POC.
const PROFILE = process.env.UCP_AGENT_PROFILE || 'https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json'
// Read-only tools only, so the agent can browse the catalog but never create carts or checkouts.
const TOOLS = new Set((process.env.SHOPIFY_MCP_TOOLS || 'search_catalog,lookup_catalog,get_product').split(','))
const STORE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
type Tool = { name: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }

const rpcError = (id: unknown, message: string, status = 400) =>
  Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code: -32602, message } }, { status })

export async function POST(request: Request): Promise<Response> {
  const store = new URL(request.url).searchParams.get('store')?.toLowerCase() ?? ''
  if (!STORE.test(store)) return rpcError(null, 'Add ?store=<shop>.myshopify.com to the MCP server address')
  let msg: Rpc
  try {
    msg = (await request.json()) as Rpc
  } catch {
    return rpcError(null, 'Body must be a JSON-RPC message')
  }

  if (msg.method === 'tools/call') {
    if (!TOOLS.has(String(msg.params?.name))) return rpcError(msg.id, `Tool ${msg.params?.name} is not enabled on this bridge`)
    msg.params = { ...msg.params, arguments: { ...msg.params?.arguments, meta: { 'ucp-agent': { profile: PROFILE } } } }
  }

  const upstream = await fetch(`https://${store}/api/ucp/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: request.headers.get('accept') || 'application/json, text/event-stream' },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(25_000),
  })
  if (msg.method !== 'tools/list' || !upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' } })

  // Tool list: keep the enabled tools and drop the `meta` argument the bridge fills in.
  const body = (await upstream.json()) as { result?: { tools?: Tool[] } }
  const tools = (body.result?.tools ?? [])
    .filter((t) => TOOLS.has(t.name))
    .map((t) => {
      const props = { ...t.inputSchema?.properties }
      delete props.meta
      return { ...t, inputSchema: { ...t.inputSchema, properties: props, required: (t.inputSchema?.required ?? []).filter((r) => r !== 'meta') } }
    })
  return Response.json({ ...body, result: { ...body.result, tools } })
}
