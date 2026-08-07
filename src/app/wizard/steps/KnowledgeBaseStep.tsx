import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  File as FileIcon,
  Globe,
  Loader2,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Progress } from '@/app/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { InlineError } from '@/app/components/wizard/RetryBanner'
import {
  ACCEPTED_DOCUMENT_TYPES,
  FAQ_STARTER_SUGGESTIONS,
  MAX_DOCUMENT_BYTES,
  SERVICES_TYPE_CATEGORIES,
  newId,
} from '@/app/wizard/mockData'
import { formatRelativeDate } from '@/app/wizard/format'
import { downloadCsv, normalizeForCompare, parseCsv } from '@/app/wizard/csv'
import type { DocumentFile, FaqRow, KnowledgeState, WebsiteSource } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'

const FAQ_WARNING_THRESHOLD = 150
const SEARCH_THRESHOLD = 20

// ---- Pure helpers ----

function looksLikeMultipleQuestions(question: string): boolean {
  const questionMarks = (question.match(/\?/g) || []).length
  if (questionMarks > 1) return true
  const QUESTION_WORDS = /^(what|how|when|where|why|who|which|can|do|does|is|are|will|would|could)\b/i
  const parts = question.split(/\band\b/i)
  if (parts.length > 1) {
    const after = parts.slice(1).join(' and ').trim()
    if (QUESTION_WORDS.test(after)) return true
  }
  return false
}

const REFERENCE_PHRASES = ['see above', 'as mentioned', 'refer to', 'see our other']
function answerReferencesElsewhere(answer: string): boolean {
  const lower = answer.toLowerCase()
  return REFERENCE_PHRASES.some((phrase) => lower.includes(phrase))
}

function findSimilarFaq(question: string, faqs: FaqRow[], excludeId?: string): FaqRow | undefined {
  const norm = normalizeForCompare(question)
  if (!norm) return undefined
  return faqs.find((faq) => faq.id !== excludeId && normalizeForCompare(faq.question) === norm)
}

type RowWarning = { text: string; viewExistingId?: string }

function computeRowWarnings(question: string, answer: string, faqs: FaqRow[], excludeId?: string): RowWarning[] {
  const warnings: RowWarning[] = []
  if (looksLikeMultipleQuestions(question)) {
    warnings.push({
      text: 'This looks like more than one question. The agent finds answers better when each entry asks exactly one thing.',
    })
  }
  if (answerReferencesElsewhere(answer)) {
    warnings.push({
      text: 'Answers work best when they are complete on their own. The agent reads each entry separately.',
    })
  }
  const similar = findSimilarFaq(question, faqs, excludeId)
  if (similar) {
    warnings.push({
      text: 'You already have a very similar question. Two near-identical entries can confuse the agent.',
      viewExistingId: similar.id,
    })
  }
  return warnings
}

// ---- Tab contents (mounted inside the new Step 2 "Knowledge" container — see KnowledgeStep.tsx,
// which now owns the coverage line, tab list, demo controls and per-tab loading/failure state) ----

// ==================================================================================
// FAQ TAB
// ==================================================================================

type KnowledgePatcher = (fn: (prev: KnowledgeState) => Partial<KnowledgeState>) => void

