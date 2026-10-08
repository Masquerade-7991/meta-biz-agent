// server/inbox.ts, followups.ts, media.ts: chats, replies, who's handling them, canned responses.
import { area, d, o, type Op } from './helpers.ts'

const CHAT = 'ChatDetail'
const WINDOW = 'WhatsApp allows free-form replies only within 24 hours of the customer’s last message; outside it this answers 400 “WhatsApp only allows free replies within 24 hours of the customer’s last message. Send a template instead.”'
const SCOPE =
  'When the workspace restricts agents (Support settings → restrictAgents), an agent can only open chats assigned to them or unassigned (403 “This chat is assigned to someone else.”).'
const NOT_FOUND = { 404: 'No chat with this number yet.' }

/** One action on a chat; answers the whole chat afterwards unless it says otherwise. */
const action = (id: string, summary: string, extra: Partial<Op> = {}): { post: Op } => ({
  post: { id, summary, ok: CHAT, okDescription: 'The chat, updated.', ...extra, errors: { ...NOT_FOUND, ...extra.errors } },
})

export const inbox = area('Inbox', {
  '/api/inbox/conversations': {
    get: {
      id: 'listChats',
      summary: 'List chats',
      description: `Newest first, 500 at most. ${SCOPE}`,
      query: { filter: d('all|mine|unassigned|ai|snoozed', '`ai`: the AI agent is answering. Default `all`.'), q: d('string', 'Name or number.') },
      ok: 'ChatSummary[]',
    },
  },
  '/api/inbox/conversations/{phone}': {
    get: { id: 'getChat', summary: 'Open a chat', description: SCOPE, ok: CHAT, errors: { ...NOT_FOUND, 403: 'This chat is assigned to someone else.' } },
  },
  '/api/inbox/conversations/{phone}/messages': action('reply', 'Send a text reply', {
    description: `Sends on WhatsApp (sample chats: stored only). ${WINDOW} Sending also takes the chat over from the AI agent.`,
    body: o({ 'text*': d('string', 'Up to 4096 characters.', { maxLength: 4096 }) }),
    errors: { 400: 'Write a reply first. / A reply is too long (max 4096 characters). / Outside the 24-hour window.', 502: 'WhatsApp didn’t accept it.' },
  }),
  '/api/inbox/conversations/{phone}/media': action('sendMedia', 'Send a photo, video, audio or document', {
    description: `The request body is the raw file (not multipart). ${WINDOW} Limits: images (JPG, PNG) 5 MB; video (MP4, 3GP) and audio (AAC, AMR, MP3, M4A, OGG) 16 MB; documents 100 MB (src/app/inbox/media.ts). On Vercel requests are capped at about 4.5 MB.`,
    bodyType: 'application/octet-stream',
    body: { type: 'string', format: 'binary', description: 'The file; send its real MIME type as Content-Type.' },
    headers: { 'x-filename': d('string', 'File name, URL-encoded.'), 'x-caption': d('string', 'Caption, URL-encoded.') },
    errors: { 400: 'The file’s type or size isn’t allowed (the message names the limit). / Outside the 24-hour window.', 413: 'That file is too big for WhatsApp.', 502: 'WhatsApp didn’t accept it.' },
  }),
  '/api/inbox/conversations/{phone}/interactive': action('sendInteractive', 'Send reply buttons or a list', {
    description: `${WINDOW} Limits: message 1024 characters; up to 3 buttons of 20; list button 20; up to 10 rows, title 24, description 72.`,
    body: {
      oneOf: [
        o({ 'type*': 'button', 'body*': 'string', 'buttons*': 'string[]' }),
        o({ 'type*': 'list', 'body*': 'string', 'button*': 'string', 'rows*': { type: 'array', items: o({ 'title*': 'string', description: 'string' }) } }),
      ],
    },
    errors: { 400: 'The message is too long (max 1024 characters). / Outside the 24-hour window.' },
  }),
  '/api/inbox/conversations/{phone}/notes': action('addNote', 'Add an internal note', {
    description: 'Visible to the team only; never sent.',
    body: o({ 'text*': 'string' }),
    errors: { 400: 'Write a note first.' },
  }),
  '/api/inbox/conversations/{phone}/assign': action('assignChat', 'Assign the chat', {
    description: 'Without `tickets.reassign` (supervisor+) you can only take unassigned chats or release your own.',
    body: o({ 'userId*': d('string?', 'A member’s user id, or null to unassign.') }),
    errors: { 403: 'Only supervisors, admins and owners move work between people.', 400: 'That person isn’t in this workspace.' },
  }),
  '/api/inbox/conversations/{phone}/control': action('setControl', 'Take over from the AI agent, or hand back', {
    description: 'Moves thread control on WhatsApp between the AI agent and your team (Meta’s thread control API).',
    body: o({ 'action*': 'take|release' }),
    errors: { 400: 'Action must be take or release. / Meta refused the change.' },
  }),
  '/api/inbox/conversations/{phone}/read': action('markRead', 'Mark as read'),
  '/api/inbox/conversations/{phone}/snooze': action('snoozeChat', 'Snooze until later', {
    description: 'Hidden from the list until then, or until the customer writes.',
    body: o({ 'until*': d('date-time?', 'Within the next 60 days; null to wake it now.') }),
    errors: { 400: 'Pick a time in the future. / Pick a time within the next 60 days.' },
  }),
  '/api/inbox/conversations/{phone}/remind': action('remindMe', 'Remind me about this chat', {
    body: o({ 'at*': 'date-time', note: d('string', 'Up to 300 characters.', { maxLength: 300 }) }),
    errors: { 400: 'Pick a time in the future.' },
  }),
  '/api/inbox/conversations/{phone}/block': action('blockCustomer', 'Block the customer', {
    who: 'numbers.edit',
    description: 'Blocks them on WhatsApp for the workspace’s default number (sample chats: only here).',
    errors: { 403: 'Owners and admins block customers.', 400: 'WhatsApp refused (e.g. 131047, 139101).' },
  }),
  '/api/inbox/conversations/{phone}/unblock': action('unblockCustomer', 'Unblock the customer', { who: 'numbers.edit', errors: { 403: 'Owners and admins block customers.' } }),
  '/api/inbox/conversations/{phone}/presence': action('setPresence', 'I’m viewing / typing', {
    description: 'Collision detection: others see who has the chat open and who is typing (expires after 20 seconds).',
    body: o({ typing: 'boolean' }),
    ok: 'any',
    okDescription: '{ok: true}',
  }),
  '/api/inbox/conversations/{phone}/suggest': action('suggestReply', 'Suggest a reply (AI)', {
    description: 'Asks the workspace’s Meta agent for a reply to the customer’s last message; nothing is sent.',
    ok: o({ 'text*': 'string' }),
    okDescription: 'The suggested reply.',
    errors: { 400: 'There’s no customer text to answer yet. It arrives once WhatsApp webhooks are connected.', 502: 'The AI agent couldn’t suggest a reply this time. Try again.' },
  }),
  '/api/inbox/conversations/{phone}/summary': action('summarizeChat', 'Summarise the chat (AI)', {
    description: 'Needs ANTHROPIC_API_KEY on the server.',
    ok: o({ 'text*': 'string' }),
    okDescription: 'The summary.',
    errors: { 400: 'Summaries need an Anthropic API key in the server settings (ANTHROPIC_API_KEY).', 502: 'Couldn’t write a summary right now. Try again.' },
  }),
  '/api/inbox/conversations/{phone}/transcript': {
    get: {
      id: 'chatTranscript',
      summary: 'Download a chat’s transcript',
      description:
        'The whole conversation in order, with who said what: the customer, the AI agent, a teammate, or someone outside this console (another app or the WhatsApp Business app). Kept for good. `format=txt` downloads it as a text file. ' +
        SCOPE,
      query: { format: d('json|txt', 'Default json.'), from: d('string', 'ISO time or milliseconds.'), to: 'string' },
      ok: o({
        'phone*': 'string',
        'name*': 'string?',
        'from*': 'date-time?',
        'to*': 'date-time?',
        'messages*': {
          type: 'array',
          items: o({ 'at*': 'date-time', 'from*': 'string', 'author*': 'customer|ai|agent|system', 'kind*': 'string', 'text*': 'string', media: 'object', status: 'string', waMessageId: 'string', tools: 'string[]' }),
        },
      }),
      errors: { ...NOT_FOUND, 400: 'from must be a date.' },
    },
  },
  '/api/inbox/media/{id}': {
    get: {
      id: 'downloadMedia',
      summary: 'Download an attachment',
      description: 'The file itself, with its type and size; cached privately for a day. Add `?download` to save it instead of opening it.',
      query: { download: d('string', 'Present: send as an attachment.') },
      ok: { type: 'string', format: 'binary' },
      okType: '*/*',
      errors: { 404: 'No such file.' },
    },
  },
  '/api/inbox/search': {
    get: {
      id: 'searchMessages',
      summary: 'Search message text',
      query: { q: d('string', 'At least 2 characters (else an empty list).') },
      ok: 'SearchHit[]',
      okDescription: 'Up to 30 hits.',
    },
  },
  '/api/inbox/views': {
    get: { id: 'listViews', summary: 'Your saved views', ok: 'SavedView[]' },
    post: {
      id: 'saveView',
      summary: 'Save a view',
      body: o({ 'name*': d('string', 'Up to 40 characters.', { maxLength: 40 }), filter: 'all|mine|unassigned|ai|snoozed', q: d('string', 'Up to 100 characters.') }),
      ok: 'SavedView[]',
      errors: { 400: 'Name the view. / You can keep 20 views. Delete one first.' },
    },
  },
  '/api/inbox/views/{id}': {
    delete: { id: 'deleteView', summary: 'Delete a saved view', ok: 'SavedView[]' },
  },
  '/api/inbox/canned': {
    get: { id: 'listCanned', summary: 'Canned responses', description: 'Shared ones plus your own.', ok: 'CannedResponse[]' },
    post: {
      id: 'createCanned',
      summary: 'Add a canned response',
      description: '`shared: true` only takes effect with `settings.manage` (admin+).',
      body: o({
        'title*': d('string', 'Up to 80 characters.'),
        'shortcut*': d('string', 'Typed after “/”: lowercase letters, numbers, - and _, up to 40.', { pattern: '^[a-z0-9_-]{1,40}$' }),
        'body*': 'string',
        shared: 'boolean',
      }),
      ok: 'CannedResponse',
      errors: { 400: 'Shortcuts use letters, numbers, - and _ only, like /refund.', 409: '/refund is already used by “Refund policy”.' },
    },
  },
  '/api/inbox/canned/{id}': {
    put: {
      id: 'updateCanned',
      summary: 'Edit a canned response',
      description: 'Editing a shared response needs `settings.manage`.',
      body: o({ 'title*': 'string', 'shortcut*': 'string', 'body*': 'string', shared: 'boolean' }),
      ok: 'CannedResponse',
      errors: { 404: 'That response no longer exists.' },
    },
    delete: {
      id: 'deleteCanned',
      summary: 'Delete a canned response',
      description: 'Your own, or a shared one with `settings.manage`.',
      errors: { 404: 'That response no longer exists.' },
    },
  },
  '/api/inbox/demo': {
    post: { id: 'seedSampleChats', summary: 'Add sample chats', description: 'Sample data is stored but never sent to WhatsApp.' },
    delete: { id: 'clearSampleChats', summary: 'Remove sample chats' },
  },
  '/api/inbox/demo/simulate': {
    post: {
      id: 'simulateCustomerMessage',
      summary: 'Pretend a customer wrote',
      description: 'Runs a made-up customer message through the real webhook processor, so the whole flow can be tried while Meta still sends this number’s webhooks elsewhere.',
      body: o({ phone: d('string', 'Defaults to the first sample chat.'), 'text*': 'string', name: 'string' }),
    },
  },
})
