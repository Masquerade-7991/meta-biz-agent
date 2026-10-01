import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, History, Loader2, Send } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { EvalTab } from './EvalTab'
import { generateFakeSubpages } from './KnowledgeBaseStep'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import {
  SAMPLE_BUSINESS_PROFILE,
  SAMPLE_DOCUMENTS,
  SAMPLE_FAQS,
  SAMPLE_NEVER_SAY_WORDS,
  SAMPLE_RICH_REPLIES,
  SAMPLE_TOPICS_TO_AVOID,
  SAMPLE_WEBSITES,
  newId,
  pickConnectionPreviewReply,
} from '@/app/wizard/mockData'
import type { Connection, ConnectionAction, WizardState } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { checkEligibility, errorText, MetaError, sendTestMessage } from '@/app/api/meta'
import { listTestConversations } from '@/app/api/store'
import { isDummyMode, storageKey } from '@/app/api/dummy'
import type { DummyRich } from '@/app/api/dummyMeta'
import { DemoWhatsAppChat } from './DemoWhatsAppChat'
import { InlineError } from '@/app/components/wizard/RetryBanner'

interface ChatMessage {
  from: 'customer' | 'agent' | 'system'
  text: string
  at: number
  quickReplies?: string[]
  rich?: DummyRich
}
interface TestConversation {
  id: string
  startedAt: number
  messages: ChatMessage[]
}

// Meta has no history API for test conversations (PRD 5.4.1 AC6b-f). The server records every test
// message in its store; without a database, past ones are kept in this browser instead.
const TEST_HISTORY_KEY = storageKey('meta-agent-test-history-v1')
function loadTestHistory(): TestConversation[] {
  try {
    return JSON.parse(localStorage.getItem(TEST_HISTORY_KEY) ?? '[]') as TestConversation[]
  } catch {
    return []
  }
}
function saveTestHistory(history: TestConversation[]) {
  try {
    localStorage.setItem(TEST_HISTORY_KEY, JSON.stringify(history.slice(0, 100)))
  } catch {
    // storage full or blocked: history just isn't kept
  }
}

type CheckStatus = 'pending' | 'normal' | 'warn'
interface CheckRow {
  id: string
  situation: string
  sent: string
  reply: string
  status: CheckStatus
}

type CheckDef = Omit<CheckRow, 'status'> & { finalStatus: CheckStatus }

function buildStandardChecks(state: WizardState, forceAmberGreeting: boolean): CheckDef[] {
  const rows: CheckDef[] = []

  rows.push({
    id: 'greeting',
    situation: 'Greeting',
    sent: 'Hi',
    reply: state.replies.greetingReply,
    finalStatus: forceAmberGreeting ? 'warn' : 'normal',
  })

  const faq = state.knowledge.faqs[0]
  rows.push({
    id: 'faq',
    situation: 'A question from your FAQ',
    sent: faq ? faq.question : 'Do you have a returns policy?',
    reply: faq ? faq.answer : state.replies.fallbackReply,
    finalStatus: 'normal',
  })

  rows.push({
    id: 'outside',
    situation: 'Something outside what you sell',
    sent: 'Can you help me file my taxes?',
    reply: state.replies.fallbackReply,
    finalStatus: 'normal',
  })

  // A prototype has no way to confirm a human was actually notified, so this check can never
  // honestly report success — same "never claim to have verified the unverifiable" rule as the
  // billing checkbox on Publish.
  rows.push({
    id: 'person',
    situation: 'Asking for a person',
    sent: 'Can I talk to a real person?',
    reply: state.guardrails.handoffMessageEnabled ? state.guardrails.handoffMessage : "I'll connect you with someone from our team.",
    finalStatus: 'warn',
  })

  if (state.connections.actions.length > 0) {
    const action = state.connections.actions[0]
    const connection = state.connections.connections.find((c) => c.id === action.connectionId)
    rows.push({
      id: 'action',
      situation: 'A configured action, if any',
      sent: `Can you help with ${action.name.toLowerCase()}?`,
      reply: connection ? pickConnectionPreviewReply({ action, connection }) : state.replies.fallbackReply,
      finalStatus: 'normal',
    })
  }

  return rows
}

