import type { ReactNode } from 'react'
import { Lock, Pencil } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/app/components/ui/accordion'
import { Badge } from '@/app/components/ui/badge'
import {
  TableExtended,
  TableExtendedBody,
  TableExtendedCell,
  TableExtendedHead,
  TableExtendedHeader,
  TableExtendedRow,
} from '@/app/components/ui/table-extended'
import { CONNECTION_STATUS_META, RICH_REPLY_TYPE_LABEL } from '@/app/wizard/mockData'
import type { CompiledConfig } from '@/app/wizard/compiler'
import type { ConnectionStatus, StepId, WizardState } from '@/app/wizard/types'

function FieldTable({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <TableExtended>
      <TableExtendedBody>
        {rows.map((row) => (
          <TableExtendedRow key={row.label}>
            <TableExtendedCell className="w-48 whitespace-normal text-muted-foreground">{row.label}</TableExtendedCell>
            <TableExtendedCell className="whitespace-normal">{row.value.trim() || 'Not provided'}</TableExtendedCell>
          </TableExtendedRow>
        ))}
      </TableExtendedBody>
    </TableExtended>
  )
}

function connectionStatusBadge(status: ConnectionStatus) {
  const meta = CONNECTION_STATUS_META[status]
  if (meta.dot === 'success') return <Badge className="bg-success text-success-foreground">{meta.label}</Badge>
  if (meta.dot === 'warning') return <Badge className="bg-warning text-warning-foreground">{meta.label}</Badge>
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {meta.label}
    </Badge>
  )
}

