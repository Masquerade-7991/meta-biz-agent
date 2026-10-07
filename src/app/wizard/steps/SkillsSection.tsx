import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, Loader2, MessageSquare, Plus, Sparkles, Upload, Wand2 } from 'lucide-react'
import { Label } from '@/app/components/ui/label'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import { assistWrite, type WriteContext, type WriteTask } from '@/app/api/assist'
import { Button } from '@/app/components/ui/button'
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
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { InfoTooltip } from '@/app/components/wizard/InfoTooltip'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { SAMPLE_CUSTOM_SKILLS, SERVICES_TYPE_CATEGORIES, SKILL_TEMPLATES, newId } from '@/app/wizard/mockData'
import { kebabCase, uniqueTitle } from '@/app/wizard/format'
import { downloadCsv, normalizeForCompare, parseCsv } from '@/app/wizard/csv'
import type { CustomSkill } from '@/app/wizard/types'
import { cn } from '@/app/lib/utils'
import { deleteSkill, errorDetail, errorText, listSkills, saveCustomSkill } from '@/app/api/meta'
import { toast } from 'sonner'

const MAX_SKILL_NAME = 60
const MAX_SKILL_INSTRUCTION = 2000
const SKILL_COUNT_WARNING_THRESHOLD = 15

type RowWarning = { text: string; viewExistingId?: string }

const SKILL_INJECTION_PHRASES = ['ignore previous', 'ignore all', 'disregard your instructions', 'you are now', 'system prompt']
const SKILL_CONFLICT_PHRASES = ['tone', 'language', 'reply in', 'answer length', 'be concise', 'be detailed']

function findSimilarSkill(instruction: string, skills: CustomSkill[], excludeId?: string): CustomSkill | undefined {
  const norm = normalizeForCompare(instruction)
  if (!norm) return undefined
  return skills.find((s) => s.id !== excludeId && normalizeForCompare(s.instruction) === norm)
}

function computeSkillWarnings(instruction: string, skills: CustomSkill[], excludeId?: string): RowWarning[] {
  const warnings: RowWarning[] = []
  const similar = findSimilarSkill(instruction, skills, excludeId)
  if (similar) {
    warnings.push({
      text: 'This looks very similar to another skill. Two skills covering the same situation can make the agent inconsistent.',
      viewExistingId: similar.id,
    })
  }
  const lower = instruction.toLowerCase()
  if (SKILL_INJECTION_PHRASES.some((phrase) => lower.includes(phrase))) {
    warnings.push({
      text: 'This reads like commands to the system rather than a description of what the agent should do. Skills work best as plain descriptions of behaviour.',
    })
  }
  if (SKILL_CONFLICT_PHRASES.some((phrase) => lower.includes(phrase))) {
    warnings.push({
      text: 'Tone, languages and answer length are set under Identity → Personality. Setting them here too can conflict with those choices.',
    })
  }
  if (instruction.includes('[') && instruction.includes(']')) {
    warnings.push({
      text: 'This skill still has unfilled blanks in [brackets]. The agent will read them as written, so fill them in with your real details.',
    })
  }
  return warnings
}

type SkillEditorState = { mode: 'add' | 'edit'; skillId?: string; name: string; description: string; instruction: string }

const MAX_SKILL_DESCRIPTION = 1024

const REVIEW_LABEL: Record<NonNullable<CustomSkill['reviewStatus']>, { label: string; className: string }> = {
  active: { label: 'In use', className: 'bg-success/10 text-success' },
  pending_review: { label: 'In review', className: 'bg-warning/15 text-warning-foreground' },
  blocked: { label: 'Rejected', className: 'bg-destructive/10 text-destructive' },
}

/** Creates each imported skill on Meta, 5 at a time; rejected rows come back in `failed`. */
async function createSkills<T extends { name: string; description?: string; instruction: string }>(
  rows: T[],
  forceFail: boolean,
  titleFor: (name: string) => string,
) {
  const created: (T & { title: string; metaId: string; reviewStatus: CustomSkill['reviewStatus'] })[] = []
  const failed: T[] = []
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(
      rows.slice(i, i + 5).map(async (r) => {
        try {
          if (forceFail && i + 5 >= rows.length) throw new Error('forced')
          const title = titleFor(r.name)
          const saved = await saveCustomSkill({ id: '', name: r.name, title, description: r.description, instruction: r.instruction, createdAt: 0 })
          created.push({ ...r, title, metaId: saved.metaId!, reviewStatus: saved.reviewStatus })
        } catch {
          failed.push(r)
        }
      }),
    )
  }
  return { created, failed }
}

