import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/app/components/ui/accordion'
import { Badge } from '@/app/components/ui/badge'
import type { CompiledConfig } from '@/app/wizard/compiler'

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-foreground" style={{ fontSize: 'var(--text-xs)' }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function CompiledConfigViewer({ config }: { config: CompiledConfig }) {
  return (
    <Tabs defaultValue="skills">
      <TabsList>
        <TabsTrigger value="skills">Skills ({config.skills.length})</TabsTrigger>
        <TabsTrigger value="business_info">business_info</TabsTrigger>
        <TabsTrigger value="settings">settings</TabsTrigger>
        <TabsTrigger value="allowlist">allowlist ({config.allowlist.length})</TabsTrigger>
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

      <TabsContent value="business_info">
        <JsonBlock value={config.business_info} />
      </TabsContent>

      <TabsContent value="settings">
        <JsonBlock value={config.settings} />
      </TabsContent>

      <TabsContent value="allowlist">
        {config.allowlist.length === 0 ? (
          <p className="text-muted-foreground" style={{ fontSize: 'var(--text-sm)' }}>
            No allowlist entries yet.
          </p>
        ) : (
          <JsonBlock value={config.allowlist} />
        )}
      </TabsContent>
    </Tabs>
  )
}
