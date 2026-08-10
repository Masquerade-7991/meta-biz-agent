import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/app/components/ui/accordion'
import { Badge } from '@/app/components/ui/badge'
import { CONNECTION_STATUS_META, RICH_REPLY_TYPE_LABEL } from '@/app/wizard/mockData'
import type { CompiledConfig } from '@/app/wizard/compiler'
import type { StepId, WizardState } from '@/app/wizard/types'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
        {label}
      </p>
      <p style={{ fontSize: 'var(--text-sm)' }}>{value.trim() || 'Not provided'}</p>
    </div>
  )
}

function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-primary underline underline-offset-2" style={{ fontSize: 'inherit' }}>
      {children}
    </button>
  )
}

export function CompiledConfigViewer({
  config,
  state,
  onNavigate,
}: {
  config: CompiledConfig
  state: WizardState
  onNavigate: (step: StepId, tab?: string) => void
}) {
  const { knowledge, connections, richReplies, guardrails, replies } = state
  const faqCount = knowledge.faqs.length
  const docCount = knowledge.documents.length
  const siteCount = knowledge.websites.length

  return (
    <Tabs defaultValue="skills">
      <TabsList className="flex-wrap">
        <TabsTrigger value="skills">Skills ({config.skills.length})</TabsTrigger>
        <TabsTrigger value="business_info">Business info</TabsTrigger>
        <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        <TabsTrigger value="connections">Connections ({connections.connections.length})</TabsTrigger>
        <TabsTrigger value="rich_replies">Rich replies ({richReplies.richReplies.length})</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="allowlist">Allowlist ({config.allowlist.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="skills">
        <Accordion type="multiple" className="rounded-lg border border-border px-3">
          {config.skills.map((skill) => (
            <AccordionItem key={skill.title} value={skill.title}>
              <AccordionTrigger>
                <span className="flex items-center gap-2">
                  <code style={{ fontSize: 'var(--text-xs)' }}>{skill.title}</code>
                  <Badge variant="outline">{skill.channel}</Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <p className="mb-2 text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {skill.description}
                </p>
                <pre
                  className="overflow-x-auto rounded-lg bg-muted p-4 text-foreground"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  {skill.skill}
                </pre>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </TabsContent>

      <TabsContent value="business_info" className="rounded-lg border border-border px-4">
        <Field label="Business description" value={config.business_info.business_description} />
        <Field label="Payment methods" value={config.business_info.payment_method} />
        <Field label="Return policy" value={config.business_info.return_policy} />
        <Field label="Purchase info" value={config.business_info.purchase_info} />
        <Field label="Delivery and shipping" value={config.business_info.delivery_and_shipping} />
        <Field label="Contact email" value={config.business_info.contact_info.email} />
        <Field label="Hours of operation" value={config.business_info.contact_info.hours_of_operation} />
        <Field label="Business address" value={config.business_info.contact_info.address} />
      </TabsContent>

      <TabsContent value="knowledge" className="space-y-1">
        <p style={{ fontSize: 'var(--text-sm)' }}>
          <LinkButton onClick={() => onNavigate('knowledge', 'faq')}>
            {faqCount} FAQ{faqCount === 1 ? '' : 's'}
          </LinkButton>
          {', '}
          <LinkButton onClick={() => onNavigate('knowledge', 'documents')}>
            {docCount} document{docCount === 1 ? '' : 's'}
          </LinkButton>
          {', '}
          <LinkButton onClick={() => onNavigate('knowledge', 'website')}>
            {siteCount} website{siteCount === 1 ? '' : 's'} crawled
          </LinkButton>
        </p>
      </TabsContent>

      <TabsContent value="connections" className="space-y-2">
        {connections.connections.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No connections yet.
          </p>
        ) : (
          connections.connections.map((conn) => {
            const actionCount = connections.actions.filter((a) => a.connectionId === conn.id).length
            return (
              <div key={conn.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-2">
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>{conn.name}</p>
                  <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                    {CONNECTION_STATUS_META[conn.demoStatus].label} · {actionCount} action{actionCount === 1 ? '' : 's'}
                  </p>
                </div>
                <LinkButton onClick={() => onNavigate('connections')}>View</LinkButton>
              </div>
            )
          })
        )}
      </TabsContent>

      <TabsContent value="rich_replies" className="space-y-2">
        {richReplies.richReplies.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No rich replies yet.
          </p>
        ) : (
          richReplies.richReplies.map((reply) => (
            <div key={reply.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-2">
              <div>
                <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>{reply.name}</p>
                <p className="text-muted-foreground" style={{ fontSize: 'var(--text-xs)' }}>
                  {RICH_REPLY_TYPE_LABEL[reply.type]} · {reply.enabled ? 'On' : 'Off'}
                </p>
              </div>
              <LinkButton onClick={() => onNavigate('agent', 'richReplies')}>View</LinkButton>
            </div>
          ))
        )}
      </TabsContent>

      <TabsContent value="settings" className="rounded-lg border border-border px-4">
        <Field
          label="Words and topics avoided"
          value={[...guardrails.neverSayPhrases, ...guardrails.topicsToAvoid].join(', ')}
        />
        <Field
          label="Handoff message"
          value={guardrails.handoffMessageEnabled ? guardrails.handoffMessage : 'Off'}
        />
        <Field
          label="Follow-up"
          value={replies.followUpEnabled ? replies.followUpMessage : 'Off'}
        />
      </TabsContent>

      <TabsContent value="allowlist">
        {config.allowlist.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No allowlist entries yet.
          </p>
        ) : (
          <ul className="space-y-1 rounded-lg border border-border px-4 py-2">
            {config.allowlist.map((entry) => (
              <li key={entry.consumer_phone_number} style={{ fontSize: 'var(--text-sm)' }}>
                {entry.consumer_phone_number}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  )
}
