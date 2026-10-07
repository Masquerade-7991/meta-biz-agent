// server/broadcasts.ts: WhatsApp message templates and template broadcasts to segments.
import { area, d, o } from './helpers.ts'

const TEMPLATE_REF = o({ 'name*': 'string', 'language*': d('string', 'e.g. en_US.') })
const SAMPLE = 'Sample contacts and chats are stored but never sent to WhatsApp.'

export const broadcasts = area('Broadcasts & templates', {
  '/api/broadcasts/templates': {
    get: { id: 'listTemplates', summary: 'Message templates', description: 'Read live from your WhatsApp account (500 at most). Needs a connected account.', ok: 'WaTemplate[]' },
    post: {
      id: 'createTemplate',
      summary: 'Submit a template for Meta’s review',
      who: 'templates.create',
      body: o({
        'name*': d('string', 'Lowercase letters, numbers and underscores, like order_update.', { pattern: '^[a-z0-9_]+$' }),
        'category*': 'MARKETING|UTILITY',
        'language*': 'string',
        header: 'string',
        'body*': d('string', 'Up to 1024 characters; variables as {{1}}, {{2}}…', { maxLength: 1024 }),
        footer: 'string',
        buttons: { type: 'array', items: o({ 'type*': 'QUICK_REPLY|URL', 'text*': 'string', url: 'string' }) },
        examples: d({ type: 'object', additionalProperties: { type: 'string' } }, 'An example per variable, keyed like "body:1", for Meta’s review.'),
      }),
      ok: o({ 'id*': 'string', 'status*': d('string', 'Usually PENDING.') }),
      errors: {
        400: 'Template names use lowercase letters, numbers and underscores only, like order_update. / The message is required and can be up to 1024 characters. / Add an example for {{1}} so Meta can review the template.',
        403: 'Supervisors, admins and owners create templates.',
        502: 'WhatsApp didn’t accept it (Meta’s reason).',
      },
    },
  },
  '/api/broadcasts/templates/{name}': {
    delete: {
      id: 'deleteTemplate',
      summary: 'Delete a template',
      description: 'Deletes every language of it on WhatsApp.',
      who: 'templates.delete',
      params: { name: d('string', 'Template name.', { pattern: '^[a-z0-9_]+$' }) },
      errors: { 403: 'Only owners and admins can delete templates.' },
    },
  },
  '/api/broadcasts/send-one': {
    post: {
      id: 'sendTemplateToChat',
      summary: 'Send one template to one chat',
      description: `E.g. to restart a conversation after the 24-hour window. Takes the chat over for the team. ${SAMPLE}`,
      body: o({ 'phone*': 'string', 'template*': TEMPLATE_REF, values: d({ type: 'object', additionalProperties: { type: 'string' } }, 'Variable values, keyed like the template’s slots.') }),
      errors: {
        404: 'No chat with this number yet. / Template X (en_US) wasn’t found on your WhatsApp account.',
        400: 'Template X is pending; only approved templates can be sent. / A value doesn’t fit its slot.',
      },
    },
  },
  '/api/broadcasts/preflight': {
    post: {
      id: 'broadcastPreflight',
      summary: 'Check a broadcast before sending',
      description: 'Who it reaches, who already got a marketing message today (WhatsApp may hold theirs back), and the estimated cost from your own recent rates.',
      body: o({ segmentId: d('string?', 'Empty: all contacts who accept messages.'), category: d('MARKETING|UTILITY', 'Default MARKETING.') }),
      ok: 'Preflight',
      errors: { 404: 'That segment no longer exists.' },
    },
  },
  '/api/broadcasts': {
    get: { id: 'listBroadcasts', summary: 'Broadcasts', description: 'Newest first, 200 at most.', ok: 'Broadcast[]' },
    post: {
      id: 'createBroadcast',
      summary: 'Send or schedule a broadcast',
      description: `Queues one templated message per contact in the segment; a background worker sends them within WhatsApp’s limits and retries what WhatsApp asks to retry. ${SAMPLE}`,
      who: 'broadcasts.send',
      body: o({
        'name*': d('string', 'Up to 100 characters.'),
        'template*': TEMPLATE_REF,
        'mapping*': d(
          { type: 'object', additionalProperties: o({ 'source*': d('string', '`text`, `name`, `phone` or `field:<key>`.'), text: d('string', 'The fixed value, or the fallback when the contact has none.') }) },
          'What goes in each template slot.',
        ),
        segmentId: 'string?',
        scheduledAt: d('date-time', 'Empty: send now.'),
      }),
      ok: 'BroadcastDetail',
      errors: {
        400: 'Give the broadcast a name. / Choose what goes in {{1}}. / Nobody to send to: the segment has no contacts who accept messages. / Pick a time in the future.',
        403: 'Supervisors, admins and owners send broadcasts.',
        404: 'That segment no longer exists.',
      },
    },
  },
  '/api/broadcasts/{id}': {
    get: { id: 'getBroadcast', summary: 'One broadcast, with recipients and failures', ok: 'BroadcastDetail', errors: { 404: 'That broadcast no longer exists.' } },
  },
  '/api/broadcasts/{id}/cancel': {
    post: {
      id: 'cancelBroadcast',
      summary: 'Cancel a broadcast',
      description: 'Messages not sent yet are skipped.',
      who: 'broadcasts.send',
      ok: 'BroadcastDetail',
      errors: { 400: 'Only scheduled or sending broadcasts can be cancelled.', 403: 'Supervisors, admins and owners send broadcasts.' },
    },
  },
})
