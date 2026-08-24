import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { cn } from '@/app/lib/utils'
import {
  EVAL_RESULTS,
  EVAL_SCENARIOS,
  deriveWeakResult,
  scoreBandLabel,
  type EvalConversationResult,
  type EvalScenario,
} from './evalData'

type Stage = 'simulation' | 'evaluation' | 'insights' | 'done'
type Status = 'idle' | 'running' | 'completed' | 'failed'

const STAGES: Stage[] = ['simulation', 'evaluation', 'insights', 'done']
const STAGE_LABEL: Record<Stage, string> = {
  simulation: 'Simulation',
  evaluation: 'Evaluation',
  insights: 'Insights',
  done: 'Done',
}
const STAGE_ACTIVE_TEXT: Record<Exclude<Stage, 'done'>, string> = {
  simulation: 'Simulating the conversation...',
  evaluation: 'Scoring the conversation...',
  insights: 'Finding patterns...',
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resultFor(scenarioId: string): EvalConversationResult {
  return EVAL_RESULTS.find((r) => r.scenarioId === scenarioId)!
}

function reasonIcon(score: number) {
  if (score >= 4) return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
  if (score >= 3) return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
  return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
}

interface CardState {
  status: Status
  stage: Stage
  result: EvalConversationResult | null
  rerunning: boolean
  viewingConversation: boolean
  showFailureDetails: boolean
}

function initialCardState(): CardState {
  return { status: 'idle', stage: 'simulation', result: null, rerunning: false, viewingConversation: false, showFailureDetails: false }
}

type CasesStatus = 'idle' | 'loading' | 'loaded'

export function EvalTab() {
  // Nothing renders until the real GET /cases call is made — this mirrors the real endpoint,
  // which lists a client's eval scenarios on demand rather than something the wizard already has.
  const [casesStatus, setCasesStatus] = useState<CasesStatus>('idle')
  const [cards, setCards] = useState<Record<string, CardState>>({})
  // Per-scenario run tokens, so a stale "Run again" from an earlier click can't clobber a newer one.
  const tokensRef = useRef<Record<string, number>>({})

  function pullEvalCases() {
    setCasesStatus('loading')
    setTimeout(() => {
      setCards(Object.fromEntries(EVAL_SCENARIOS.map((s) => [s.id, initialCardState()])))
      setCasesStatus('loaded')
    }, 700)
  }

  useEffect(() => {
    const tokens = tokensRef.current
    return () => {
      for (const id of Object.keys(tokens)) tokens[id] = (tokens[id] ?? 0) + 1
    }
  }, [])

  function patchCard(id: string, patch: Partial<CardState>) {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function runStages(id: string, token: number) {
    const isCurrent = () => tokensRef.current[id] === token
    for (const stage of STAGES.slice(0, -1) as Exclude<Stage, 'done'>[]) {
      patchCard(id, { stage })
      await sleep(stage === 'insights' ? 700 : 550)
      if (!isCurrent()) return
    }
    patchCard(id, { status: 'completed', stage: 'done', result: resultFor(id), rerunning: false })
  }

  function startEval(id: string) {
    tokensRef.current[id] = (tokensRef.current[id] ?? 0) + 1
    const token = tokensRef.current[id]
    setCards((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        status: 'running',
        stage: 'simulation',
        rerunning: prev[id].status === 'completed',
        viewingConversation: false,
        showFailureDetails: false,
      },
    }))
    runStages(id, token)
  }

  // ---- Demo controls, one set per scenario plus the "returning visitor" restore ----
  function demoComplete(id: string, strong: boolean) {
    tokensRef.current[id] = (tokensRef.current[id] ?? 0) + 1
    const result = strong ? resultFor(id) : deriveWeakResult(resultFor(id))
    patchCard(id, { status: 'completed', stage: 'done', result, rerunning: false, viewingConversation: false })
  }

  function demoFail(id: string) {
    tokensRef.current[id] = (tokensRef.current[id] ?? 0) + 1
    patchCard(id, { status: 'failed', rerunning: false, showFailureDetails: false })
  }

  function demoLoadAllCompleted() {
    for (const id of Object.keys(tokensRef.current)) tokensRef.current[id] = (tokensRef.current[id] ?? 0) + 1
    setCards(
      Object.fromEntries(
        EVAL_SCENARIOS.map((s) => [
          s.id,
          { ...initialCardState(), status: 'completed' as Status, stage: 'done' as Stage, result: resultFor(s.id) },
        ]),
      ),
    )
    setCasesStatus('loaded')
  }

  useRegisterDevControls(
    'eval',
    <DemoControlsGroup label="Evaluation">
      <Button variant="outline" size="sm" onClick={pullEvalCases}>
        Demo: pull eval cases now
      </Button>
      <Button variant="outline" size="sm" onClick={demoLoadAllCompleted}>
        Demo: load all as previously completed
      </Button>
      {casesStatus === 'loaded' &&
        EVAL_SCENARIOS.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              {s.title}:
            </span>
            <Button variant="outline" size="sm" onClick={() => startEval(s.id)}>
              Run
            </Button>
            <Button variant="outline" size="sm" onClick={() => demoComplete(s.id, true)}>
              Complete, strong
            </Button>
            <Button variant="outline" size="sm" onClick={() => demoComplete(s.id, false)}>
              Complete, weak
            </Button>
            <Button variant="outline" size="sm" onClick={() => demoFail(s.id)}>
              Fail
            </Button>
          </div>
        ))}
    </DemoControlsGroup>,
  )

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          This shows what Eval will look like. Meta doesn&rsquo;t yet document a way to create scenarios ourselves,
          so the scenarios and results below are illustrative, not real evaluations of this agent.
        </p>
      </div>

      {casesStatus === 'idle' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No eval cases loaded yet.
          </p>
          <Button onClick={pullEvalCases}>Pull eval cases</Button>
        </div>
      )}

      {casesStatus === 'loading' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            Pulling eval cases&hellip;
          </p>
        </div>
      )}

      {casesStatus === 'loaded' && (
        <div className="space-y-3">
          {EVAL_SCENARIOS.map((scenario) => (
            <EvalCard
              key={scenario.id}
              scenario={scenario}
              card={cards[scenario.id]}
              onStart={() => startEval(scenario.id)}
              onToggleConversation={() =>
                patchCard(scenario.id, { viewingConversation: !cards[scenario.id].viewingConversation })
              }
              onToggleFailureDetails={() =>
                patchCard(scenario.id, { showFailureDetails: !cards[scenario.id].showFailureDetails })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EvalCard({
  scenario,
  card,
  onStart,
  onToggleConversation,
  onToggleFailureDetails,
}: {
  scenario: EvalScenario
  card: CardState
  onStart: () => void
  onToggleConversation: () => void
  onToggleFailureDetails: () => void
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const stageIndex = STAGES.indexOf(card.stage)

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left"
          onClick={() => setDetailOpen((v) => !v)}
        >
          {detailOpen ? (
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate" style={{ fontWeight: 'var(--font-weight-medium)' }}>
            {scenario.title}
          </span>
        </button>
        <Badge variant="outline" className="shrink-0">
          {scenario.category}
        </Badge>
      </div>

      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
        {scenario.whatHappens}
      </p>

      {detailOpen && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Max {scenario.maxTurns} turns
          </p>
          <div>
            <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>To pass, the agent must:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5" style={{ fontSize: 'var(--text-sm)' }}>
              {scenario.successCriteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {card.status === 'idle' && (
        <Button size="sm" onClick={onStart}>
          Start eval
        </Button>
      )}

      {card.status === 'running' && (
        <div className="space-y-3">
          {card.rerunning && card.result && (
            <div className="opacity-40">
              <CompletedBody result={card.result} />
            </div>
          )}
          <div className="space-y-2">
            <p style={{ fontSize: 'var(--text-sm)' }}>{STAGE_ACTIVE_TEXT[card.stage as Exclude<Stage, 'done'>]}</p>
            <ol className="flex flex-wrap items-center gap-1.5">
              {STAGES.map((s, i) => (
                <li key={s} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'flex items-center gap-1',
                      i < stageIndex ? 'text-success' : i === stageIndex ? '' : 'text-muted-foreground',
                    )}
                    style={{ fontSize: 'var(--text-sm)', fontWeight: i === stageIndex ? 'var(--font-weight-medium)' : 'var(--font-weight-regular)' }}
                  >
                    {i < stageIndex && <CheckCircle2 className="size-3.5" />}
                    {STAGE_LABEL[s]}
                  </span>
                  {i < STAGES.length - 1 && <ChevronRight className="size-3.5 text-muted-foreground" />}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {card.status === 'failed' && (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Could not complete</p>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            Something went wrong during Simulation.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onToggleFailureDetails}>
              {card.showFailureDetails ? 'Hide details' : 'View details'}
            </Button>
            <Button size="sm" onClick={onStart}>
              Try again
            </Button>
          </div>
          {card.showFailureDetails && (
            <p className="text-muted-foreground font-mono" style={{ fontSize: 'var(--text-xs)' }}>
              SIMULATION_FAILED
            </p>
          )}
        </div>
      )}

      {card.status === 'completed' && card.result && (
        <div className="space-y-3">
          <CompletedBody result={card.result} />
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={onToggleConversation}>
              {card.viewingConversation ? 'Hide full conversation' : 'View full conversation'}
            </Button>
            <Button variant="outline" size="sm" onClick={onStart}>
              Run again
            </Button>
          </div>
          {card.viewingConversation && <ConversationDetail result={card.result} />}
        </div>
      )}
    </section>
  )
}

function CompletedBody({ result }: { result: EvalConversationResult }) {
  const band = scoreBandLabel(result.score)
  const struggles = result.reasons.filter((r) => r.recommendedAction)

  return (
    <div className="space-y-3">
      <div>
        <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-medium)' }}>{result.score.toFixed(1)} / 5</p>
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          {band}
        </p>
      </div>

      <p className="italic text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
        &ldquo;{result.summary}&rdquo;
      </p>

      {struggles.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between px-1">
            <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>Where it struggled</p>
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              Fix this by
            </p>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border">
            {struggles.map((r) => (
              <div key={r.category} className="flex items-start justify-between gap-4 p-3">
                <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>{r.category}</p>
                <p className="max-w-xs text-right text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  {r.recommendedAction}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ConversationDetail({ result }: { result: EvalConversationResult }) {
  return (
    <div className="space-y-4 rounded-md border border-border bg-muted/20 p-3">
      <div>
        <p className="mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          Transcript
        </p>
        <div className="space-y-1.5">
          {result.transcript.map((line, i) => (
            <div key={i} className={cn('flex', line.from === 'customer' ? 'justify-end' : 'justify-start')}>
              <p
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-1.5',
                  line.from === 'customer' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted',
                )}
                style={{ fontSize: 'var(--text-sm)' }}
              >
                {line.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1 flex items-center gap-1.5">
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            Breakdown
          </p>
          <InfoTooltip text="Meta documents `reasons` as a category/score/description breakdown per evaluation. Shown here directly, unlike per_turn_labels which is only an array of integers with no defined meaning." />
        </span>
        <div className="space-y-2.5">
          {result.reasons.map((r) => (
            <div key={r.category} className="flex items-start gap-2">
              {reasonIcon(r.score)}
              <div className="min-w-0">
                <p style={{ fontSize: 'var(--text-sm)' }}>
                  <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{r.category}</span> — {r.score} / 5
                </p>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  {r.description}
                </p>
                {r.recommendedAction && (
                  <p className="mt-0.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    Recommended: {r.recommendedAction}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