export function TestEvalStep() {
  const { state, patch } = useWizard()

  // ---- Quick test: Meta's Agent Test API (not billed, 500/hour per number) ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [sending, setSending] = useState(false)
  // conversation_id threads follow-ups into one conversation; cleared by Start New Conversation.
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [limitMessage, setLimitMessage] = useState<string | null>(null)
  const [ineligible, setIneligible] = useState(false)
  const [history, setHistory] = useState<TestConversation[]>(loadTestHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewing, setViewing] = useState<TestConversation | null>(null)
  // True once the store answered: the server keeps history then, so this browser stops writing it.
  const [storeOn, setStoreOn] = useState(false)
  useEffect(() => {
    if (!historyOpen) return
    let live = true
    listTestConversations().then((list) => {
      if (!live || !list) return
      setStoreOn(true)
      setHistory(list)
    })
    return () => {
      live = false
    }
  }, [historyOpen])

  // PRD 5.4.1 AC5: a number that has become ineligible can't be tested at all.
  useEffect(() => {
    checkEligibility()
      .then((r) => setIneligible(!r.is_eligible))
      .catch(() => {}) // can't evaluate (401/404/unreachable) is not the same as ineligible
  }, [])

  const hasAnyConfig =
    state.identity.agentRole.trim() !== '' ||
    state.personalization.customSkills.length > 0 ||
    state.knowledge.faqs.length > 0 ||
    state.knowledge.documents.length > 0 ||
    state.knowledge.websites.length > 0 ||
    state.business.businessDescription.trim() !== ''

  /** `shown` replaces the customer's bubble text when `text` is a dummy-mode tap token. */
  async function sendQuickTest(textArg?: string, shown?: string) {
    const text = (textArg ?? chatDraft).trim()
    if (!text || sending) return
    if (!textArg) setChatDraft('')
    setChatMessages((prev) => [...prev, { from: 'customer', text: shown ?? text, at: Date.now() }])
    setSending(true)
    try {
      const r = await sendTestMessage(text, conversationId)
      setConversationId(r.conversation_id)
      setChatMessages((prev) => [
        ...prev,
        ...(r.agent_response
          ? [{ from: 'agent' as const, text: r.agent_response, at: Date.now(), quickReplies: r.quick_replies, rich: r.dummy_rich }]
          : []),
        ...(r.handoff_reason ? [{ from: 'system' as const, text: 'This message would hand off to a human agent here.', at: Date.now() }] : []),
        ...(!r.agent_response && !r.handoff_reason && r.no_response_reason
          ? [{ from: 'system' as const, text: `The agent did not reply: ${r.no_response_reason}`, at: Date.now() }]
          : []),
      ])
    } catch (err) {
      if (err instanceof MetaError && err.status === 429) {
        // Meta limits test messages per number (500/h) and per app across every agent (10,000/h).
        setLimitMessage(
          /app|platform/i.test(err.message)
            ? 'Testing is temporarily at capacity across the platform. Try again later.'
            : "You've reached this agent's testing limit for the hour. Try again shortly.",
        )
      } else {
        toast.error("Couldn't reach the agent", { description: errorText(err) })
        setChatMessages((prev) => [...prev, { from: 'system', text: errorText(err), at: Date.now() }])
      }
    } finally {
      setSending(false)
    }
  }

  function startNewConversation() {
    if (chatMessages.length > 0 && !storeOn) {
      const next = [{ id: newId('testconv'), startedAt: chatMessages[0].at, messages: chatMessages }, ...history]
      setHistory(next)
      saveTestHistory(next)
    }
    setChatMessages([])
    setConversationId(undefined)
    setViewing(null)
  }

  // ---- Standard checks: each situation is sent to the real agent as its own conversation ----
  const [checkRows, setCheckRows] = useState<CheckRow[] | null>(null)
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null)

  async function runStandardChecks(forceAmberGreeting = false) {
    const defs = buildStandardChecks(state, forceAmberGreeting)
    setCheckRows(defs.map((d) => ({ ...d, reply: '', status: 'pending' })))
    const done: CheckRow[] = []
    for (const d of defs) {
      let row: CheckRow
      if (forceAmberGreeting) {
        // Demo control: show the stored-config preview without calling Meta.
        row = { ...d, status: d.finalStatus }
      } else {
        try {
          const r = await sendTestMessage(d.sent)
          const reply = r.agent_response || (r.handoff_reason ? 'This message would hand off to a human agent here.' : r.no_response_reason ?? '')
          row = { ...d, reply, status: r.handoff_reason || !r.agent_response ? 'warn' : 'normal' }
        } catch (err) {
          row = { ...d, reply: `Could not reach the agent: ${errorText(err)}`, status: 'warn' }
        }
      }
      done.push(row)
      setCheckRows((prev) => (prev ? prev.map((r) => (r.id === d.id ? row : r)) : prev))
    }
    patch('publish', { standardChecksRun: true })
    // Kept as history on the Activity page.
    patch('qualityChecks', (prev) => ({
      runs: [
        {
          id: newId('qcrun'),
          timestamp: Date.now(),
          items: done.map((r) => ({ id: r.id, situation: r.situation, sent: r.sent, reply: r.reply, status: r.status === 'warn' ? ('warn' as const) : ('normal' as const) })),
        },
        ...prev.runs,
      ],
    }))
  }

  // ---- Demo controls ----
  function demoLoadCompiledConfig() {
    const now = Date.now()
    patch('business', SAMPLE_BUSINESS_PROFILE)
    patch('knowledge', {
      faqs: SAMPLE_FAQS.map((f, i) => ({ id: newId('faq'), question: f.question, answer: f.answer, createdAt: now - i * 1000 })),
      documents: SAMPLE_DOCUMENTS.map((d) => ({
        id: newId('doc'),
        fileName: d.fileName,
        sizeBytes: d.sizeBytes,
        type: d.type,
        uploadedAt: now - d.daysAgo * 86_400_000,
      })),
      websites: SAMPLE_WEBSITES.map((w) => ({
        id: newId('site'),
        url: w.url,
        status: w.status,
        pagesRead: w.pagesRead,
        subpages: w.status === 'done' ? generateFakeSubpages(w.url, w.pagesRead) : [],
        updatedAt: now - w.daysAgo * 86_400_000,
      })),
    })
    const connectionId = newId('conn')
    const demoConnections: Connection[] = [
      {
        id: connectionId,
        name: 'Order lookup API',
        description: 'Looks up order status by order number.',
        baseUrl: 'https://api.example.com',
        authMethod: 'api_key',
        apiKeys: [{ id: newId('key'), value: 'sample-key', location: 'header', fieldName: 'X-API-Key', prefix: '' }],
        createdAt: now,
        demoStatus: 'working',
      },
    ]
    const demoActions: ConnectionAction[] = [
      {
        id: newId('action'),
        connectionId,
        name: 'Look up an order',
        description: 'find an order by its order number',
        method: 'GET',
        path: '/orders/{order_id}',
        values: [],
        createdAt: now,
      },
    ]
    patch('connections', { connections: demoConnections, actions: demoActions })
    patch('richReplies', { richReplies: SAMPLE_RICH_REPLIES })
    patch('guardrails', { neverSayPhrases: SAMPLE_NEVER_SAY_WORDS, topicsToAvoid: SAMPLE_TOPICS_TO_AVOID })
    toast.success('Sample configuration loaded')
  }

  useRegisterDevControls(
    'testEval',
    <DemoControlsGroup label="Test & Eval">
      <Button variant="outline" size="sm" onClick={demoLoadCompiledConfig}>
        Demo: load compiled configuration
      </Button>
      <Button variant="outline" size="sm" onClick={() => void runStandardChecks(true)}>
        Demo: simulate standard checks result
      </Button>
    </DemoControlsGroup>,
  )

  return (
    <Tabs defaultValue="testing">
      <TabsList>
        <TabsTrigger value="testing">Testing</TabsTrigger>
        <TabsTrigger value="eval">Evaluation</TabsTrigger>
      </TabsList>

      <TabsContent value="testing" className="space-y-4 pt-3">
        {/* Quick test */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Quick test</p>
              <InfoTooltip text="Test messages here are free and do not count toward your usage." />
            </span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setHistoryOpen((o) => !o)} aria-label="Test history">
                <History className="size-4" />
                Test history
              </Button>
              <Button size="sm" variant="outline" onClick={startNewConversation}>
                Start new conversation
              </Button>
            </span>
          </div>

          {ineligible && (
            <InlineError message="This number is no longer eligible for Meta Business Agent. Testing is unavailable until this is resolved." />
          )}
          {!ineligible && !hasAnyConfig && (
            <p className="flex items-center gap-1.5 rounded-lg bg-warning/10 p-2 text-warning-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              <AlertTriangle className="size-4 shrink-0" />
              This agent has no knowledge, skills, or other configuration set. Please navigate to the agent configuration section.
            </p>
          )}

          {historyOpen && (
            <div className="space-y-1 rounded-lg border border-border p-3">
              {history.length === 0 ? (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  No past test conversations yet.
                </p>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      setViewing(h)
                      setHistoryOpen(false)
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                    style={{ fontSize: 'var(--text-sm)' }}
                  >
                    <span className="truncate">{h.messages[0]?.text ?? '(empty)'}</span>
                    <span className="shrink-0 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                      {new Date(h.startedAt).toLocaleString()}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {isDummyMode() && !viewing ? (
            <DemoWhatsAppChat
              name={state.identity.companyName.trim() || state.gate.selectedWabaName?.trim() || state.identity.agentName.trim() || 'Your business'}
              messages={chatMessages}
              sending={sending}
              disabled={ineligible || !!limitMessage}
              onSend={(text, shown) => void sendQuickTest(text, shown)}
            />
          ) : (
            <div className="space-y-2 rounded-lg border border-border p-4">
              {viewing && (
                <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1" style={{ fontSize: 'var(--text-xs)' }}>
                  <span className="text-muted-foreground">Read-only: conversation from {new Date(viewing.startedAt).toLocaleString()}</span>
                  <button type="button" className="text-primary" onClick={() => setViewing(null)}>
                    Back to testing
                  </button>
                </div>
              )}
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {(viewing ? viewing.messages : chatMessages).length === 0 ? (
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    No messages yet.
                  </p>
                ) : (
                  (viewing ? viewing.messages : chatMessages).map((m, i, all) =>
                    m.from === 'system' ? (
                      <p key={i} className="text-center text-muted-foreground italic" style={{ fontSize: 'var(--text-xs)' }}>
                        {m.text}
                      </p>
                    ) : (
                      <div key={i} className={cn('flex flex-col', m.from === 'customer' ? 'items-end' : 'items-start')}>
                        <p
                          className={cn(
                            'max-w-[80%] rounded-lg px-3 py-1.5 whitespace-pre-wrap',
                            m.from === 'customer' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
                          )}
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {m.text}
                        </p>
                        {viewing && (
                          <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                            {new Date(m.at).toLocaleTimeString()}
                          </span>
                        )}
                        {/* Quick replies on the latest agent message, tappable like on WhatsApp. */}
                        {!viewing && m.quickReplies && m.quickReplies.length > 0 && i === all.length - 1 && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {m.quickReplies.map((qr) => (
                              <button
                                key={qr}
                                type="button"
                                onClick={() => void sendQuickTest(qr)}
                                disabled={sending || !!limitMessage || ineligible}
                                className="rounded-full border border-primary px-2.5 py-0.5 text-primary hover:bg-accent"
                                style={{ fontSize: 'var(--text-xs)' }}
                              >
                                {qr}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ),
                  )
                )}
                {sending && !viewing && (
                  <p className="flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    <Loader2 className="size-3 animate-spin" /> The agent is replying...
                  </p>
                )}
              </div>
              {limitMessage && <InlineError message={limitMessage} onRetry={() => setLimitMessage(null)} />}
              {!viewing && (
                <div className="flex items-center gap-2">
                  <Input
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void sendQuickTest()
                    }}
                    placeholder="Type a message to try..."
                    disabled={ineligible || !!limitMessage}
                  />
                  <Button size="icon" onClick={() => void sendQuickTest()} disabled={!chatDraft.trim() || sending || ineligible || !!limitMessage}>
                    <Send className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Standard checks */}
        <div className="space-y-2">
          <div>
            <span className="flex items-center gap-1.5">
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Standard checks</p>
              <InfoTooltip text="A short set of common situations, run automatically, so you don’t have to think of them yourself." />
            </span>
          </div>
          <Button variant="outline" onClick={() => void runStandardChecks(false)} disabled={checkRows !== null && checkRows.some((r) => r.status === 'pending')}>
            Run standard checks
          </Button>

          {checkRows && (
            <div className="space-y-2">
              {checkRows.map((row) => {
                const expanded = expandedCheck === row.id
                return (
                  <div key={row.id} className="rounded-lg border border-border px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpandedCheck(expanded ? null : row.id)}
                      disabled={row.status === 'pending'}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {row.status === 'pending' ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : row.status === 'normal' ? (
                          <CheckCircle2 className="size-4 shrink-0 text-success" />
                        ) : (
                          <AlertTriangle className="size-4 shrink-0 text-warning" />
                        )}
                        <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                          {row.situation}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                          {row.status === 'pending' ? '' : row.status === 'normal' ? 'Responded normally' : 'Check this'}
                        </span>
                        {row.status !== 'pending' && (
                          <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
                        )}
                      </span>
                    </button>
                    {expanded && row.status !== 'pending' && (
                      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
                        <p style={{ fontSize: 'var(--text-sm)' }}>
                          <span className="text-muted-foreground">Customer: </span>
                          {row.sent}
                        </p>
                        <p style={{ fontSize: 'var(--text-sm)' }}>
                          <span className="text-muted-foreground">Agent: </span>
                          {row.reply}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="eval" className="pt-3">
        <EvalTab />
      </TabsContent>
    </Tabs>
  )
}
