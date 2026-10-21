// server/messaging/templates.ts: WhatsApp message templates, and sending one into a chat.
import { area, d, o } from './helpers.ts'

const TEMPLATE_REF = o({ 'name*': 'string', 'language*': d('string', 'e.g. en_US.') })
const SAMPLE = 'Sample contacts and chats are stored but never sent to WhatsApp.'

export const templates = area('Templates', {
  '/api/templates': {
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
  '/api/templates/{name}': {
    delete: {
      id: 'deleteTemplate',
      summary: 'Delete a template',
      description: 'Deletes every language of it on WhatsApp.',
      who: 'templates.delete',
      params: { name: d('string', 'Template name.', { pattern: '^[a-z0-9_]+$' }) },
      errors: { 403: 'Only owners and admins can delete templates.' },
    },
  },
  '/api/templates/send-one': {
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
})
