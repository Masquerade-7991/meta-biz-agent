import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, History, Loader2, MessageSquarePlus, Play, Sparkles } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/app/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { EvalTab } from './EvalTab'
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
  generateFakeSubpages,
  newId,
  pickConnectionPreviewReply,
} from '@/app/wizard/mockData'
import type { Connection, ConnectionAction, WizardState } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { checkEligibility, errorText, MetaError, sendTestMessage, testConversationTurns } from '@/app/api/meta'
import { findToolCalls, isMetaFallback } from '@/app/wizard/testTools'
import { BehindTheScenes, type ReplyInfo } from './ReplyDetails'
import { listTestConversations } from '@/app/api/store'
import { storageKey } from '@/app/api/dummy'
import type { DummyRich } from '@/app/api/dummyMeta'
import { DemoWhatsAppChat } from './DemoWhatsAppChat'
import { InlineError } from '@/app/components/wizard/RetryBanner'

interface ChatMessage {
  from: 'customer' | 'agent' | 'system'
  text: string
  at: number
  quickReplies?: string[]
  rich?: DummyRich
  /** What happened behind this reply (agent and no-reply messages): shown beside the phone, never in it. */
  details?: ReplyInfo
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
      sent: action.exampleQuestion?.trim() || `Can you help me ${action.name.replace(/_/g, ' ').toLowerCase()}?`,
      reply: connection ? pickConnectionPreviewReply({ action, connection }) : state.replies.fallbackReply,
      finalStatus: 'normal',
    })
  }

  return rows
}

