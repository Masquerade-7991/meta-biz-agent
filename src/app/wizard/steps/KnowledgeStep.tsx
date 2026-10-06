import { useEffect, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { LoadFailedBanner, LoadingIndicator } from '@/app/components/wizard/RetryBanner'
import { DemoControlsGroup } from '@/app/components/wizard/DemoControlsGroup'
import { useWizard } from '@/app/wizard/WizardContext'
import { useRegisterDevControls } from '@/app/wizard/DevControlsContext'
import { SAMPLE_DOCUMENTS, SAMPLE_FAQS, SAMPLE_WEBSITES, newId } from '@/app/wizard/mockData'
import { BusinessProfileStep } from './BusinessProfileStep'
import { hasAnyBusinessDetails } from '@/app/wizard/validation'
import { DocumentsTab, FaqTab, WebsiteTab } from './KnowledgeBaseStep'
import { generateFakeSubpages } from '@/app/wizard/mockData'
import type { FaqRow } from '@/app/wizard/types'

type TabId = 'business' | 'faq' | 'documents' | 'website'

export function KnowledgeStep() {
  const { state, patch, setPendingStepFocus } = useWizard()
  const { knowledge, business } = state
  const category = state.demo.businessCategory

  const [activeTab, setActiveTab] = useState<TabId>('business')
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')

  // Arriving here via a "Compiled configuration" link on Test & publish — jump to the tab it named.
  useEffect(() => {
    if (state.pendingStepFocus?.step === 'knowledge' && state.pendingStepFocus.tab) {
      setActiveTab(state.pendingStepFocus.tab as TabId)
      setPendingStepFocus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingStepFocus])

  // Governs FAQ, Documents and Website only — Business details manages its own load/save
  // lifecycle internally (see BusinessProfileStep), unchanged from the Business Profile spec.
  useEffect(() => {
    const willFail = state.demo.forceNextFailure
    if (willFail) patch('demo', { forceNextFailure: false })
    const timer = setTimeout(() => setLoadStatus(willFail ? 'failed' : 'loaded'), 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function retryLoad() {
    setLoadStatus('loading')
    const willFail = state.demo.forceNextFailure
    if (willFail) patch('demo', { forceNextFailure: false })
    setTimeout(() => setLoadStatus(willFail ? 'failed' : 'loaded'), 600)
  }

  function consumeForcedFailure(): boolean {
    if (!state.demo.forceNextFailure) return false
    patch('demo', { forceNextFailure: false })
    return true
  }

  function loadSampleKnowledge() {
    const now = Date.now()
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
  }

  function loadManyFaqs() {
    const now = Date.now()
    const faqs: FaqRow[] = Array.from({ length: 160 }, (_, i) => ({
      id: newId('faq'),
      question: `Sample question ${i + 1}?`,
      answer: `Sample answer ${i + 1}.`,
      createdAt: now - i * 1000,
    }))
    patch('knowledge', { faqs })
  }

  useRegisterDevControls(
    'knowledge',
    <DemoControlsGroup label="Knowledge">
      <Button variant="outline" size="sm" onClick={loadSampleKnowledge}>
        Load sample knowledge
      </Button>
      <Button variant="outline" size="sm" onClick={() => patch('demo', { forceNextFailure: !state.demo.forceNextFailure })}>
        {state.demo.forceNextFailure ? 'Force action failure (armed)' : 'Force action failure'}
      </Button>
      <Button variant="outline" size="sm" onClick={loadManyFaqs}>
        Many FAQs
      </Button>
    </DemoControlsGroup>,
  )

  const businessProvided = hasAnyBusinessDetails(business)
  const faqCount = knowledge.faqs.length
  const docCount = knowledge.documents.length
  const siteCount = knowledge.websites.length
  const allEmpty = !businessProvided && faqCount === 0 && docCount === 0 && siteCount === 0

  const coverageParts: string[] = []
  if (businessProvided) coverageParts.push('Business details provided')
  if (faqCount > 0) coverageParts.push(`${faqCount} FAQ${faqCount === 1 ? '' : 's'}`)
  if (docCount > 0) coverageParts.push(`${docCount} document${docCount === 1 ? '' : 's'}`)
  if (siteCount > 0) coverageParts.push(`${siteCount} website${siteCount === 1 ? '' : 's'}`)

  return (
    <div className="space-y-4">
      {loadStatus === 'loading' ? (
        <LoadingIndicator label="Loading your knowledge base" />
      ) : allEmpty ? (
        <div className="space-y-1 rounded-lg border border-border bg-muted p-4">
          <p style={{ fontWeight: 'var(--font-weight-semi-bold)' }}>Your agent has no knowledge yet.</p>
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            It can still chat, but it will not be able to answer specific questions about your business. The
            fastest way to start: add your website, or add 5 to 10 common questions.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
          <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--foreground)' }}>
            Your agent&rsquo;s knowledge:
          </span>{' '}
          {coverageParts.join(' · ')}
        </p>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList>
          <TabsTrigger value="business">Business details</TabsTrigger>
          <TabsTrigger value="faq" className="gap-1.5">
            FAQ
            <Badge variant="secondary" className="text-muted-foreground">
              {faqCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5">
            Documents
            <Badge variant="secondary" className="text-muted-foreground">
              {docCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="website" className="gap-1.5">
            Website
            <Badge variant="secondary" className="text-muted-foreground">
              {siteCount}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* forceMount + CSS-hidden (not Radix's default unmount-when-inactive) so Business
            details keeps its own guard registered and its load/save state alive regardless of
            which tab is showing — otherwise switching tabs would silently drop unsaved changes. */}
        <TabsContent value="business" forceMount className="data-[state=inactive]:hidden">
          <BusinessProfileStep />
        </TabsContent>

        <TabsContent value="faq" className="space-y-3">
          {loadStatus === 'failed' ? (
            <LoadFailedBanner message="We could not load what is saved here." onRetry={retryLoad} />
          ) : (
            <FaqTab
              faqs={knowledge.faqs}
              lastImport={knowledge.lastFaqImport}
              category={category}
              loading={loadStatus === 'loading'}
              patchKnowledge={(fn) => patch('knowledge', fn)}
              consumeForcedFailure={consumeForcedFailure}
            />
          )}
        </TabsContent>

        <TabsContent value="documents" className="space-y-3">
          {loadStatus === 'failed' ? (
            <LoadFailedBanner message="We could not load what is saved here." onRetry={retryLoad} />
          ) : (
            <DocumentsTab
              documents={knowledge.documents}
              loading={loadStatus === 'loading'}
              patchKnowledge={(fn) => patch('knowledge', fn)}
              consumeForcedFailure={consumeForcedFailure}
            />
          )}
        </TabsContent>

        <TabsContent value="website" className="space-y-3">
          {loadStatus === 'failed' ? (
            <LoadFailedBanner message="We could not load what is saved here." onRetry={retryLoad} />
          ) : (
            <WebsiteTab
              websites={knowledge.websites}
              loading={loadStatus === 'loading'}
              patchKnowledge={(fn) => patch('knowledge', fn)}
              consumeForcedFailure={consumeForcedFailure}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
