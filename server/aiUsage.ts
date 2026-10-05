// AI tokens this console spends on its own features (chat summaries, through Anthropic), per
// workspace and day, from the `usage` Anthropic returns with every answer. The Meta Business Agent's
// own model use is billed by Meta and not reported per token; its conversation counts come from
// Meta's insights (metrics_daily, collectors.ts) and are shown alongside.
import { col, ws } from './db.ts'
import { currentAssets } from './context.ts'
import { obj } from './http.ts'
import { trace } from './trace.ts'

const usage = () => col('ai_usage')

export function recordAiUsage(feature: string, model: string, raw: unknown) {
  const u = obj(raw)
  const input = Number(u.input_tokens) || 0
  const output = Number(u.output_tokens) || 0
  if (!input && !output) return
  const day = new Date().toISOString().slice(0, 10)
  usage()
    .updateOne({ workspaceId: ws(), day, feature, model }, { $inc: { input, output, calls: 1 } }, { upsert: true })
    .catch((err) => console.log(`ai_usage write failed: ${err instanceof Error ? err.message : err}`))
  trace('ai.used', { feature, model, input, output })
}

/** This month so far: our own AI tokens by feature, and the Meta agent's conversations. */
export async function aiUsageMonth() {
  const from = new Date().toISOString().slice(0, 7) + '-01'
  const rows = await usage()
    .aggregate([{ $match: { workspaceId: ws(), day: { $gte: from } } }, { $group: { _id: { feature: '$feature', model: '$model' }, input: { $sum: '$input' }, output: { $sum: '$output' }, calls: { $sum: '$calls' } } }])
    .toArray()
  const phones = [...(currentAssets()?.ids ?? [])]
  const agent = await col('metrics_daily')
    .aggregate([{ $match: { 'meta.phoneNumberId': { $in: phones }, 'meta.metric': 'ai_threads', ts: { $gte: new Date(from + 'T00:00:00Z') } } }, { $group: { _id: null, n: { $sum: '$value' } } }])
    .toArray()
    .catch(() => [])
  return {
    console: rows.map((r) => ({ feature: String(r._id.feature), model: String(r._id.model), input: r.input, output: r.output, calls: r.calls })),
    agentConversations: agent[0]?.n ?? null,
  }
}
