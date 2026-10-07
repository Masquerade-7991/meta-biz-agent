// Writing help for the agent's setup, and the questions it couldn't answer (server/assist.ts).
import { jsonClient } from './client'

export type WriteTask = 'draft_role' | 'improve' | 'draft_skill'
export interface WriteContext {
  agentName?: string
  business?: string
  category?: string
  goal?: string
}
export interface Gap {
  question: string
  reason: 'fallback' | 'handoff'
  source: 'customer' | 'test'
  count: number
  lastAt: string
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Demo mode: believable drafts and a few unanswered questions, without an API key. */
async function dummyAssist<T>(method: string, path: string, body: unknown): Promise<T> {
  await wait(900)
  if (path === '/api/assist/write') {
    const b = (body ?? {}) as { task: WriteTask; text?: string; context?: WriteContext }
    const text =
      b.task === 'draft_role'
        ? 'Helps customers find products, check stock and prices, track their orders and start a return, and hands over to the team for anything it can’t sort out.'
        : b.task === 'draft_skill'
          ? 'When this comes up, ask the customer for the details you need (like their order number) if they haven’t given them, look it up, and reply in one or two sentences. If you can’t find what they need, say so and offer to connect them with the team.'
          : (b.text ?? '').trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/([^.!?])$/, '$1.')
    return { text } as T
  }
  if (path.startsWith('/api/assist/gaps')) {
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
    return [
      { question: 'Do you deliver on Sundays?', reason: 'fallback', source: 'customer', count: 4, lastAt: ago(3) },
      { question: 'Can I change the address on my order after paying?', reason: 'handoff', source: 'customer', count: 3, lastAt: ago(20) },
      { question: 'Is there a student discount?', reason: 'fallback', source: 'test', count: 1, lastAt: ago(30) },
    ] as T
  }
  throw new Error(`No demo answer for ${method} ${path}`)
}

const call = jsonClient(dummyAssist)

export const assistWrite = (task: WriteTask, text: string, context: WriteContext = {}) => call<{ text: string }>('/api/assist/write', 'POST', { task, text, context })
export const listGaps = (days: 7 | 30 = 7) => call<Gap[]>(`/api/assist/gaps?days=${days}`)
