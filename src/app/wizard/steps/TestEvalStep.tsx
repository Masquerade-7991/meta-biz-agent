import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Send } from 'lucide-react'
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
  matchConnectionPreviewMessage,
  matchFaqPreviewMessage,
  newId,
  pickConnectionPreviewReply,
} from '@/app/wizard/mockData'
import type { Connection, ConnectionAction, WizardState } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

function simulateAgentReply(state: WizardState, message: string): string {
  const faqMatches = matchFaqPreviewMessage(message, state.knowledge.faqs)
  if (faqMatches.length > 0) return faqMatches[0].answer
  const connMatches = matchConnectionPreviewMessage(message, state.connections.connections, state.connections.actions)
  if (connMatches.length > 0) return pickConnectionPreviewReply(connMatches[0])
  if (/\b(hi|hello|hey)\b/i.test(message)) return state.replies.greetingReply
  return state.replies.fallbackReply
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

  // ---- Quick test (local, per-visit only — no history kept between visits) ----
  const [chatMessages, setChatMessages] = useState<{ from: 'customer' | 'agent'; text: string }[]>([])
  const [chatDraft, setChatDraft] = useState('')

  function sendQuickTest() {
    const text = chatDraft.trim()
    if (!text) return
    setChatDraft('')
    setChatMessages((prev) => [...prev, { from: 'customer', text }])
    setTimeout(() => {
      setChatMessages((prev) => [...prev, { from: 'agent', text: simulateAgentReply(state, text) }])
    }, 700)
  }

  // ---- Standard checks (local per-visit rows, but "has this run at least once" is real,
  // persisted agent state — see standardChecksRun on PublishState — since the separate Publish
  // page needs to read it even after a visitor navigates away and comes back later.) ----
  const [checkRows, setCheckRows] = useState<CheckRow[] | null>(null)
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null)

  function runStandardChecks(forceAmberGreeting = false) {
    const defs = buildStandardChecks(state, forceAmberGreeting)
    setCheckRows(defs.map((d) => ({ ...d, status: 'pending' })))
    defs.forEach((d, i) => {
      setTimeout(() => {
        setCheckRows((prev) => (prev ? prev.map((r) => (r.id === d.id ? { ...r, status: d.finalStatus } : r)) : prev))
        if (i === defs.length - 1) patch('publish', { standardChecksRun: true })
      }, (i + 1) * 500)
    })
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
      <Button variant="outline" size="sm" onClick={() => runStandardChecks(true)}>
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
          <span className="flex items-center gap-1.5">
            <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Quick test</p>
            <InfoTooltip text="Test messages here are free and do not count toward your usage." />
          </span>
          <div className="space-y-2 rounded-lg border border-border p-4">
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {chatMessages.length === 0 ? (
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  No messages yet.
                </p>
              ) : (
                chatMessages.map((m, i) => (
                  <div key={i} className={cn('flex', m.from === 'customer' ? 'justify-end' : 'justify-start')}>
                    <p
                      className={cn(
                        'max-w-[80%] rounded-lg px-3 py-1.5',
                        m.from === 'customer' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
                      )}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      {m.text}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendQuickTest()
                }}
                placeholder="Type a message to try..."
              />
              <Button size="icon" onClick={sendQuickTest} disabled={!chatDraft.trim()}>
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Standard checks */}
        <div className="space-y-2">
          <div>
            <span className="flex items-center gap-1.5">
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Standard checks</p>
              <InfoTooltip text="A short set of common situations, run automatically, so you don’t have to think of them yourself." />
            </span>
          </div>
          <Button variant="outline" onClick={() => runStandardChecks(false)} disabled={checkRows !== null && checkRows.some((r) => r.status === 'pending')}>
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