export function SkillsSection() {
  const { state, patch, setPendingSkillPrefill } = useWizard()
  const { personalization } = state
  const isServicesCategory = SERVICES_TYPE_CATEGORIES.includes(state.demo.businessCategory)
  const skillCount = personalization.customSkills.length

  const [forceSaveFailure, setForceSaveFailure] = useState(false)

  const [skillEditor, setSkillEditor] = useState<SkillEditorState | null>(null)
  const [skillEditorSaving, setSkillEditorSaving] = useState(false)
  const [skillEditorError, setSkillEditorError] = useState<string | null>(null)
  const [skillWarnings, setSkillWarnings] = useState<Record<string, RowWarning[]>>({})
  const [pendingDeleteSkillId, setPendingDeleteSkillId] = useState<string | null>(null)
  const [deleteSkillError, setDeleteSkillError] = useState<string | null>(null)
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [skillImportOpen, setSkillImportOpen] = useState(false)
  const [highlightSkillId, setHighlightSkillId] = useState<string | null>(null)
  const [pendingUndoSkillImport, setPendingUndoSkillImport] = useState(false)
  const skillRowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  function loadSampleSkills() {
    const now = Date.now()
    const titles: string[] = []
    const skills: CustomSkill[] = SAMPLE_CUSTOM_SKILLS.map((s, i) => {
      const title = uniqueTitle(kebabCase(s.name), titles)
      titles.push(title)
      return { id: newId('skill'), name: s.name, title, instruction: s.instruction, createdAt: now - i * 1000 }
    })
    patch('personalization', { customSkills: skills })
  }

  useRegisterDevControls(
    'skills',
    <DemoControlsGroup label="Skills">
      <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <input type="checkbox" checked={forceSaveFailure} onChange={(e) => setForceSaveFailure(e.target.checked)} />
        Force save failure
      </label>
      <Button variant="outline" size="sm" onClick={loadSampleSkills}>
        Load sample skills
      </Button>
    </DemoControlsGroup>,
  )

  function scrollToAndHighlightSkill(id: string) {
    skillRowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightSkillId(id)
    setTimeout(() => setHighlightSkillId((cur) => (cur === id ? null : cur)), 2000)
  }

  function existingTitlesExcluding(excludeId?: string): string[] {
    return personalization.customSkills.filter((s) => s.id !== excludeId).map((s) => s.title)
  }

  // Review status is Meta's (read-only, PRD V-b1a): refresh it whenever the tab opens.
  useEffect(() => {
    listSkills()
      .then((remote) => {
        const byId = new Map(remote.map((r) => [r.id, r.status]))
        patch('personalization', (prev) => ({
          customSkills: prev.customSkills.map((s) => (s.metaId && byId.has(s.metaId) ? { ...s, reviewStatus: byId.get(s.metaId) } : s)),
        }))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startAddSkill(prefill?: { name: string; instruction: string; description?: string }) {
    setSkillEditor({ mode: 'add', name: prefill?.name ?? '', description: prefill?.description ?? '', instruction: prefill?.instruction ?? '' })
    setSkillEditorError(null)
  }

  // Safety & handoff's "Customise handoff rules" sets this and jumps here — open the editor
  // pre-filled, then consume the signal so it doesn't re-trigger on every re-render.
  useEffect(() => {
    if (state.pendingSkillPrefill) {
      startAddSkill(state.pendingSkillPrefill)
      setPendingSkillPrefill(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingSkillPrefill])

  function startEditSkill(skill: CustomSkill) {
    setSkillEditor({ mode: 'edit', skillId: skill.id, name: skill.name, description: skill.description ?? '', instruction: skill.instruction })
    setSkillEditorError(null)
  }

  async function saveSkillEditor() {
    if (!skillEditor || !skillEditor.name.trim() || !skillEditor.instruction.trim()) return
    const warnings = computeSkillWarnings(skillEditor.instruction, personalization.customSkills, skillEditor.skillId)
    const shouldFail = forceSaveFailure
    setSkillEditorSaving(true)
    setSkillEditorError(null)
    const isEdit = skillEditor.mode === 'edit' && !!skillEditor.skillId
    const id = isEdit ? skillEditor.skillId! : newId('skill')
    const existing = personalization.customSkills.find((s) => s.id === id)
    const skill: CustomSkill = {
      ...(existing ?? { id, createdAt: Date.now() }),
      name: skillEditor.name.trim(),
      title: uniqueTitle(kebabCase(skillEditor.name.trim()), existingTitlesExcluding(isEdit ? id : undefined)),
      description: skillEditor.description.trim(),
      instruction: skillEditor.instruction.trim(),
    }
    try {
      if (shouldFail) throw new Error('forced')
      // Every save goes back through Meta's review, so status resets to what Meta returns.
      Object.assign(skill, await saveCustomSkill(skill))
    } catch (err) {
      setSkillEditorError(shouldFail ? 'Could not save this skill. Nothing was lost.' : `Could not save this skill. Nothing was lost. (${errorText(err)})`)
      return
    } finally {
      setSkillEditorSaving(false)
    }
    patch('personalization', (prev) => ({
      customSkills: isEdit ? prev.customSkills.map((s) => (s.id === id ? skill : s)) : [skill, ...prev.customSkills],
    }))
    setSkillWarnings((prev) => ({ ...prev, [id]: warnings }))
    setSkillEditor(null)
  }

  async function confirmDeleteSkill() {
    if (!pendingDeleteSkillId) return
    const id = pendingDeleteSkillId
    const shouldFail = forceSaveFailure
    const metaId = personalization.customSkills.find((s) => s.id === id)?.metaId
    try {
      if (shouldFail) throw new Error('forced')
      if (metaId) await deleteSkill(metaId)
    } catch {
      setDeleteSkillError('Could not delete. The item is still here.')
      setPendingDeleteSkillId(null)
      return
    }
    patch('personalization', (prev) => ({ customSkills: prev.customSkills.filter((s) => s.id !== id) }))
    setSkillWarnings((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setPendingDeleteSkillId(null)
  }

  async function confirmUndoSkillImport() {
    const batch = personalization.lastSkillImport
    if (!batch) return
    const failedIds = new Set<string>()
    for (const s of personalization.customSkills.filter((k) => k.importBatchId === batch.id)) {
      if (!s.metaId) continue
      try {
        await deleteSkill(s.metaId)
      } catch {
        failedIds.add(s.id)
      }
    }
    if (failedIds.size > 0) setDeleteSkillError(`Could not remove ${failedIds.size} of the imported skills. They are still here.`)
    patch('personalization', (prev) => ({
      customSkills: prev.customSkills.filter((s) => s.importBatchId !== batch.id || failedIds.has(s.id)),
      lastSkillImport: null,
    }))
    setPendingUndoSkillImport(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {skillCount > 0 ? (
          <div>
            <span className={cn(skillCount >= SKILL_COUNT_WARNING_THRESHOLD ? 'text-warning-foreground' : 'text-muted-foreground')} style={{ fontSize: 'var(--text-sm)' }}>
              {skillCount} custom skill{skillCount === 1 ? '' : 's'}
            </span>
            {skillCount >= SKILL_COUNT_WARNING_THRESHOLD && (
              <p className="mt-1 max-w-md text-warning-foreground text-xs">
                Many overlapping skills can make the agent inconsistent. Fewer, clearer skills work better than many
                small ones.
              </p>
            )}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
            Choose from templates
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSkillImportOpen(true)}>
            <Upload className="size-3.5" />
            Import skills from CSV
          </Button>
          <Button size="sm" onClick={() => startAddSkill()} disabled={!!skillEditor}>
            <Plus className="size-3.5" />
            Add a skill
          </Button>
        </div>
      </div>

      {personalization.lastSkillImport && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
          <span className="text-sm">{personalization.lastSkillImport.count} skills imported.</span>
          <button type="button" onClick={() => setPendingUndoSkillImport(true)} className="text-primary text-sm">
            Undo this import
          </button>
        </div>
      )}

      {deleteSkillError && <InlineError message={deleteSkillError} onRetry={() => setDeleteSkillError(null)} />}

      {skillEditor && (
        <SkillEditorCard
          editor={skillEditor}
          saving={skillEditorSaving}
          error={skillEditorError}
          onChange={setSkillEditor}
          onSave={saveSkillEditor}
          onCancel={() => setSkillEditor(null)}
        />
      )}

      {skillCount === 0 && !skillEditor ? (
        <div className="space-y-3 rounded-lg border border-border bg-accent p-4 text-center">
          <span className="flex items-center justify-center gap-1.5">
            <p className="text-muted-foreground text-sm">
              No custom skills yet, and most agents do not need any.
            </p>
            <InfoTooltip text="The controls under Identity → Personality cover tone, languages and length. When there is a specific situation you want handled your way, like warranty questions or discount requests, start from a template or add your own." />
          </span>
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
            Choose from templates
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {personalization.customSkills.map((skill) => {
            const expanded = expandedSkillId === skill.id
            const isEditingThis = skillEditor?.mode === 'edit' && skillEditor.skillId === skill.id
            const warnings = skillWarnings[skill.id]
            if (isEditingThis) return null
            return (
              <div
                key={skill.id}
                ref={(el) => {
                  skillRowRefs.current[skill.id] = el
                }}
                className={cn(
                  'rounded-lg border border-border transition-colors hover:bg-accent',
                  highlightSkillId === skill.id && 'bg-accent',
                )}
              >
                <div className="flex items-start gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setExpandedSkillId(expanded ? null : skill.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {skill.name}
                        {skill.reviewStatus && (
                          <span
                            className={cn('rounded-full px-2 py-0.5 text-xs font-medium', REVIEW_LABEL[skill.reviewStatus].className)}
                            title={
                              skill.reviewStatus === 'blocked'
                                ? 'Rejected in review, most often because it asks for or refers to sensitive personal information. Edit and save it to have it reviewed again.'
                                : skill.reviewStatus === 'pending_review'
                                  ? 'Meta reviews each new skill, usually within minutes. The agent starts using it once it shows In use.'
                                  : 'The agent is using this skill.'
                            }
                          >
                            {REVIEW_LABEL[skill.reviewStatus].label}
                          </span>
                        )}
                      </p>
                      {expanded && skill.description && (
                        <p className="text-muted-foreground text-xs">
                          When it applies: {skill.description}
                        </p>
                      )}
                      <p className={cn('text-muted-foreground text-sm', !expanded && 'line-clamp-2')}>
                        {skill.instruction}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEditSkill(skill)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setPendingDeleteSkillId(skill.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                {warnings && warnings.length > 0 && (
                  <div className="space-y-1 border-t border-border bg-warning/10 px-3 py-2">
                    {warnings.map((w, i) => (
                      <p key={i} className="flex items-center gap-1.5 text-warning-foreground text-xs">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        {w.text}
                        {w.viewExistingId && (
                          <button type="button" onClick={() => scrollToAndHighlightSkill(w.viewExistingId!)} className="underline">
                            View existing
                          </button>
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteSkillId !== null}
        title="Delete this skill?"
        description="The agent will stop following it immediately."
        onConfirm={confirmDeleteSkill}
        onCancel={() => setPendingDeleteSkillId(null)}
      />

      <ConfirmDialog
        open={pendingUndoSkillImport}
        title={`Remove all ${personalization.lastSkillImport?.count ?? 0} skills from this import?`}
        description="Skills you added by hand are not affected."
        confirmLabel="Remove"
        onConfirm={confirmUndoSkillImport}
        onCancel={() => setPendingUndoSkillImport(false)}
      />

      {templatesOpen && (
        <SkillTemplatesDialog
          isServicesCategory={isServicesCategory}
          existingTitles={existingTitlesExcluding()}
          onUseTemplate={(template) => {
            setTemplatesOpen(false)
            startAddSkill({ name: template.name, instruction: template.instruction })
          }}
          onClose={() => setTemplatesOpen(false)}
        />
      )}

      {skillImportOpen && (
        <SkillImportPanel
          existingSkills={personalization.customSkills}
          forceFailure={forceSaveFailure}
          titleFor={(name) => uniqueTitle(kebabCase(name), existingTitlesExcluding())}
          onImported={(rows, batchId) => {
            const now = Date.now()
            const newSkills: CustomSkill[] = rows.map((r, i) => ({
              id: newId('skill'),
              name: r.name,
              title: r.title,
              description: r.description,
              instruction: r.instruction,
              metaId: r.metaId,
              reviewStatus: r.reviewStatus,
              createdAt: now - i,
              importBatchId: batchId,
            }))
            patch('personalization', (prev) => ({
              customSkills: [...newSkills, ...prev.customSkills],
              lastSkillImport: { id: batchId, count: rows.length },
            }))
          }}
          onClose={() => setSkillImportOpen(false)}
        />
      )}
    </div>
  )
}

function SkillEditorCard({
  editor,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  editor: SkillEditorState
  saving: boolean
  error: string | null
  onChange: (editor: SkillEditorState) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <Label htmlFor="skill-name">Skill name</Label>
          <InfoTooltip text="A short name so you can find it later." />
        </span>
        <Input
          id="skill-name"
          autoFocus
          maxLength={MAX_SKILL_NAME}
          value={editor.name}
          onChange={(e) => onChange({ ...editor, name: e.target.value })}
          placeholder="e.g. Handling warranty questions"
        />
      </div>
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5">
          <Label htmlFor="skill-description">Description</Label>
          <InfoTooltip text="When and where this skill applies. The agent reads this to decide when to use it." />
        </span>
        <Textarea
          id="skill-description"
          rows={2}
          maxLength={MAX_SKILL_DESCRIPTION}
          value={editor.description}
          onChange={(e) => onChange({ ...editor, description: e.target.value })}
          placeholder="e.g. When a customer asks about the warranty on a product they bought."
          className="bg-input-background shadow-sm"
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="skill-instruction">Instruction</Label>
            <InfoTooltip text="Write what the agent should do in plain language. One situation per skill works best." />
          </span>
          <AiWriteButtons
            current={editor.instruction}
            context={{ goal: [editor.name, editor.description].filter((x) => x.trim()).join(': ') }}
            draftTask="draft_skill"
            onText={(instruction) => onChange({ ...editor, instruction: instruction.slice(0, MAX_SKILL_INSTRUCTION) })}
          />
        </div>
        <Textarea
          id="skill-instruction"
          rows={5}
          maxLength={MAX_SKILL_INSTRUCTION}
          value={editor.instruction}
          onChange={(e) => onChange({ ...editor, instruction: e.target.value })}
          placeholder="Describe the situation and what the agent should do. e.g. When a customer asks about warranty, explain that all products carry a 1 year warranty. Ask for their order number and offer to connect them to a person for claims."
          className="bg-input-background shadow-sm"
        />
        <div className="flex items-center justify-end">
          {editor.instruction.length > 1600 && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {editor.instruction.length}/{MAX_SKILL_INSTRUCTION}
            </span>
          )}
        </div>
        {error && <InlineError message={error} onRetry={onSave} />}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={!editor.name.trim() || !editor.instruction.trim() || saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save skill'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function SkillTemplatesDialog({
  isServicesCategory,
  existingTitles,
  onUseTemplate,
  onClose,
}: {
  isServicesCategory: boolean
  existingTitles: string[]
  onUseTemplate: (template: { name: string; instruction: string }) => void
  onClose: () => void
}) {
  const suggested = SKILL_TEMPLATES.filter((t) => (isServicesCategory ? !t.retailSuggested : t.retailSuggested))
  const rest = SKILL_TEMPLATES.filter((t) => !suggested.includes(t))

  function renderGroup(heading: string, templates: typeof SKILL_TEMPLATES) {
    if (templates.length === 0) return null
    return (
      <div className="space-y-2">
        <p className="font-medium">{heading}</p>
        <div className="grid grid-cols-2 gap-3">
          {templates.map((template) => {
            const alreadyAdded = existingTitles.includes(kebabCase(template.name))
            return (
              <div key={template.name} className="space-y-2 rounded-lg border border-border p-3">
                <p className={cn(alreadyAdded && 'text-muted-foreground')} style={{ fontWeight: 'var(--font-weight-medium)' }}>
                  {template.name}
                </p>
                <p className="line-clamp-2 text-muted-foreground text-xs">
                  {template.instruction}
                </p>
                <Button size="sm" variant="outline" disabled={alreadyAdded} onClick={() => onUseTemplate(template)}>
                  {alreadyAdded ? 'Added' : 'Use this'}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose from templates</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-6 overflow-y-auto">
          {renderGroup('Suggested for your business', suggested)}
          {renderGroup('All templates', rest)}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- Skill CSV import ----

type ImportStage = 'upload' | 'mapping' | 'review' | 'saving' | 'done'
interface SkillReviewRow {
  name: string
  description?: string
  instruction: string
  rowNumber: number
  warnings: RowWarning[]
}
interface SkippedRow {
  rowNumber: number
  reason: string
}

function buildSkillReview(dataRows: string[][], nameIdx: number, instrIdx: number, existingSkills: CustomSkill[], descIdx = -1) {
  const toImport: SkillReviewRow[] = []
  const skipped: SkippedRow[] = []
  const seenInFile = new Map<string, number>()
  dataRows.forEach((cells, i) => {
    const rowNumber = i + 1
    const name = (cells[nameIdx] ?? '').trim()
    const instruction = (cells[instrIdx] ?? '').trim()
    if (!name) {
      skipped.push({ rowNumber, reason: 'Name is empty' })
      return
    }
    if (!instruction) {
      skipped.push({ rowNumber, reason: 'Instruction is empty' })
      return
    }
    const norm = normalizeForCompare(instruction)
    if (seenInFile.has(norm)) {
      skipped.push({ rowNumber, reason: `Duplicate of row ${seenInFile.get(norm)}` })
      return
    }
    if (findSimilarSkill(instruction, existingSkills)) {
      skipped.push({ rowNumber, reason: 'Very similar to an existing skill' })
      return
    }
    seenInFile.set(norm, rowNumber)
    const description = descIdx >= 0 ? (cells[descIdx] ?? '').trim().slice(0, MAX_SKILL_DESCRIPTION) : undefined
    toImport.push({ name, description, instruction, rowNumber, warnings: computeSkillWarnings(instruction, existingSkills) })
  })
  return { toImport, skipped }
}

type ImportedSkillRow = { name: string; title: string; description?: string; instruction: string; metaId: string; reviewStatus: CustomSkill['reviewStatus'] }

function SkillImportPanel({
  existingSkills,
  forceFailure,
  titleFor,
  onImported,
  onClose,
}: {
  existingSkills: CustomSkill[]
  forceFailure: boolean
  titleFor: (name: string) => string
  onImported: (rows: ImportedSkillRow[], batchId: string) => void
  onClose: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<ImportStage>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapName, setMapName] = useState<string | null>(null)
  const [mapInstruction, setMapInstruction] = useState<string | null>(null)
  const [review, setReview] = useState<{ toImport: SkillReviewRow[]; skipped: SkippedRow[] } | null>(null)
  const [problemsOpen, setProblemsOpen] = useState(false)
  const [saveResult, setSaveResult] = useState<{ imported: number; failed: SkillReviewRow[] } | null>(null)

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCsv(String(reader.result ?? ''))
      if (rows.length === 0) return
      const [head, ...rest] = rows
      setHeaders(head)
      setDataRows(rest)
      const norm = head.map((h) => h.trim().toLowerCase())
      // PRD headers are title / description / instruction; "name" still accepted.
      const ni = norm.indexOf('title') !== -1 ? norm.indexOf('title') : norm.indexOf('name')
      const ii = norm.indexOf('instruction')
      if (ni !== -1 && ii !== -1) {
        setReview(buildSkillReview(rest, ni, ii, existingSkills, norm.indexOf('description')))
        setStage('review')
      } else {
        setStage('mapping')
      }
    }
    reader.readAsText(file)
  }

  function confirmMapping() {
    if (!mapName || !mapInstruction) return
    const ni = headers.indexOf(mapName)
    const ii = headers.indexOf(mapInstruction)
    setReview(buildSkillReview(dataRows, ni, ii, existingSkills))
    setStage('review')
  }

  async function runImport() {
    if (!review) return
    setStage('saving')
    const { created, failed } = await createSkills(review.toImport, forceFailure, titleFor)
    if (created.length > 0) onImported(created, newId('import'))
    setSaveResult({ imported: created.length, failed })
    setStage('done')
    if (failed.length === 0) onClose()
  }

  async function retryFailed() {
    if (!saveResult || saveResult.failed.length === 0) return
    const { created, failed } = await createSkills(saveResult.failed, false, titleFor)
    if (created.length > 0) onImported(created, newId('import'))
    setSaveResult({ imported: saveResult.imported + created.length, failed })
    if (failed.length === 0) onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import skills from CSV</DialogTitle>
        </DialogHeader>

        {stage === 'upload' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-muted-foreground text-sm">
                Your file needs two columns: name and instruction.
              </p>
              <button
                type="button"
                onClick={() =>
                  downloadCsv('skills-template.csv', [
                    'name,instruction',
                    '"Handling warranty questions","When a customer asks about warranty, explain that all products carry a 1 year warranty and ask for their order number."',
                    '"Out of stock requests","When a product is out of stock, apologise, say when it is expected back if known, and offer a similar product."',
                  ])
                }
                className="text-primary text-sm"
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
              <Label>Which column has the names?</Label>
              <Select value={mapName ?? undefined} onValueChange={setMapName}>
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
              <Label>Which column has the instructions?</Label>
              <Select value={mapInstruction ?? undefined} onValueChange={setMapInstruction}>
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
              <Button onClick={confirmMapping} disabled={!mapName || !mapInstruction}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'review' && review && (
          <div className="space-y-3">
            <p className="text-sm">{dataRows.length} skills found</p>
            <p className="text-sm">{review.toImport.length} will be imported</p>
            {review.skipped.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-warning-foreground text-sm">
                  {review.skipped.length} have problems and will be skipped
                  <button type="button" onClick={() => setProblemsOpen((v) => !v)} className="text-primary underline">
                    View problems
                  </button>
                </p>
                {problemsOpen && (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-xs">
                    {review.skipped.map((s) => (
                      <li key={s.rowNumber}>
                        Row {s.rowNumber}: {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {review.toImport.some((r) => r.warnings.length > 0) && (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg bg-warning/10 p-3 text-xs">
                {review.toImport
                  .filter((r) => r.warnings.length > 0)
                  .map((r) => (
                    <li key={r.rowNumber} className="text-warning-foreground">
                      Row {r.rowNumber} ({r.name}): {r.warnings.map((w) => w.text).join(' ')}
                    </li>
                  ))}
              </ul>
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
            <span className="text-sm">Importing&hellip;</span>
          </div>
        )}

        {stage === 'done' && saveResult && saveResult.failed.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm">
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

/** "Write it for me" and "Improve" beside an instruction field (Claude, through server/assist.ts). */
function AiWriteButtons({ current, context, draftTask, onText }: { current: string; context: WriteContext; draftTask: WriteTask; onText: (t: string) => void }) {
  const [busy, setBusy] = useState<WriteTask | null>(null)
  async function run(task: WriteTask) {
    setBusy(task)
    try {
      onText((await assistWrite(task, current, context)).text)
    } catch (err) {
      toast.error('Couldn’t write that', { description: errorDetail(err) })
    } finally {
      setBusy(null)
    }
  }
  return (
    <span className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="xs" onClick={() => void run(draftTask)} disabled={!!busy || !context.goal?.trim()} title={!context.goal?.trim() ? 'Give the skill a name or description first' : undefined}>
        {busy === draftTask ? <Loader2 className="animate-spin" /> : <Wand2 />}
        Write it for me
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => void run('improve')} disabled={!!busy || !current.trim()}>
        {busy === 'improve' ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Improve
      </Button>
    </span>
  )
}
