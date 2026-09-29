import { Fragment, useEffect, useRef, useState } from 'react'
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
import { Textarea } from '@/app/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
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
import {
  addWebsite,
  createFaq,
  deleteFaq,
  deleteFile,
  deleteWebsite,
  errorText,
  isCrawlDone,
  trackCrawl,
  updateFaq,
  updateWebsite,
  uploadFile,
  websiteFields,
} from '@/app/api/meta'

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

  async function saveNewRow() {
    if (!newRow || !newRow.question.trim() || !newRow.answer.trim()) return
    const question = newRow.question.trim()
    const answer = newRow.answer.trim()
    // PRD AC-b33: exact duplicate questions are rejected.
    if (faqs.some((f) => f.question.trim() === question)) {
      setNewRowError('This question already exists. Edit the existing entry instead of adding a new one.')
      return
    }
    const warnings = computeRowWarnings(newRow.question, newRow.answer, faqs)
    const shouldFail = consumeForcedFailure()
    setNewRowSaving(true)
    setNewRowError(null)
    try {
      if (shouldFail) throw new Error('forced')
      const created = await createFaq(question, answer)
      const id = newId('faq')
      patchKnowledge((prev) => ({ faqs: [{ id, metaId: created.id, question, answer, createdAt: Date.now() }, ...prev.faqs] }))
      setRowWarnings((prev) => ({ ...prev, [id]: warnings }))
      setNewRow(null)
    } catch (err) {
      setNewRowError(shouldFail ? 'Could not save. Nothing was lost.' : `Could not save. Nothing was lost. (${errorText(err)})`)
    } finally {
      setNewRowSaving(false)
    }
  }

  function startEdit(row: FaqRow) {
    setEditingId(row.id)
    setEditDraft({ question: row.question, answer: row.answer })
    setEditError(null)
  }

  async function saveEdit(id: string) {
    if (!editDraft.question.trim() || !editDraft.answer.trim()) return
    const question = editDraft.question.trim()
    const answer = editDraft.answer.trim()
    if (faqs.some((f) => f.id !== id && f.question.trim() === question)) {
      setEditError('This question already exists. Edit the existing entry instead of adding a new one.')
      return
    }
    const warnings = computeRowWarnings(editDraft.question, editDraft.answer, faqs, id)
    const shouldFail = consumeForcedFailure()
    const row = faqs.find((f) => f.id === id)
    setEditSaving(true)
    setEditError(null)
    try {
      if (shouldFail) throw new Error('forced')
      // A row never sent to Meta (e.g. demo sample data) is created there on first edit.
      const metaId = row?.metaId ? (await updateFaq(row.metaId, question, answer)).id ?? row.metaId : (await createFaq(question, answer)).id
      patchKnowledge((prev) => ({
        faqs: prev.faqs.map((f) => (f.id === id ? { ...f, metaId, question, answer } : f)),
      }))
      setRowWarnings((prev) => ({ ...prev, [id]: warnings }))
      setEditingId(null)
    } catch (err) {
      setEditError(shouldFail ? 'Could not save. Nothing was lost.' : `Could not save. Nothing was lost. (${errorText(err)})`)
    } finally {
      setEditSaving(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    const shouldFail = consumeForcedFailure()
    const metaId = faqs.find((f) => f.id === id)?.metaId
    try {
      if (shouldFail) throw new Error('forced')
      if (metaId) await deleteFaq(metaId)
    } catch {
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
  }

  function handleImported(rows: { question: string; answer: string; metaId?: string }[], batchId: string) {
    const now = Date.now()
    const newFaqs: FaqRow[] = rows.map((r, i) => ({
      id: newId('faq'),
      metaId: r.metaId,
      question: r.question,
      answer: r.answer,
      createdAt: now - i,
      importBatchId: batchId,
    }))
    patchKnowledge((prev) => ({ faqs: [...newFaqs, ...prev.faqs], lastFaqImport: { id: batchId, count: rows.length } }))
  }

  const [pendingUndoImport, setPendingUndoImport] = useState(false)

  async function confirmUndoImport() {
    if (!lastImport) return
    const batch = faqs.filter((f) => f.importBatchId === lastImport.id)
    const failedIds = new Set<string>()
    for (const f of batch) {
      if (!f.metaId) continue
      try {
        await deleteFaq(f.metaId)
      } catch {
        failedIds.add(f.id)
      }
    }
    if (failedIds.size > 0) setDeleteError(`Could not remove ${failedIds.size} of the imported entries. They are still here.`)
    patchKnowledge((prev) => ({
      faqs: prev.faqs.filter((f) => f.importBatchId !== lastImport.id || failedIds.has(f.id)),
      lastFaqImport: null,
    }))
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
        <div className="space-y-3 rounded-lg border border-border bg-accent p-4">
          <span className="flex items-center gap-1.5">
            <p style={{ fontWeight: 'var(--font-weight-medium)' }}>Start with the questions customers ask most</p>
            <InfoTooltip text="Tip: if you filled in Business details on the first tab, you do not need to repeat them here." />
          </span>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((q) => (
              <Button key={q} type="button" variant="outline" size="sm" onClick={() => startAddRow(q)}>
                {q}
              </Button>
            ))}
          </div>
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
                  <Fragment key={row.id}>
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
                  </Fragment>
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


/** Creates each imported FAQ on Meta, 5 at a time. Rows Meta rejects come back in `failed` so
 *  the dialog's "retry failed" path can resend just those. */
async function createFaqs<T extends { question: string; answer: string }>(rows: T[], forceFail: boolean) {
  const created: (T & { metaId: string })[] = []
  const failed: T[] = []
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(
      rows.slice(i, i + 5).map(async (r) => {
        try {
          if (forceFail && i + 5 >= rows.length) throw new Error('forced')
          created.push({ ...r, metaId: (await createFaq(r.question, r.answer)).id })
        } catch {
          failed.push(r)
        }
      }),
    )
  }
  return { created, failed }
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
  onImported: (rows: { question: string; answer: string; metaId?: string }[], batchId: string) => void
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
    const { created, failed } = await createFaqs(review.toImport, shouldFail)
    const batchId = newId('import')
    if (created.length > 0) onImported(created, batchId)
    setSaveResult({ imported: created.length, failed })
    setStage('done')
    if (failed.length === 0) onClose()
  }

  async function retryFailed() {
    if (!saveResult || saveResult.failed.length === 0) return
    const { created, failed } = await createFaqs(saveResult.failed, false)
    if (created.length > 0) onImported(created, newId('import'))
    setSaveResult({ imported: saveResult.imported + created.length, failed })
    if (failed.length === 0) onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <span className="flex items-center gap-1.5">
            <DialogTitle>Import FAQs from CSV</DialogTitle>
            <InfoTooltip text="Your file needs two columns: question and answer." />
          </span>
        </DialogHeader>

        {stage === 'upload' && (
          <div className="space-y-4">
            <div className="space-y-1">
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

  async function runUpload(file: File, replacingId?: string) {
    const id = newId('upload')
    setTopError(null)
    setUploading((prev) => [...prev, { id, fileName: file.name, progress: 0, replacingId }])

    const shouldFail = consumeForcedFailure()
    // Cosmetic progress while the real upload runs; holds at 90% until Meta answers.
    const interval = setInterval(() => {
      setUploading((prev) =>
        prev.map((u) => (u.id === id ? { ...u, progress: Math.min(90, u.progress + 10 + Math.random() * 10) } : u)),
      )
    }, 250)

    let uploaded: { id: string; file_name: string }
    try {
      if (shouldFail) throw new Error('Could not upload the file.')
      uploaded = await uploadFile(file)
    } catch (err) {
      const msg = shouldFail ? 'Could not upload the file.' : errorText(err)
      if (replacingId) setTopError(`The new file could not be uploaded, so the old one was kept. ${msg}`)
      else setRowErrors((prev) => ({ ...prev, [id]: msg }))
      return
    } finally {
      clearInterval(interval)
      setUploading((prev) => prev.filter((u) => u.id !== id))
    }

    // Replace = upload the new file first, then remove the old one, so a failed upload loses nothing.
    const old = replacingId ? documents.find((d) => d.id === replacingId) : undefined
    if (old?.metaId) {
      try {
        await deleteFile(old.metaId)
      } catch (err) {
        setTopError(`The new file was uploaded, but the old one could not be removed. ${errorText(err)}`)
      }
    }
    const ext = `.${uploaded.file_name.split('.').pop()?.toLowerCase()}`
    const newDocId = newId('doc')
    patchKnowledge((prev) => ({
      documents: [
        { id: newDocId, metaId: uploaded.id, fileName: uploaded.file_name, sizeBytes: file.size, type: ext, uploadedAt: Date.now() },
        ...prev.documents.filter((d) => d.id !== replacingId),
      ],
    }))
    setJustSettledIds((prev) => ({ ...prev, [newDocId]: true }))
    setTimeout(() => setJustSettledIds((prev) => ({ ...prev, [newDocId]: false })), 4000)
  }

  function processFiles(files: FileList | null, replacingId?: string) {
    if (!files) return
    Array.from(files).forEach((file) => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase()}`
      if (!ACCEPTED_DOCUMENT_TYPES.includes(ext)) {
        // PRD AC-c16: the type check wins over the size check.
        setTopError('Document type is not supported.')
        return
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        setTopError('File exceeds 100 MB.')
        return
      }
      if ((ext === '.csv' || ext === '.xlsx') && consumeForcedFailure()) {
        setTopError(
          'Spreadsheet files are not switched on for this account yet. Contact support if you need them. You can also save the file as a PDF and upload that.',
        )
        return
      }
      void runUpload(file, replacingId)
    })
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    const shouldFail = consumeForcedFailure()
    const metaId = documents.find((d) => d.id === id)?.metaId
    try {
      if (shouldFail) throw new Error('forced')
      if (metaId) await deleteFile(metaId)
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [id]: shouldFail ? 'Could not delete. The item is still here.' : `Could not delete. The item is still here. (${errorText(err)})` }))
      setPendingDeleteId(null)
      return
    }
    patchKnowledge((prev) => ({ documents: prev.documents.filter((d) => d.id !== id) }))
    setPendingDeleteId(null)
  }

  function confirmReplace() {
    if (!pendingReplace) return
    const { id, file } = pendingReplace
    setPendingReplace(null)
    void runUpload(file, id)
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
        <div className="rounded-lg bg-accent p-4">
          <span className="flex items-center gap-1.5">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              No documents yet.
            </p>
            <InfoTooltip text="Good things to upload: your product catalogue, a price list, or your terms and conditions." />
          </span>
        </div>
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

const SUBPAGE_SEGMENTS = [
  'about', 'contact', 'products', 'services', 'faq', 'blog', 'pricing',
  'support', 'returns', 'shipping', 'privacy-policy', 'terms', 'careers',
  'reviews', 'help', 'locations', 'gallery', 'testimonials', 'catalog', 'store',
]

/** Fake sub-level navigation paths for a crawled site, one per page the mock crawl "read". */
export function generateFakeSubpages(baseUrl: string, count: number): string[] {
  const root = baseUrl.replace(/\/$/, '')
  return Array.from({ length: count }, (_, i) => {
    const segment = SUBPAGE_SEGMENTS[i % SUBPAGE_SEGMENTS.length]
    const suffix = i >= SUBPAGE_SEGMENTS.length ? `-${Math.floor(i / SUBPAGE_SEGMENTS.length) + 1}` : ''
    return `${root}/${segment}${suffix}`
  })
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
  const [bulkOpen, setBulkOpen] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editUrl, setEditUrl] = useState('')

  const setSite = (id: string, fields: Partial<WebsiteSource>) =>
    patchKnowledge((prev) => ({ websites: prev.websites.map((w) => (w.id === id ? { ...w, ...fields } : w)) }))

  // Any row Meta knows about whose crawl hasn't finished gets polled until it does. Add, re-crawl
  // and edit only have to put a row back into a crawling state; this picks it up.
  useEffect(() => {
    websites.forEach((w) => {
      if (w.metaId && !isCrawlDone(w.status)) trackCrawl(w.metaId, patchKnowledge)
    })
  }, [websites, patchKnowledge])

  async function addWebsites(urls: string[]) {
    const now = Date.now()
    const newSites: WebsiteSource[] = urls.map((url, i) => ({
      id: newId('site'),
      url,
      status: 'not_started',
      pagesRead: 0,
      subpages: [],
      updatedAt: now - i,
    }))
    patchKnowledge((prev) => ({ websites: [...newSites, ...prev.websites] }))
    for (const site of newSites) {
      const shouldFail = consumeForcedFailure()
      try {
        if (shouldFail) throw new Error('Could not add this website.')
        setSite(site.id, websiteFields(await addWebsite(site.url)))
      } catch (err) {
        setSite(site.id, { status: 'failed', crawlError: errorText(err) })
      }
    }
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
      setInputError(`The URL ${url} already exists`)
      return
    }
    setInputError(null)
    setUrlInput('')
    void addWebsites([url])
  }

  /** Re-crawl and edit are the same call on Meta: PUT the URL, which restarts the crawl. */
  async function recrawl(site: WebsiteSource, url = site.url) {
    const shouldFail = consumeForcedFailure()
    try {
      if (shouldFail) throw new Error('forced')
      const fields = site.metaId ? websiteFields(await updateWebsite(site.metaId, url)) : websiteFields(await addWebsite(url))
      // A re-crawl keeps the same row (PRD V-d5); show it as pending until the poll reports.
      setSite(site.id, { ...fields, url, status: isCrawlDone(fields.status!) ? 'waiting' : fields.status, crawlError: undefined })
      return true
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [site.id]: shouldFail ? 'Could not start reading this site again.' : errorText(err) }))
      return false
    }
  }

  async function saveEditUrl(site: WebsiteSource) {
    let url = editUrl.trim()
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    if (!isWebsiteShapeValid(url)) {
      setRowErrors((prev) => ({ ...prev, [site.id]: 'This does not look like a website address.' }))
      return
    }
    if (websites.some((w) => w.id !== site.id && normalizeUrl(w.url) === normalizeUrl(url))) {
      setRowErrors((prev) => ({ ...prev, [site.id]: `The URL ${url} already exists` }))
      return
    }
    if (await recrawl(site, url)) setEditingId(null)
  }

  async function confirmRemove() {
    if (!pendingRemoveId) return
    const id = pendingRemoveId
    const shouldFail = consumeForcedFailure()
    const metaId = websites.find((w) => w.id === id)?.metaId
    try {
      if (shouldFail) throw new Error('forced')
      if (metaId) await deleteWebsite(metaId)
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [id]: shouldFail ? 'Could not delete. The item is still here.' : `Could not delete. The item is still here. (${errorText(err)})` }))
      setPendingRemoveId(null)
      return
    }
    patchKnowledge((prev) => ({ websites: prev.websites.filter((w) => w.id !== id) }))
    setPendingRemoveId(null)
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
        <Button variant="outline" onClick={() => setBulkOpen(true)}>
          <Upload className="size-4" />
          Bulk add
        </Button>
      </div>

      {websites.length === 0 ? (
        <div className="rounded-lg bg-accent p-4">
          <span className="flex items-center gap-1.5">
            <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
              No websites yet.
            </p>
            <InfoTooltip text="Your main website or help centre is usually the fastest way to give the agent real knowledge." />
          </span>
        </div>
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
                  {isCrawlDone(site.status) && (
                    <button type="button" onClick={() => void recrawl(site)} className="text-primary" style={{ fontSize: 'var(--text-sm)' }}>
                      Re-crawl
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(site.id)
                      setEditUrl(site.url)
                    }}
                    className="text-muted-foreground"
                    style={{ fontSize: 'var(--text-sm)' }}
                  >
                    Edit
                  </button>
                  <button type="button" onClick={() => setPendingRemoveId(site.id)} className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
                    Remove
                  </button>
                </div>
              </div>

              {editingId === site.id && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void saveEditUrl(site)}
                    aria-label="Website address"
                  />
                  <Button size="sm" onClick={() => void saveEditUrl(site)} disabled={!editUrl.trim()}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              <div className="mt-1 flex items-center gap-1.5 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                {site.status === 'not_started' && <span>Not started</span>}
                {site.status === 'waiting' && <span>Pending</span>}
                {site.status === 'reading' && (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <span>In progress · {site.pagesRead} pages so far</span>
                  </>
                )}
                {site.status === 'done' && (
                  <span>
                    Completed · {site.pagesRead} pages crawled · last crawled {formatRelativeDate(site.lastCrawledAt ?? site.updatedAt)}
                  </span>
                )}
                {site.status === 'done_no_data' && (
                  <span>Completed (No Data) · last crawled {formatRelativeDate(site.lastCrawledAt ?? site.updatedAt)}</span>
                )}
                {site.status === 'failed' && <span>Failed{site.crawlError ? `: ${site.crawlError}` : ''}</span>}
              </div>

              {site.status === 'done' && site.subpages.length > 0 && (
                <div className="mt-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="flex items-center gap-1 text-primary" style={{ fontSize: 'var(--text-xs)' }}>
                        <ChevronDown className="size-3.5" />
                        View pages ({site.subpages.length})
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-80 w-96 overflow-y-auto">
                      <DropdownMenuLabel className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                        Sub-pages found under this site
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {site.subpages.map((path) => (
                        <div key={path} className="truncate px-2 py-1 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                          {path}
                        </div>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

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

      {bulkOpen && (
        <WebsiteBulkImportDialog
          existingWebsites={websites}
          onImport={(urls) => void addWebsites(urls)}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  )
}

// ---- Bulk website import ----

interface WebsiteReviewRow {
  url: string
  lineNumber: number
}
interface WebsiteSkippedRow {
  lineNumber: number
  reason: string
}

function parseWebsiteLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.split(',')[0].trim().replace(/^"|"$/g, ''))
    .filter((line) => line.length > 0)
}

function buildWebsiteReview(lines: string[], existingWebsites: WebsiteSource[]) {
  const toImport: WebsiteReviewRow[] = []
  const skipped: WebsiteSkippedRow[] = []
  const seenInBatch = new Set<string>()
  lines.forEach((raw, i) => {
    const lineNumber = i + 1
    if (/^(url|website|address)$/i.test(raw)) return // a lone header cell, not a URL
    let url = raw
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    if (!isWebsiteShapeValid(url)) {
      skipped.push({ lineNumber, reason: 'Not a valid website address' })
      return
    }
    const norm = normalizeUrl(url)
    if (seenInBatch.has(norm)) {
      skipped.push({ lineNumber, reason: 'Duplicate in this list' })
      return
    }
    if (existingWebsites.some((w) => normalizeUrl(w.url) === norm)) {
      skipped.push({ lineNumber, reason: 'Already in your list' })
      return
    }
    seenInBatch.add(norm)
    toImport.push({ url, lineNumber })
  })
  return { toImport, skipped }
}

function WebsiteBulkImportDialog({
  existingWebsites,
  onImport,
  onClose,
}: {
  existingWebsites: WebsiteSource[]
  onImport: (urls: string[]) => void
  onClose: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [review, setReview] = useState<{ toImport: WebsiteReviewRow[]; skipped: WebsiteSkippedRow[] } | null>(null)
  const [problemsOpen, setProblemsOpen] = useState(false)

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  function handleContinue() {
    setReview(buildWebsiteReview(parseWebsiteLines(text), existingWebsites))
  }

  function handleImport() {
    if (!review || review.toImport.length === 0) return
    onImport(review.toImport.map((r) => r.url))
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <span className="flex items-center gap-1.5">
            <DialogTitle>Bulk add websites</DialogTitle>
            <InfoTooltip text="Paste one web address per line, or upload a .csv or .txt file." />
          </span>
        </DialogHeader>

        {!review ? (
          <div className="space-y-3">
            <Textarea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'https://yourbusiness.com\nhttps://yourbusiness.com/faq\nhttps://yourbusiness.com/returns'}
              className="bg-input-background shadow-sm"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handleFile(file)
              }}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-4" />
              Upload a .csv or .txt file
            </Button>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleContinue} disabled={!text.trim()}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <p style={{ fontSize: 'var(--text-sm)' }}>{review.toImport.length} will be added</p>
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
                      <li key={s.lineNumber}>
                        Line {s.lineNumber}: {s.reason}
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
              <Button onClick={handleImport} disabled={review.toImport.length === 0}>
                Add {review.toImport.length} websites
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
