// Reading a tool run's result from Meta. Meta's own wrapper (status "success" / "error") isn't
// reliable on its own: the real outcome sits in `output`, which (when it's Meta's runner format) is
// { status: { code, failure_code? }, body: "<JSON string>" }. Code 1 is a finished run; 2 and any
// failure_code are failures. Inside a finished run, body.output is the system's HTTP answer.

type Obj = Record<string, unknown>
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const parse = (s: unknown): unknown => {
  if (typeof s !== 'string') return s
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
/** JSON strings inside JSON, opened up so the full response reads as one document. */
const deepParse = (v: unknown, depth = 0): unknown => {
  if (depth > 4) return v
  if (typeof v === 'string') {
    const p = parse(v)
    return p !== v && typeof p === 'object' ? deepParse(p, depth + 1) : v
  }
  if (Array.isArray(v)) return v.map((x) => deepParse(x, depth + 1))
  const o = asObj(v)
  return o ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, deepParse(x, depth + 1)])) : v
}
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

export interface ToolRunResult {
  /** Did the system answer with success. */
  ok: boolean
  /** What to show: the system's reply, or Meta's reason when the system never answered. */
  body: string
  /** The system's HTTP status, when known (also from a refused key). */
  httpStatus?: number
  /** Everything Meta returned, formatted, for "Show full response". */
  full: string
}

export function readToolRun(metaStatus: string, output: string): ToolRunResult {
  const outer = asObj(parse(output))
  const status = asObj(outer?.status)
  const full = pretty(deepParse(parse(output)))
  if (!outer || !status) return { ok: metaStatus === 'success', body: pretty(parse(output)), full }

  const inner = parse(outer.body)
  const reply = asObj(asObj(inner)?.output)
  const failed = !!status.failure_code || (typeof status.code === 'number' && status.code !== 1)
  if (reply && typeof reply.status === 'number') {
    const ok = !failed && reply.status >= 200 && reply.status < 300
    return { ok, body: pretty(reply.data ?? reply), httpStatus: reply.status, full }
  }
  // A failure before the system answered (e.g. the key was refused): Meta's message says why.
  const message = asObj(inner)?.message
  const refused = asObj(asObj(asObj(asObj(inner)?.causedByError)?.data)?.response)?.status
  return {
    ok: !failed && metaStatus === 'success',
    body: typeof message === 'string' ? message : pretty(inner ?? outer),
    httpStatus: typeof refused === 'number' ? refused : undefined,
    full,
  }
}