export function TestEvalStep() {
  const { state, patch, setSection } = useWizard()
  // Tool calls are looked up only when the agent has tools to call.
  const hasTools = state.connections.actions.length > 0
  const openConnections = () => setSection('connections')

  // ---- Quick test: Meta's Agent Test API (not billed, 500/hour per number) ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  // conversation_id threads follow-ups into one conversation; cleared by Start New Conversation.
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [limitMessage, setLimitMessage] = useState<string | null>(null)
  const [ineligible, setIneligible] = useState(false)
  const [history, setHistory] = useState<TestConversation[]>(loadTestHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewing, setViewing] = useState<TestConversation | null>(null)
  // The agent message whose details are highlighted beside the phone.
  const [selected, setSelected] = useState<number | null>(null)
  const showConversation = (c: TestConversation | null) => {
    setViewing(c)
    setSelected(null)
  }
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
    state.connections.actions.length > 0 ||
    state.business.businessDescription.trim() !== ''

  /** `shown` replaces the customer's bubble text when `text` is a dummy-mode tap token. */
  async function sendQuickTest(raw: string, shown?: string) {
    const text = raw.trim()
    if (!text || sending) return
    showConversation(null)
    setChatMessages((prev) => [...prev, { from: 'customer', text: shown ?? text, at: Date.now() }])
    setSending(true)
    const sentAt = Date.now()
    try {
      const r = await sendTestMessage(text, conversationId)
      setConversationId(r.conversation_id)
      if (!state.publish.chatTested) patch('publish', { chatTested: true })
      const replyAt = Date.now()
      const lookTools = hasTools && !!r.agent_response && !!r.conversation_id
      const details: ReplyInfo = {
        asked: shown ?? text,
        ms: replyAt - sentAt,
        outcome: r.handoff_reason ? 'handoff' : !r.agent_response ? 'no_reply' : isMetaFallback(r.agent_response) ? 'failed' : 'replied',
        reason: r.handoff_reason || (!r.agent_response ? r.no_response_reason : undefined) || undefined,
        ...(lookTools ? { tools: { state: 'checking' as const } } : {}),
      }
      // The phone shows only what the customer would see; the rest goes beside it (details).
      setChatMessages((prev) => [
        ...prev,
        ...(r.agent_response ? [{ from: 'agent' as const, text: r.agent_response, at: replyAt, quickReplies: r.quick_replies, rich: r.dummy_rich, details }] : []),
        ...(r.handoff_reason ? [{ from: 'system' as const, text: 'Test note: a person on your team would take over here.', at: replyAt + 1, ...(r.agent_response ? {} : { details }) }] : []),
        ...(!r.agent_response && !r.handoff_reason ? [{ from: 'system' as const, text: 'Test note: the agent didn’t reply to this.', at: replyAt + 1, details }] : []),
      ])
      // Which tools it used: from the conversation's turns, which land about a second after the reply.
      if (lookTools)
        void findToolCalls(() => testConversationTurns(r.conversation_id), sentAt).then((calls) =>
          setChatMessages((prev) =>
            prev.map((m) => (m.at === replyAt && m.from === 'agent' && m.details ? { ...m, details: { ...m.details, tools: calls ? { state: 'done', calls } : { state: 'unknown' } } } : m)),
          ),
        )
    } catch (err) {
      if (err instanceof MetaError && err.status === 429) {
        // Meta limits test messages per number (500/h) and per app across every agent (10,000/h).
        setLimitMessage(
          /app|platform/i.test(err.message)
            ? 'Testing is temporarily at capacity across the platform. Try again later.'
            : "You've reached this agent's testing limit for the hour. Try again shortly.",
        )
      } else {
        // A 5xx is Meta's agent failing (seen live: a 500 after 30 s), not our connection.
        const metaFailed = err instanceof MetaError && err.status >= 500
        const ref = /\(Reference: [^)]+\)/.exec(errorText(err))?.[0]
        const text = metaFailed ? `The agent didn’t answer this time (Meta’s error). Try sending it again.${ref ? ` ${ref}` : ''}` : `Couldn’t reach the agent: ${errorText(err)}`
        toast.error(metaFailed ? 'The agent didn’t answer' : "Couldn't reach the agent", { description: metaFailed ? text : errorText(err) })
        setChatMessages((prev) => [...prev, { from: 'system', text, at: Date.now() }])
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
    showConversation(null)
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
          const reply = r.agent_response || (r.handoff_reason ? 'A person on your team would take over here.' : r.no_response_reason ?? '')
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
        name: 'Order_lookup_API',
        description: 'Looks up order status by order number.',
        baseUrl: 'https://api.example.com',
        authMethod: 'api_key',
        apiKeys: [{ id: newId('key'), value: '', location: 'header', fieldName: 'X-API-Key', prefix: '', hint: 'k3y9' }],
        createdAt: now,
        demoStatus: 'working',
      },
    ]
    const demoActions: ConnectionAction[] = [
      {
        id: newId('action'),
        connectionId,
        name: 'look_up_order',
        description: 'Use when a customer asks where their order is. Looks up the order by its number and returns its status.',
        exampleQuestion: 'Where is my order ORD-12345?',
        method: 'GET',
        path: '/orders/{order_id}',
        values: [{ id: newId('value'), name: 'order_id', type: 'text', required: true, location: 'path', source: 'conversation', description: 'The order number, like ORD-12345' }],
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

  const shownMessages = viewing ? viewing.messages : chatMessages
  const replies = shownMessages.flatMap((m, index) => (m.details ? [{ index, info: m.details }] : []))
  // Questions to try: a few every agent should handle, plus each tool's own example.
  const suggestions = [
    ...state.connections.actions.map((a) => a.exampleQuestion?.trim()).filter((q): q is string => !!q),
    'What do you sell?',
    'Can I talk to a person?',
    'Where is my order?',
  ].filter((q, i, all) => all.indexOf(q) === i).slice(0, 5)
  const blocked = ineligible || !!limitMessage
  const checksDone = checkRows?.filter((r) => r.status !== 'pending') ?? []
  const toReview = checksDone.filter((r) => r.status === 'warn').length

  return (
    <Tabs defaultValue="chat">
      <TabsList>
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="checks">
          Standard checks
          {checksDone.length > 0 && toReview > 0 && <span className="rounded-full bg-warning/20 px-1.5 text-warning-foreground text-xs">{toReview}</span>}
        </TabsTrigger>
        <TabsTrigger value="eval">Evaluation</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="space-y-4">
        {/* One notice at most, above everything. */}
        {ineligible ? (
          <InlineError message="This number is no longer eligible for Meta Business Agent. Testing is unavailable until this is resolved." />
        ) : limitMessage ? (
          <InlineError message={limitMessage} onRetry={() => setLimitMessage(null)} />
        ) : (
          !hasAnyConfig && (
            <p className="flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-warning-foreground text-sm">
              <AlertTriangle className="size-4 shrink-0" />
              Your agent has nothing to go on yet. Add knowledge or a skill first, then test it here.
            </p>
          )
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            Chat with your agent as a customer would. Free, up to 500 messages an hour.
          </p>
          <div className="flex items-center gap-2">
            <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  <History className="size-4" /> History
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
                <DropdownMenuLabel className="text-xs">Past test conversations</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {history.length === 0 ? (
                  <p className="px-2 py-3 text-muted-foreground text-sm">
                    None yet.
                  </p>
                ) : (
                  history.map((h) => (
                    <DropdownMenuItem
                      key={h.id}
                      onClick={() => showConversation(h)}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="line-clamp-1 text-sm">
                        {h.messages[0]?.text ?? '(empty)'}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(h.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {h.messages.length} messages
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={startNewConversation} disabled={sending}>
              <MessageSquarePlus className="size-4" /> New conversation
            </Button>
          </div>
        </div>

        {viewing && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Viewing a past test from {new Date(viewing.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <button type="button" className="text-primary hover:underline" onClick={() => showConversation(null)}>
              Back to testing
            </button>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="space-y-3">
            <DemoWhatsAppChat
              name={state.identity.companyName.trim() || state.gate.selectedWabaName?.trim() || state.identity.agentName.trim() || 'Your business'}
              messages={shownMessages}
              sending={sending && !viewing}
              disabled={blocked}
              readOnly={!!viewing}
              selected={selected}
              onSelect={(i) => setSelected(i)}
              onSend={(text, shown) => void sendQuickTest(text, shown)}
            />
            {!viewing && !sending && !blocked && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Sparkles className="size-3.5" /> Try asking
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void sendQuickTest(q)}
                      className="rounded-full border border-border bg-card px-3 py-1 text-left hover:border-primary hover:text-primary text-xs"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="lg:sticky lg:top-4 lg:max-h-168">
            <BehindTheScenes replies={replies} selected={selected} onSelect={setSelected} hasTools={hasTools} onOpenConnections={openConnections} />
          </div>
        </div>
      </TabsContent>

      <TabsContent value="checks" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="space-y-0.5">
            <p className="font-semibold">
              {!checkRows
                ? 'Common situations, checked for you'
                : checksDone.length < checkRows.length
                  ? `Checking ${checksDone.length + 1} of ${checkRows.length}…`
                  : `${checkRows.length} situations · ${checkRows.length - toReview} replied normally${toReview ? ` · ${toReview} to check` : ''}`}
            </p>
            <p className="text-muted-foreground text-sm">
              Each one is sent to your real agent as a new conversation, so you don&rsquo;t have to think of them.
            </p>
          </div>
          <Button onClick={() => void runStandardChecks(false)} disabled={(checkRows !== null && checksDone.length < checkRows.length) || ineligible}>
            {checkRows !== null && checksDone.length < checkRows.length ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {checkRows ? 'Run again' : 'Run standard checks'}
          </Button>
        </div>

        {checkRows && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {checkRows.map((row) => {
              const expanded = expandedCheck === row.id
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedCheck(expanded ? null : row.id)}
                    disabled={row.status === 'pending'}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/30"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      {row.status === 'pending' ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : row.status === 'normal' ? (
                        <CheckCircle2 className="size-4 shrink-0 text-success" />
                      ) : (
                        <AlertTriangle className="size-4 shrink-0 text-warning" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{row.situation}</span>
                        {row.status !== 'pending' && (
                          <span className="block truncate text-xs text-muted-foreground">{row.reply ? `“${row.reply.replace(/\s+/g, ' ')}”` : 'No reply'}</span>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground text-sm">
                      {row.status === 'pending' ? 'Checking…' : row.status === 'normal' ? 'Answered' : 'Check this'}
                      {row.status !== 'pending' && <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />}
                    </span>
                  </button>
                  {expanded && row.status !== 'pending' && (
                    <div className="space-y-2 bg-muted/30 px-4 py-3">
                      <p className="ml-auto w-fit max-w-[80%] rounded-lg rounded-br-sm bg-primary px-3 py-1.5 text-primary-foreground text-sm">
                        {row.sent}
                      </p>
                      <p className="w-fit max-w-[80%] rounded-lg rounded-bl-sm border border-border bg-card px-3 py-1.5 whitespace-pre-wrap text-sm">
                        {row.reply || '(no reply)'}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="eval">
        <EvalTab />
      </TabsContent>
    </Tabs>
  )
}