function enabledBadge(enabled: boolean) {
  return enabled ? (
    <Badge className="bg-success text-success-foreground">On</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Off
    </Badge>
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

      <TabsContent value="skills" className="mt-4 space-y-4">
        <SkillGroup title="Managed by Helo" icon={Lock} skills={config.skills.filter((s) => s.managed)} />
        <SkillGroup title="Your custom skills" icon={Pencil} skills={config.skills.filter((s) => !s.managed)} />
      </TabsContent>

      <TabsContent value="business_info" className="mt-4">
        <FieldTable
          rows={[
            { label: 'Business description', value: config.business_info.business_description },
            { label: 'Payment methods', value: config.business_info.payment_method },
            { label: 'Return policy', value: config.business_info.return_policy },
            { label: 'Purchase info', value: config.business_info.purchase_info },
            { label: 'Delivery and shipping', value: config.business_info.delivery_and_shipping },
            { label: 'Contact email', value: config.business_info.contact_info.email },
            { label: 'Hours of operation', value: config.business_info.contact_info.hours_of_operation },
            { label: 'Business address', value: config.business_info.contact_info.address },
          ]}
        />
      </TabsContent>

      <TabsContent value="knowledge" className="mt-4">
        <TableExtended>
          <TableExtendedBody>
            <TableExtendedRow>
              <TableExtendedCell className="w-48 text-muted-foreground">FAQs</TableExtendedCell>
              <TableExtendedCell>
                <LinkButton onClick={() => onNavigate('knowledge', 'faq')}>
                  {faqCount} FAQ{faqCount === 1 ? '' : 's'}
                </LinkButton>
              </TableExtendedCell>
            </TableExtendedRow>
            <TableExtendedRow>
              <TableExtendedCell className="w-48 text-muted-foreground">Documents</TableExtendedCell>
              <TableExtendedCell>
                <LinkButton onClick={() => onNavigate('knowledge', 'documents')}>
                  {docCount} document{docCount === 1 ? '' : 's'}
                </LinkButton>
              </TableExtendedCell>
            </TableExtendedRow>
            <TableExtendedRow>
              <TableExtendedCell className="w-48 text-muted-foreground">Website</TableExtendedCell>
              <TableExtendedCell>
                <LinkButton onClick={() => onNavigate('knowledge', 'website')}>
                  {siteCount} website{siteCount === 1 ? '' : 's'} crawled
                </LinkButton>
              </TableExtendedCell>
            </TableExtendedRow>
          </TableExtendedBody>
        </TableExtended>
      </TabsContent>

      <TabsContent value="connections" className="mt-4">
        {connections.connections.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No connections yet.
          </p>
        ) : (
          <TableExtended>
            <TableExtendedHeader>
              <TableExtendedRow>
                <TableExtendedHead>Connection</TableExtendedHead>
                <TableExtendedHead>Status</TableExtendedHead>
                <TableExtendedHead>Actions</TableExtendedHead>
                <TableExtendedHead className="w-10" />
              </TableExtendedRow>
            </TableExtendedHeader>
            <TableExtendedBody>
              {connections.connections.map((conn) => {
                const actionCount = connections.actions.filter((a) => a.connectionId === conn.id).length
                return (
                  <TableExtendedRow key={conn.id}>
                    <TableExtendedCell style={{ fontWeight: 'var(--font-weight-medium)' }}>{conn.name}</TableExtendedCell>
                    <TableExtendedCell>{connectionStatusBadge(conn.demoStatus)}</TableExtendedCell>
                    <TableExtendedCell className="text-muted-foreground">
                      {actionCount} action{actionCount === 1 ? '' : 's'}
                    </TableExtendedCell>
                    <TableExtendedCell>
                      <LinkButton onClick={() => onNavigate('connections')}>View</LinkButton>
                    </TableExtendedCell>
                  </TableExtendedRow>
                )
              })}
            </TableExtendedBody>
          </TableExtended>
        )}
      </TabsContent>

      <TabsContent value="rich_replies" className="mt-4">
        {richReplies.richReplies.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No rich replies yet.
          </p>
        ) : (
          <TableExtended>
            <TableExtendedHeader>
              <TableExtendedRow>
                <TableExtendedHead>Rich reply</TableExtendedHead>
                <TableExtendedHead>Type</TableExtendedHead>
                <TableExtendedHead>Status</TableExtendedHead>
                <TableExtendedHead className="w-10" />
              </TableExtendedRow>
            </TableExtendedHeader>
            <TableExtendedBody>
              {richReplies.richReplies.map((reply) => (
                <TableExtendedRow key={reply.id}>
                  <TableExtendedCell style={{ fontWeight: 'var(--font-weight-medium)' }}>{reply.name}</TableExtendedCell>
                  <TableExtendedCell className="text-muted-foreground">{RICH_REPLY_TYPE_LABEL[reply.type]}</TableExtendedCell>
                  <TableExtendedCell>{enabledBadge(reply.enabled)}</TableExtendedCell>
                  <TableExtendedCell>
                    <LinkButton onClick={() => onNavigate('agent', 'richReplies')}>View</LinkButton>
                  </TableExtendedCell>
                </TableExtendedRow>
              ))}
            </TableExtendedBody>
          </TableExtended>
        )}
      </TabsContent>

      <TabsContent value="settings" className="mt-4">
        <FieldTable
          rows={[
            {
              label: 'Words and topics avoided',
              value: [...guardrails.neverSayPhrases, ...guardrails.topicsToAvoid].join(', '),
            },
            {
              label: 'Handoff message',
              value: guardrails.handoffMessageEnabled ? guardrails.handoffMessage : 'Off',
            },
            {
              label: 'Follow-up',
              value: replies.followUpEnabled ? replies.followUpMessage : 'Off',
            },
          ]}
        />
      </TabsContent>

      <TabsContent value="allowlist" className="mt-4">
        {config.allowlist.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No allowlist entries yet.
          </p>
        ) : (
          <TableExtended>
            <TableExtendedBody>
              {config.allowlist.map((entry) => (
                <TableExtendedRow key={entry.consumer_phone_number}>
                  <TableExtendedCell>{entry.consumer_phone_number}</TableExtendedCell>
                </TableExtendedRow>
              ))}
            </TableExtendedBody>
          </TableExtended>
        )}
      </TabsContent>
    </Tabs>
  )
}

function SkillGroup({
  title,
  icon: Icon,
  skills,
}: {
  title: string
  icon: typeof Lock
  skills: CompiledConfig['skills']
}) {
  if (skills.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-muted-foreground" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--font-weight-medium)' }}>
        {title}
      </p>
      <Accordion type="multiple" className="rounded-lg border border-border px-3">
        {skills.map((skill) => (
          <AccordionItem key={skill.title} value={skill.title}>
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <code style={{ fontSize: 'var(--text-xs)' }}>{skill.title}</code>
                <Badge variant="secondary">{skill.channel}</Badge>
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
    </div>
  )
}