export function FaqTab({
  faqs,
  lastImport,
  category,
  loading,
  patchKnowledge,
  consumeForcedFailure,
}: {
  faqs: FaqRow[]
  lastImport: KnowledgeState['lastFaqImport']
  category: string
  loading: boolean
  patchKnowledge: KnowledgePatcher
  consumeForcedFailure: () => boolean
}) {
  const [newRow, setNewRow] = useState<{ question: string; answer: string } | null>(null)
  const [newRowError, setNewRowError] = useState<string | null>(null)
  const [newRowSaving, setNewRowSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ question: '', answer: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [rowWarnings, setRowWarnings] = useState<Record<string, RowWarning[]>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  function scrollToAndHighlight(id: string) {
    rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(id)
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2000)
  }

  function startAddRow(prefillQuestion?: string) {
    setNewRow({ question: prefillQuestion ?? '', answer: '' })
    setNewRowError(null)
  }

  function saveNewRow() {
    if (!newRow || !newRow.question.trim() || !newRow.answer.trim()) return
    const warnings = computeRowWarnings(newRow.question, newRow.answer, faqs)
    const shouldFail = consumeForcedFailure()
    setNewRowSaving(true)
    setNewRowError(null)
    setTimeout(() => {
      setNewRowSaving(false)
      if (shouldFail) {
        setNewRowError('Could not save. Nothing was lost.')
        return
      }
      const id = newId('faq')
      patchKnowledge((prev) => ({ faqs: [{ id, question: newRow.question.trim(), answer: newRow.answer.trim(), createdAt: Date.now() }, ...prev.faqs] }))
      setRowWarnings((prev) => ({ ...prev, [id]: warnings }))
      setNewRow(null)
    }, 500)
  }

  function startEdit(row: FaqRow) {
    setEditingId(row.id)
    setEditDraft({ question: row.question, answer: row.answer })
    setEditError(null)
  }

  function saveEdit(id: string) {
    if (!editDraft.question.trim() || !editDraft.answer.trim()) return
    const warnings = computeRowWarnings(editDraft.question, editDraft.answer, faqs, id)
    const shouldFail = consumeForcedFailure()
    setEditSaving(true)
    setEditError(null)
    setTimeout(() => {
      setEditSaving(false)
      if (shouldFail) {
        setEditError('Could not save. Nothing was lost.')
        return
      }
      patchKnowledge((prev) => ({
        faqs: prev.faqs.map((f) => (f.id === id ? { ...f, question: editDraft.question.trim(), answer: editDraft.answer.trim() } : f)),
      }))
      setRowWarnings((prev) => ({ ...prev, [id]: warnings }))
      setEditingId(null)
    }, 500)
  }

  function confirmDelete() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    const shouldFail = consumeForcedFailure()
    setTimeout(() => {
      if (shouldFail) {
        setDeleteError('Could not delete. The item is still here.')
        setPendingDeleteId(null)
        return
      }
      patchKnowledge((prev) => ({ faqs: prev.faqs.filter((f) => f.id !== id) }))
      setRowWarnings((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setPendingDeleteId(null)
    }, 400)
  }

  function handleImported(rows: { question: string; answer: string }[], batchId: string) {
    const now = Date.now()
    const newFaqs: FaqRow[] = rows.map((r, i) => ({
      id: newId('faq'),
      question: r.question,
      answer: r.answer,
      createdAt: now - i,
      importBatchId: batchId,
    }))
    patchKnowledge((prev) => ({ faqs: [...newFaqs, ...prev.faqs], lastFaqImport: { id: batchId, count: rows.length } }))
  }

  const [pendingUndoImport, setPendingUndoImport] = useState(false)

  function confirmUndoImport() {
    if (!lastImport) return
    patchKnowledge((prev) => ({ faqs: prev.faqs.filter((f) => f.importBatchId !== lastImport.id), lastFaqImport: null }))
    setPendingUndoImport(false)
  }

  useEffect(() => {
    return () => {
      // Leaving the step: the import stops being undo-able (rows themselves are untouched).
    }
  }, [])

  const suggestions = SERVICES_TYPE_CATEGORIES.includes(category) ? FAQ_STARTER_SUGGESTIONS.services : FAQ_STARTER_SUGGESTIONS.retail

  const isOverThreshold = faqs.length >= FAQ_WARNING_THRESHOLD
  const visibleFaqs = search.trim()
    ? faqs.filter((f) => {
        const q = search.toLowerCase()
        return f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)
      })
    : faqs

  const showEmptyState = faqs.length === 0 && !newRow

  return (
    <div className={cn('space-y-4', loading && 'pointer-events-none opacity-50')} aria-hidden={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className={cn('caption', isOverThreshold ? 'text-warning-foreground' : 'text-muted-foreground')}>
            {faqs.length} {faqs.length === 1 ? 'ENTRY' : 'ENTRIES'}
          </span>
          {isOverThreshold && (
            <p className="mt-1 max-w-md text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
              You have a lot of entries. Past a few hundred, the agent gets worse at finding the right answer.
              Keep only the questions customers actually ask.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="size-3.5" />
            Import FAQs from CSV
          </Button>
          <Button size="sm" onClick={() => startAddRow()} disabled={!!newRow}>
            <Plus className="size-3.5" />
            Add row
          </Button>
        </div>
      </div>

      {lastImport && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
          <span style={{ fontSize: 'var(--text-sm)' }}>{lastImport.count} entries imported.</span>
          <button type="button" onClick={() => setPendingUndoImport(true)} className="text-primary" style={{ fontSize: 'var(--text-sm)' }}>
            Undo this import
          </button>
        </div>
      )}

      {deleteError && <InlineError message={deleteError} onRetry={() => setDeleteError(null)} />}

      {faqs.length > SEARCH_THRESHOLD && (
        <div className="relative max-w-sm">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions and answers" className="pl-9" />
        </div>
      )}

      {showEmptyState ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Start with the questions customers ask most</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((q) => (
              <Button key={q} type="button" variant="outline" size="sm" onClick={() => startAddRow(q)}>
                {q}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
            Tip: if you filled in Business details on the first tab, you do not need to repeat them here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[35%]">Question</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {newRow && (
                <TableRow>
                  <TableCell className="align-top">
                    <Input
                      autoFocus
                      value={newRow.question}
                      onChange={(e) => setNewRow({ ...newRow, question: e.target.value })}
                      placeholder="What is your return policy?"
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <Input
                      value={newRow.answer}
                      onChange={(e) => setNewRow({ ...newRow, answer: e.target.value })}
                      placeholder="Write the full answer here, complete on its own."
                    />
                    {newRowError && <InlineError message={newRowError} onRetry={saveNewRow} />}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex gap-1">
                      <Button size="sm" onClick={saveNewRow} disabled={!newRow.question.trim() || !newRow.answer.trim() || newRowSaving}>
                        {newRowSaving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setNewRow(null)}>
                        Cancel
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {visibleFaqs.map((row) => {
                const isEditing = editingId === row.id
                const warnings = rowWarnings[row.id]
                return (
                  <>
                    <TableRow
                      key={row.id}
                      ref={(el) => {
                        rowRefs.current[row.id] = el
                      }}
                      className={cn(highlightId === row.id && 'bg-accent transition-colors')}
                    >
                      <TableCell className="align-top">
                        {isEditing ? (
                          <Input value={editDraft.question} onChange={(e) => setEditDraft({ ...editDraft, question: e.target.value })} />
                        ) : (
                          row.question
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {isEditing ? (
                          <>
                            <Input value={editDraft.answer} onChange={(e) => setEditDraft({ ...editDraft, answer: e.target.value })} />
                            {editError && <InlineError message={editError} onRetry={() => saveEdit(row.id)} />}
                          </>
                        ) : (
                          <span className="line-clamp-2">{row.answer}</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              onClick={() => saveEdit(row.id)}
                              disabled={!editDraft.question.trim() || !editDraft.answer.trim() || editSaving}
                            >
                              {editSaving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(row.id)}>
                              Delete
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {warnings && warnings.length > 0 && !isEditing && (
                      <TableRow key={`${row.id}-warnings`}>
                        <TableCell colSpan={3} className="border-t-0 bg-warning/10 py-2">
                          <div className="space-y-1">
                            {warnings.map((w, i) => (
                              <p key={i} className="flex items-center gap-1.5 text-warning-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                                <AlertTriangle className="size-3.5 shrink-0" />
                                {w.text}
                                {w.viewExistingId && (
                                  <button type="button" onClick={() => scrollToAndHighlight(w.viewExistingId!)} className="underline">
                                    View existing
                                  </button>
                                )}
                              </p>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this question?"
        description="The agent will stop using it immediately."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />

      <ConfirmDialog
        open={pendingUndoImport}
        title={`Remove all ${lastImport?.count ?? 0} entries from this import?`}
        description="Entries you added by hand are not affected."
        confirmLabel="Remove"
        onConfirm={confirmUndoImport}
        onCancel={() => setPendingUndoImport(false)}
      />

      {importOpen && (
        <FaqImportPanel
          existingFaqs={faqs}
          consumeForcedFailure={consumeForcedFailure}
          onImported={handleImported}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  )
}

// ---- FAQ CSV import ----

type ImportStage = 'upload' | 'mapping' | 'review' | 'saving' | 'done'
interface ReviewRow {
  question: string
  answer: string
  rowNumber: number
}
interface SkippedRow {
  rowNumber: number
  reason: string
}

function buildReview(dataRows: string[][], qIdx: number, aIdx: number, existingFaqs: FaqRow[]) {
  const toImport: ReviewRow[] = []
  const skipped: SkippedRow[] = []
  const seenInFile = new Map<string, number>()
  dataRows.forEach((cells, i) => {
    const rowNumber = i + 1
    const question = (cells[qIdx] ?? '').trim()
    const answer = (cells[aIdx] ?? '').trim()
    if (!question) {
      skipped.push({ rowNumber, reason: 'Question is empty' })
      return
    }
    if (!answer) {
      skipped.push({ rowNumber, reason: 'Answer is empty' })
      return
    }
    const norm = normalizeForCompare(question)
    if (seenInFile.has(norm)) {
      skipped.push({ rowNumber, reason: `Duplicate of row ${seenInFile.get(norm)}` })
      return
    }
    if (findSimilarFaq(question, existingFaqs)) {
      skipped.push({ rowNumber, reason: 'Very similar to an existing entry' })
      return
    }
    seenInFile.set(norm, rowNumber)
    toImport.push({ question, answer, rowNumber })
  })
  return { toImport, skipped }
}

function FaqImportPanel({
  existingFaqs,
  consumeForcedFailure,
  onImported,
  onClose,
}: {
  existingFaqs: FaqRow[]
  consumeForcedFailure: () => boolean
  onImported: (rows: { question: string; answer: string }[], batchId: string) => void
  onClose: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<ImportStage>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapQuestion, setMapQuestion] = useState<string | null>(null)
  const [mapAnswer, setMapAnswer] = useState<string | null>(null)
  const [review, setReview] = useState<{ toImport: ReviewRow[]; skipped: SkippedRow[] } | null>(null)
  const [problemsOpen, setProblemsOpen] = useState(false)
  const [saveResult, setSaveResult] = useState<{ imported: number; failed: ReviewRow[] } | null>(null)

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCsv(String(reader.result ?? ''))
      if (rows.length === 0) return
      const [head, ...rest] = rows
      setHeaders(head)
      setDataRows(rest)
      const norm = head.map((h) => h.trim().toLowerCase())
      const qi = norm.indexOf('question')
      const ai = norm.indexOf('answer')
      if (qi !== -1 && ai !== -1) {
        setReview(buildReview(rest, qi, ai, existingFaqs))
        setStage('review')
      } else {
        setStage('mapping')
      }
    }
    reader.readAsText(file)
  }

  function confirmMapping() {
    if (!mapQuestion || !mapAnswer) return
    const qi = headers.indexOf(mapQuestion)
    const ai = headers.indexOf(mapAnswer)
    setReview(buildReview(dataRows, qi, ai, existingFaqs))
    setStage('review')
  }

  async function runImport() {
    if (!review) return
    setStage('saving')
    const shouldFail = consumeForcedFailure()
    const failCount = shouldFail ? Math.max(1, Math.round(review.toImport.length * 0.05)) : 0
    const succeeded = failCount > 0 ? review.toImport.slice(0, review.toImport.length - failCount) : review.toImport
    const failed = failCount > 0 ? review.toImport.slice(review.toImport.length - failCount) : []

    // Send in paced chunks rather than all at once.
    const chunkSize = 25
    for (let i = 0; i < succeeded.length; i += chunkSize) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    const batchId = newId('import')
    if (succeeded.length > 0) onImported(succeeded, batchId)
    setSaveResult({ imported: succeeded.length, failed })
    setStage('done')
    if (failed.length === 0) onClose()
  }

  function retryFailed() {
    if (!saveResult || saveResult.failed.length === 0) return
    const batchId = newId('import')
    onImported(saveResult.failed, batchId)
    setSaveResult({ imported: saveResult.imported + saveResult.failed.length, failed: [] })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import FAQs from CSV</DialogTitle>
        </DialogHeader>

        {stage === 'upload' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                Your file needs two columns: question and answer.
              </p>
              <button
                type="button"
                onClick={() =>
                  downloadCsv('faq-template.csv', [
                    'question,answer',
                    '"What is your return policy?","7 day returns on unused items with original packaging."',
                    '"Do you deliver to my area?","We deliver across India, 2 to 7 days depending on location."',
                  ])
                }
                className="text-primary"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                Download the template
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handleFile(file)
              }}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-4" />
              Choose a CSV file
            </Button>
          </div>
        )}

        {stage === 'mapping' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Which column has the questions?</Label>
              <Select value={mapQuestion ?? undefined} onValueChange={setMapQuestion}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a column" />
                </SelectTrigger>
                <SelectContent>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Which column has the answers?</Label>
              <Select value={mapAnswer ?? undefined} onValueChange={setMapAnswer}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a column" />
                </SelectTrigger>
                <SelectContent>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={confirmMapping} disabled={!mapQuestion || !mapAnswer}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'review' && review && (
          <div className="space-y-3">
            <p style={{ fontSize: 'var(--text-sm)' }}>{dataRows.length} rows found</p>
            <p style={{ fontSize: 'var(--text-sm)' }}>{review.toImport.length} will be imported</p>
            {review.skipped.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-warning-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                  {review.skipped.length} have problems and will be skipped
                  <button type="button" onClick={() => setProblemsOpen((v) => !v)} className="text-primary underline">
                    View problems
                  </button>
                </p>
                {problemsOpen && (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-muted p-3" style={{ fontSize: 'var(--text-xs)' }}>
                    {review.skipped.map((s) => (
                      <li key={s.rowNumber}>
                        Row {s.rowNumber}: {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={runImport} disabled={review.toImport.length === 0}>
                Import {review.toImport.length} entries
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'saving' && (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span style={{ fontSize: 'var(--text-sm)' }}>Importing&hellip;</span>
          </div>
        )}

        {stage === 'done' && saveResult && saveResult.failed.length > 0 && (
          <div className="space-y-3">
            <p style={{ fontSize: 'var(--text-sm)' }}>
              {saveResult.imported} imported, {saveResult.failed.length} could not be saved.{' '}
              <button type="button" onClick={retryFailed} className="text-primary underline">
                Retry failed rows
              </button>
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ==================================================================================
// DOCUMENTS TAB
// ==================================================================================

interface UploadingFile {
  id: string
  fileName: string
  progress: number
  replacingId?: string
}

export function DocumentsTab({
  documents,
  loading,
  patchKnowledge,
  consumeForcedFailure,
}: {
  documents: DocumentFile[]
  loading: boolean
  patchKnowledge: KnowledgePatcher
  consumeForcedFailure: () => boolean
}) {
  const docInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState<UploadingFile[]>([])
  const [justSettledIds, setJustSettledIds] = useState<Record<string, boolean>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [topError, setTopError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingReplace, setPendingReplace] = useState<{ id: string; fileName: string; file: File } | null>(null)
  const replaceTargetId = useRef<string | null>(null)

  function runUpload(file: File, replacingId?: string) {
    const id = newId('upload')
    setTopError(null)
    setUploading((prev) => [...prev, { id, fileName: file.name, progress: 0, replacingId }])

    const shouldFail = consumeForcedFailure()
    const interval = setInterval(() => {
      setUploading((prev) =>
        prev.map((u) => (u.id === id ? { ...u, progress: Math.min(100, u.progress + 15 + Math.random() * 15) } : u)),
      )
    }, 180)

    const totalMs = 900 + Math.random() * 500
    setTimeout(() => {
      clearInterval(interval)
      setUploading((prev) => prev.filter((u) => u.id !== id))
      if (shouldFail) {
        if (replacingId) {
          setTopError('The old file was removed but the new one could not be uploaded. Please upload it again.')
        } else {
          setRowErrors((prev) => ({ ...prev, [id]: 'Could not upload the file.' }))
        }
        return
      }
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
      const newDocId = newId('doc')
      patchKnowledge((prev) => ({
        documents: [{ id: newDocId, fileName: file.name, sizeBytes: file.size, type: ext, uploadedAt: Date.now() }, ...prev.documents],
      }))
      setJustSettledIds((prev) => ({ ...prev, [newDocId]: true }))
      setTimeout(() => setJustSettledIds((prev) => ({ ...prev, [newDocId]: false })), 4000)
    }, totalMs)
  }

  function processFiles(files: FileList | null, replacingId?: string) {
    if (!files) return
    Array.from(files).forEach((file) => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
      if (!ACCEPTED_DOCUMENT_TYPES.includes(ext)) {
        setTopError('This file type is not supported. Use PDF, Word documents, or images.')
        return
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        setTopError('This file is too large. The limit is 100 MB per file.')
        return
      }
      if ((ext === '.csv' || ext === '.xlsx') && consumeForcedFailure()) {
        setTopError(
          'Spreadsheet files are not switched on for this account yet. Contact support if you need them. You can also save the file as a PDF and upload that.',
        )
        return
      }
      runUpload(file, replacingId)
    })
  }

  function confirmDelete() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    const shouldFail = consumeForcedFailure()
    setTimeout(() => {
      if (shouldFail) {
        setRowErrors((prev) => ({ ...prev, [id]: 'Could not delete. The item is still here.' }))
        setPendingDeleteId(null)
        return
      }
      patchKnowledge((prev) => ({ documents: prev.documents.filter((d) => d.id !== id) }))
      setPendingDeleteId(null)
    }, 400)
  }

  function confirmReplace() {
    if (!pendingReplace) return
    const { id, file } = pendingReplace
    setPendingReplace(null)
    patchKnowledge((prev) => ({ documents: prev.documents.filter((d) => d.id !== id) }))
    runUpload(file, id)
  }

  const showEmptyState = documents.length === 0 && uploading.length === 0

  return (
    <div className={cn('space-y-4', loading && 'pointer-events-none opacity-50')} aria-hidden={loading}>
      {topError && <InlineError message={topError} onRetry={() => setTopError(null)} />}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          processFiles(e.dataTransfer.files)
        }}
        onClick={() => docInputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragOver ? 'border-primary bg-accent' : 'border-border hover:border-primary/50',
        )}
      >
        <Upload className="size-6 text-muted-foreground" />
        <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Drop files here, or click to browse</p>
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
          .pdf, .doc, .docx, .png, .jpg, .jpeg, .csv, .xlsx &middot; up to 100 MB per file
        </p>
        <input ref={docInputRef} type="file" multiple className="hidden" onChange={(e) => processFiles(e.target.files)} />
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          const id = replaceTargetId.current
          if (file && id) {
            const doc = documents.find((d) => d.id === id)
            if (doc) setPendingReplace({ id, fileName: doc.fileName, file })
          }
        }}
      />

      {showEmptyState ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          No documents yet. Good things to upload: your product catalogue, a price list, or your terms and
          conditions.
        </p>
      ) : (
        <div className="space-y-2">
          {uploading.map((u) => (
            <div key={u.id} className="space-y-1.5 rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                  {u.fileName}
                </span>
              </div>
              <Progress value={u.progress} />
            </div>
          ))}
          {Object.entries(rowErrors).map(
            ([id, message]) =>
              !documents.some((d) => d.id === id) && (
                <InlineError key={id} message={message} onRetry={() => setRowErrors((prev) => ({ ...prev, [id]: '' }))} />
              ),
          )}

          {documents.map((doc) => (
            <div key={doc.id} className="space-y-1">
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                    {doc.fileName}
                  </span>
                  <span className="shrink-0 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    Uploaded {formatRelativeDate(doc.uploadedAt)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      replaceTargetId.current = doc.id
                      replaceInputRef.current?.click()
                    }}
                  >
                    Replace
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(doc.id)}>
                    Delete
                  </Button>
                </div>
              </div>
              {justSettledIds[doc.id] && (
                <p className="px-1 text-muted-foreground transition-opacity" style={{ fontSize: 'var(--text-xs)' }}>
                  Uploaded. The document is being prepared in the background, which can take a little while.
                </p>
              )}
              {rowErrors[doc.id] && <InlineError message={rowErrors[doc.id]} onRetry={() => setRowErrors((prev) => ({ ...prev, [doc.id]: '' }))} />}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this document?"
        description="The agent will stop using it. This cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />

      <ConfirmDialog
        open={pendingReplace !== null}
        title="Replace this file?"
        description={pendingReplace ? `This will remove ${pendingReplace.fileName} and upload the new file in its place. Continue?` : ''}
        confirmLabel="Replace"
        onConfirm={confirmReplace}
        onCancel={() => setPendingReplace(null)}
      />
    </div>
  )
}

// ==================================================================================
// WEBSITE TAB
// ==================================================================================

function isWebsiteShapeValid(url: string): boolean {
  return /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}([/:?#].*)?$/.test(url)
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '').toLowerCase()
}

export function WebsiteTab({
  websites,
  loading,
  patchKnowledge,
  consumeForcedFailure,
}: {
  websites: WebsiteSource[]
  loading: boolean
  patchKnowledge: KnowledgePatcher
  consumeForcedFailure: () => boolean
}) {
  const [urlInput, setUrlInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [whyOpen, setWhyOpen] = useState<Record<string, boolean>>({})

  function runFakeCrawl(id: string, shouldFail: boolean) {
    setTimeout(() => {
      patchKnowledge((prev) => ({ websites: prev.websites.map((w) => (w.id === id ? { ...w, status: 'reading' } : w)) }))
    }, 1500)
    setTimeout(() => {
      patchKnowledge((prev) => ({
        websites: prev.websites.map((w) =>
          w.id === id
            ? shouldFail
              ? { ...w, status: 'failed', updatedAt: Date.now() }
              : { ...w, status: 'done', pagesRead: 20 + Math.floor(Math.random() * 70), updatedAt: Date.now() }
            : w,
        ),
      }))
    }, 9500)
  }

  function handleAdd() {
    let url = urlInput.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    if (!isWebsiteShapeValid(url)) {
      setInputError('This does not look like a website address.')
      return
    }
    if (websites.some((w) => normalizeUrl(w.url) === normalizeUrl(url))) {
      setInputError('This website is already added.')
      return
    }
    setInputError(null)
    const id = newId('site')
    patchKnowledge((prev) => ({ websites: [{ id, url, status: 'waiting', pagesRead: 0, updatedAt: Date.now() }, ...prev.websites] }))
    setUrlInput('')
    runFakeCrawl(id, consumeForcedFailure())
  }

  function handleReread(id: string) {
    patchKnowledge((prev) => ({ websites: prev.websites.map((w) => (w.id === id ? { ...w, status: 'waiting' } : w)) }))
    runFakeCrawl(id, consumeForcedFailure())
  }

  function confirmRemove() {
    if (!pendingRemoveId) return
    const id = pendingRemoveId
    const shouldFail = consumeForcedFailure()
    setTimeout(() => {
      if (shouldFail) {
        setRowErrors((prev) => ({ ...prev, [id]: 'Could not delete. The item is still here.' }))
        setPendingRemoveId(null)
        return
      }
      patchKnowledge((prev) => ({ websites: prev.websites.filter((w) => w.id !== id) }))
      setPendingRemoveId(null)
    }, 400)
  }

  return (
    <div className={cn('space-y-4', loading && 'pointer-events-none opacity-50')} aria-hidden={loading}>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="website-address">Website address</Label>
          <Input
            id="website-address"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value)
              setInputError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="https://yourbusiness.com"
          />
          {inputError && (
            <p className="flex items-center gap-1.5 text-destructive" style={{ fontSize: 'var(--text-xs)' }}>
              <AlertTriangle className="size-3.5 shrink-0" /> {inputError}
            </p>
          )}
        </div>
        <Button onClick={handleAdd} disabled={!urlInput.trim()}>
          <Globe className="size-4" />
          Add website
        </Button>
      </div>

      {websites.length === 0 ? (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          No websites yet. Your main website or help centre is usually the fastest way to give the agent real
          knowledge.
        </p>
      ) : (
        <div className="space-y-2">
          {websites.map((site) => (
            <div key={site.id} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Globe className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate" style={{ fontSize: 'var(--text-sm)' }}>
                    {site.url}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {(site.status === 'done' || site.status === 'failed') && (
                    <button type="button" onClick={() => handleReread(site.id)} className="text-primary" style={{ fontSize: 'var(--text-sm)' }}>
                      Re-read
                    </button>
                  )}
                  <button type="button" onClick={() => setPendingRemoveId(site.id)} className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-1 flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                {site.status === 'waiting' && <span>Waiting to start</span>}
                {site.status === 'reading' && (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <span>Reading the site now...</span>
                  </>
                )}
                {site.status === 'done' && (
                  <span>
                    Ready · {site.pagesRead} pages read · updated {formatRelativeDate(site.updatedAt)}
                  </span>
                )}
                {site.status === 'failed' && <span>Could not read this site</span>}
              </div>

              {site.status === 'failed' && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setWhyOpen((prev) => ({ ...prev, [site.id]: !prev[site.id] }))}
                    className="flex items-center gap-1 text-primary"
                    style={{ fontSize: 'var(--text-xs)' }}
                  >
                    <ChevronDown className={cn('size-3.5 transition-transform', whyOpen[site.id] && 'rotate-180')} />
                    Why might this happen?
                  </button>
                  {whyOpen[site.id] && (
                    <div className="mt-2 space-y-2 rounded-lg bg-muted p-3 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                      <p>We are not told the exact reason. The most common causes:</p>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>The site blocks automatic readers</li>
                        <li>The pages need a login to view</li>
                        <li>The content only appears after the page runs in a browser</li>
                      </ul>
                      <p>If you can, try adding a simpler page instead, like your help or FAQ page. Then press Re-read.</p>
                    </div>
                  )}
                </div>
              )}

              {rowErrors[site.id] && <InlineError message={rowErrors[site.id]} onRetry={() => setRowErrors((prev) => ({ ...prev, [site.id]: '' }))} />}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemoveId !== null}
        title="Remove this website?"
        description="The agent will stop using anything it learned from it."
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemoveId(null)}
      />
    </div>
  )
}
