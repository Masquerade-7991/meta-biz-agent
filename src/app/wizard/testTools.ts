// Which connector tools the agent called for one Test & Eval reply. Meta's agent_test doesn't say;
// its conversation turns do (insights/conversations/turns, with agent_test's conversation_id as the
// user). Checked live: the turn is there about a second after the reply, under a different-looking
// conversation id, so the reply's turn is the newest one that started after the message was sent.

import type { MetaTurn } from '@/app/api/meta'
import { splitToolName } from './toolRequest.ts'

export interface ToolCall {
  tool: string
  connector: string | null
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT'
  ms?: number
  input?: string
  output?: string
}
/** What the chat shows under a reply: still checking, the calls (maybe none), or couldn't tell. */
export type ToolCallsState = { state: 'checking' } | { state: 'done'; calls: ToolCall[] } | { state: 'unknown' }

/** A connector or tool name as people read it: "search_products" → "Search products". */
export const readableName = (name: string) => {
  const words = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : name
}

/** Meta's canned reply when its agent fails to produce an answer (seen live with a turn that has no steps).
 *  ponytail: matches Meta's wording; if Meta rewords it, the reply just shows as a normal one again. */
export const isMetaFallback = (reply: string) => /^I had trouble responding fully/i.test(reply.trim())

/** The tool calls in the newest turn that started at or after `since` (ms), or null when it isn't there yet. */
export function toolCallsSince(turns: MetaTurn[], since: number): ToolCall[] | null {
  const turn = turns.filter((t) => (t.timestamp ?? 0) >= since - 2000).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0]
  if (!turn) return null
  return turn.steps
    .filter((s) => s.type === 'TOOL_CALL')
    .map((s) => {
      const { connector, tool } = splitToolName(s.tool_name ?? 'unknown tool')
      return { tool, connector, status: s.status ?? 'SUCCESS', ms: s.latency_ms, input: s.tool_input, output: s.tool_output }
    })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls the conversation's turns until the reply's turn appears, giving up after the last delay. */
export async function findToolCalls(fetchTurns: () => Promise<MetaTurn[]>, since: number, delays = [600, 1200, 2500, 5000, 8000]): Promise<ToolCall[] | null> {
  for (const d of delays) {
    await wait(d)
    const calls = toolCallsSince(await fetchTurns().catch(() => []), since)
    if (calls) return calls
  }
  return null
}

/** A JSON string, formatted for reading; anything else as it came. */
export function readable(s: string | undefined): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
