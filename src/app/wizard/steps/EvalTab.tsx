import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Checkbox } from '@/app/components/ui/checkbox'
import { Badge } from '@/app/components/ui/badge'
import { Progress } from '@/app/components/ui/progress'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/app/components/ui/accordion'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { useWizard } from '@/app/wizard/WizardContext'
import { cn } from '@/app/lib/utils'
import {
  DEMO_FAILING_SCENARIO_ID,
  EVAL_FAILURE_CATEGORIES,
  EVAL_HEADLINE_SCORES,
  EVAL_HEADLINE_SCORES_LOW,
  EVAL_HIGHLIGHTS,
  EVAL_RESULTS,
  EVAL_SCENARIOS,
  EVAL_SUMMARY,
  scoreBandLabel,
  type EvalScenario,
} from './evalData'

type Stage = 'simulation' | 'evaluation' | 'insights' | 'done'
type RunState = 'idle' | 'running' | 'results' | 'failed'
type RunOutcome = 'full_success' | 'partial_failure'

const STAGES: Stage[] = ['simulation', 'evaluation', 'insights', 'done']
const STAGE_TRACKER_LABEL: Record<Stage, string> = {
  simulation: 'Simulation',
  evaluation: 'Evaluation',
  insights: 'Insights',
  done: 'Done',
}
const STAGE_DETAIL: Record<Exclude<Stage, 'done'>, { label: string; description: string }> = {
  simulation: {
    label: 'Simulating conversations',
    description:
      "A simulated customer is having each selected scenario's conversation with your agent, up to the turn limit for that scenario.",
  },
  evaluation: {
    label: 'Scoring conversations',
    description: "Each finished conversation is being scored against its scenario's success criteria.",
  },
  insights: {
    label: 'Finding patterns',
    description: 'Looking across every scored conversation for common strengths and common problems.',
  },
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function scenarioById(id: string): EvalScenario | undefined {
  return EVAL_SCENARIOS.find((s) => s.id === id)
}

export function EvalTab() {
  const { setSection } = useWizard()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(EVAL_SCENARIOS.map((s) => s.id)))
  const [ranIds, setRanIds] = useState<string[]>(EVAL_SCENARIOS.map((s) => s.id))
  const [failedIds, setFailedIds] = useState<string[]>([])
  const [runState, setRunState] = useState<RunState>('idle')
  const [stage, setStage] = useState<Stage>('simulation')
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [lowScores, setLowScores] = useState(false)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [showFailureDetails, setShowFailureDetails] = useState(false)
  const [showTechnical, setShowTechnical] = useState(false)

  const runTokenRef = useRef(0)
  useEffect(() => () => void (runTokenRef.current += 1), [])

  function toggleScenario(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runStages(total: number, token: number) {
    const isCurrent = () => runTokenRef.current === token
    setStage('simulation')
    setProgress({ completed: 0, total })
    for (let i = 1; i <= total; i++) {
      await sleep(420)
      if (!isCurrent()) return
      setProgress({ completed: i, total })
    }
    setStage('evaluation')
    setProgress({ completed: 0, total })
    for (let i = 1; i <= total; i++) {
      await sleep(420)
      if (!isCurrent()) return
      setProgress({ completed: i, total })
    }
    setStage('insights')
    await sleep(900)
    if (!isCurrent()) return
    setStage('done')
    setRunState('results')
  }

  function startRun(outcome: RunOutcome, animate: boolean) {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : EVAL_SCENARIOS.map((s) => s.id)
    runTokenRef.current += 1
    const token = runTokenRef.current
    setRanIds(ids)
    setFailedIds(outcome === 'partial_failure' ? [DEMO_FAILING_SCENARIO_ID] : [])
    setViewingId(null)
    setShowFailureDetails(false)
    if (!animate) {
      setRunState('results')
      return
    }
    setRunState('running')
    runStages(ids.length, token)
  }

  function showFailureDirectly() {
    runTokenRef.current += 1
    setFailedIds([DEMO_FAILING_SCENARIO_ID])
    setRanIds(Array.from(selectedIds.size > 0 ? selectedIds : new Set(EVAL_SCENARIOS.map((s) => s.id))))
    setViewingId(null)
    setShowFailureDetails(false)
    setShowTechnical(false)
    setRunState('failed')
  }

  function demoSelectFewer() {
    if (selectedIds.size >= EVAL_SCENARIOS.length) {
      const next = new Set(selectedIds)
      next.delete('discount-request')
      next.delete('off-topic')
      setSelectedIds(next)
    } else {
      setSelectedIds(new Set(EVAL_SCENARIOS.map((s) => s.id)))
    }
  }

  useRegisterDevControls(
    'eval',
    <DemoControlsGroup label="Eval">
      <Button variant="outline" size="sm" onClick={() => startRun('full_success', true)}>
        Demo: run eval, full success
      </Button>
      <Button variant="outline" size="sm" onClick={() => startRun('partial_failure', true)}>
        Demo: run eval, partial failure
      </Button>
      <Button variant="outline" size="sm" onClick={showFailureDirectly}>
        Demo: run eval, full failure
      </Button>
      <Button variant="outline" size="sm" onClick={() => setLowScores((v) => !v)}>
        {lowScores ? 'Demo: force low scores (on)' : 'Demo: force low scores'}
      </Button>
      <Button variant="outline" size="sm" onClick={demoSelectFewer}>
        Demo: select fewer scenarios
      </Button>
      <Button variant="outline" size="sm" onClick={() => startRun('full_success', false)}>
        Demo: jump to results
      </Button>
    </DemoControlsGroup>,
  )

  const scores = lowScores ? EVAL_HEADLINE_SCORES_LOW : EVAL_HEADLINE_SCORES
  const stageIndex = STAGES.indexOf(stage)
  const viewingScenario = viewingId ? scenarioById(viewingId) : null
  const viewingResult = viewingId ? EVAL_RESULTS.find((r) => r.scenarioId === viewingId) : null

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          This shows what Eval will look like. Meta doesn&rsquo;t yet document a way to create scenarios ourselves,
          so the scenarios and results below are illustrative, not real evaluations of this agent.
        </p>
      </div>

      {/* Scenario library */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Scenarios</p>
          <Button size="sm" disabled={selectedIds.size === 0 || runState === 'running'} onClick={() => startRun('full_success', true)}>
            Run eval
          </Button>
        </div>

        <Accordion type="multiple" className="space-y-2">
          {EVAL_SCENARIOS.map((scenario) => (
            <AccordionItem key={scenario.id} value={scenario.id} className="rounded-lg border border-border px-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedIds.has(scenario.id)}
                  onCheckedChange={() => toggleScenario(scenario.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Include ${scenario.title}`}
                />
                <AccordionTrigger className="flex-1 py-2.5 hover:no-underline">
                  <span className="flex w-full min-w-0 items-center justify-between gap-2 pr-2">
                    <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                      {scenario.title}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {scenario.category}
                    </Badge>
                  </span>
                </AccordionTrigger>
              </div>
              <AccordionContent className="space-y-2 pb-3">
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Max {scenario.maxTurns} turns
                </p>
                <p style={{ fontSize: 'var(--text-sm)' }}>
                  <span style={{ fontWeight: 'var(--font-weight-medium)' }}>What happens: </span>
                  {scenario.whatHappens}
                </p>
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>To pass, the agent must:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5" style={{ fontSize: 'var(--text-sm)' }}>
                    {scenario.successCriteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          {selectedIds.size} of {EVAL_SCENARIOS.length} selected
        </p>
      </section>

      {/* Staged progress */}
      {runState === 'running' && (
        <section className="space-y-4 rounded-lg border border-border p-4">
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
                  {STAGE_TRACKER_LABEL[s]}
                </span>
                {i < STAGES.length - 1 && <ChevronRight className="size-3.5 text-muted-foreground" />}
              </li>
            ))}
          </ol>

          {stage !== 'done' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{STAGE_DETAIL[stage].label}</p>
                {stage !== 'insights' && (
                  <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    {progress.completed} of {progress.total}
                  </span>
                )}
              </div>
              {stage === 'insights' ? (
                <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  <Loader2 className="size-4 animate-spin" />
                  Looking across every scored conversation
                </div>
              ) : (
                <Progress value={progress.total ? (progress.completed / progress.total) * 100 : 0} />
              )}
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                {STAGE_DETAIL[stage].description}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Failure state */}
      {runState === 'failed' && (
        <section className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Could not complete</p>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            Something went wrong during Simulation. {failedIds.length} scenario{failedIds.length === 1 ? '' : 's'} could not be
            run.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFailureDetails((v) => !v)}>
              View details
            </Button>
            <Button size="sm" onClick={() => startRun('full_success', true)}>
              Try again
            </Button>
          </div>
          {showFailureDetails && (
            <div className="space-y-1.5 rounded-md border border-border bg-card p-3">
              {failedIds.map((id) => (
                <p key={id} style={{ fontSize: 'var(--text-sm)' }}>
                  {scenarioById(id)?.title} could not be simulated.
                </p>
              ))}
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-2"
                style={{ fontSize: 'var(--text-xs)' }}
                onClick={() => setShowTechnical((v) => !v)}
              >
                {showTechnical ? 'Hide technical detail' : 'Show technical detail'}
              </button>
              {showTechnical && (
                <p className="text-muted-foreground font-mono" style={{ fontSize: 'var(--text-xs)' }}>
                  SIMULATION_FAILED
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Results */}
      {runState === 'results' && !viewingId && (
        <div className="space-y-6">
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ScoreCard
              label="Conversation score"
              score={scores.avgConversationScore}
              explain="Judges the whole scripted exchange end to end."
            />
            <ScoreCard label="Turn score" score={scores.avgTurnScore} explain="Judges individual exchanges — a finer-grained measure." />
          </section>

          <section className="space-y-4">
            <div>
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Summary</p>
              <p className="mt-1 italic text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                &ldquo;{EVAL_SUMMARY}&rdquo;
              </p>
            </div>

            <div>
              <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Where it did well</p>
              <ul className="mt-1.5 space-y-1.5">
                {EVAL_HIGHLIGHTS.map((h) => (
                  <li key={h} className="flex items-start gap-2" style={{ fontSize: 'var(--text-sm)' }}>
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between px-1">
                <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Where it struggled</p>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  Fix this by
                </p>
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {EVAL_FAILURE_CATEGORIES.map((row) => (
                  <div key={row.category} className="flex items-start justify-between gap-4 p-3">
                    <div className="min-w-0">
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>{row.category}</p>
                      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        {row.caseCount} case{row.caseCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="max-w-xs text-right" style={{ fontSize: 'var(--text-sm)' }}>
                      {row.linkSection ? (
                        <button
                          type="button"
                          className="text-primary underline underline-offset-2"
                          onClick={() => setSection(row.linkSection!)}
                        >
                          {row.recommendedAction}
                        </button>
                      ) : (
                        <p className="text-muted-foreground">{row.recommendedAction}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Individual conversations</p>
            <div className="divide-y divide-border rounded-lg border border-border">
              {ranIds.map((id) => {
                const scenario = scenarioById(id)
                if (!scenario) return null
                const failed = failedIds.includes(id)
                const result = EVAL_RESULTS.find((r) => r.scenarioId === id)
                return (
                  <div key={id} className="flex items-center justify-between gap-3 p-3">
                    <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                      {scenario.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {failed ? (
                        <span className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                          Could not be evaluated
                        </span>
                      ) : (
                        <span style={{ fontSize: 'var(--text-sm)' }}>{result?.score} / 5</span>
                      )}
                      <Button variant="outline" size="sm" disabled={failed} onClick={() => setViewingId(id)}>
                        View
                      </Button>
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}

      {/* Individual conversation detail */}
      {runState === 'results' && viewingId && viewingScenario && viewingResult && (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setViewingId(null)}>
              <ArrowLeft className="size-4" />
              Back to results
            </Button>
            <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{viewingResult.score} / 5</span>
          </div>

          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>{viewingScenario.title}</p>

          <div>
            <p className="mb-1 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              Transcript
            </p>
            <div className="space-y-1.5">
              {viewingResult.transcript.map((line, i) => (
                <p key={i} style={{ fontSize: 'var(--text-sm)' }}>
                  <span className="text-muted-foreground">{line.from === 'customer' ? 'Customer: ' : 'Agent: '}</span>
                  {line.text}
                </p>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 flex items-center gap-1.5">
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                Turn by turn
              </p>
              <InfoTooltip text="Meta documents per-turn labels only as an array of integers, with no defined meaning. This reads them as pass / partial concern / failure — the first assumption to revisit if that's ever confirmed otherwise." />
            </span>
            <div className="space-y-2.5">
              {viewingResult.turns.map((t) => (
                <div key={t.turn} className="flex items-start gap-2">
                  <span className="w-14 shrink-0 text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Turn {t.turn}
                  </span>
                  {t.status === 'check' ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : t.status === 'warn' ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0">
                    <p style={{ fontSize: 'var(--text-sm)' }}>{t.description}</p>
                    {t.recommended && (
                      <p className="mt-0.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        Recommended: {t.recommended}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function ScoreCard({ label, score, explain }: { label: string; score: number; explain: string }) {
  const pct = Math.max(0, Math.min(1, (score - 1) / 4))
  const band = scoreBandLabel(score)
  const color = score >= 3.5 ? 'var(--chart-2)' : score >= 2.5 ? 'var(--chart-4)' : 'var(--chart-3)'
  const r = 28
  const circumference = 2 * Math.PI * r

  return (
    <div className="rounded-lg border border-border p-4">
      <span className="flex items-center gap-1.5">
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          {label}
        </p>
        <InfoTooltip text={explain} />
      </span>
      <div className="mt-2 flex items-center gap-4">
        <svg width={72} height={72} viewBox="0 0 72 72" className="shrink-0">
          <circle cx={36} cy={36} r={r} fill="none" stroke="var(--border)" strokeWidth={8} />
          <circle
            cx={36}
            cy={36}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            transform="rotate(-90 36 36)"
          />
        </svg>
        <div>
          <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-medium)' }}>{score.toFixed(1)} / 5</p>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            {band}
          </p>
        </div>
      </div>
    </div>
  )
}
