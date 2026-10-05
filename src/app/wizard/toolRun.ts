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
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

/** ok: did the system answer with success. body: what to show, the system's reply when there is one. */
export function readToolRun(metaStatus: string, output: string): { ok: boolean; body: string } {
  const outer = asObj(parse(output))
  const status = asObj(outer?.status)
  if (!outer || !status) return { ok: metaStatus === 'success', body: pretty(parse(output)) }

  const inner = parse(outer.body)
  const reply = asObj(asObj(inner)?.output)
  const failed = !!status.failure_code || (typeof status.code === 'number' && status.code !== 1)
  if (reply && typeof reply.status === 'number') {
    const ok = !failed && reply.status >= 200 && reply.status < 300
    return { ok, body: pretty(reply.data ?? reply) }
  }
  // A failure before the system answered (e.g. the key was refused): Meta's message says why.
  const message = asObj(inner)?.message
  return { ok: !failed && metaStatus === 'success', body: typeof message === 'string' ? message : pretty(inner ?? outer) }
}
