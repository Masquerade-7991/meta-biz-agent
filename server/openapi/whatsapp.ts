// server/whatsapp.ts (accounts, Embedded Signup), numbers.ts (each number's settings) and
// health.ts (quality, limits, webhook reachability).
import { area, d, o, type Op } from './helpers.ts'

const NOT_OURS = { 404: 'That number isn’t connected to this workspace.' }
const EDIT_DENIED = 'Your role can’t change WhatsApp numbers. Ask an owner or admin.'
const OWNER_DENIED = 'Only owners change a number’s PIN or registration.'
/** Every number route needs `numbers.view` first; these need more on top. */
const numberOp = (op: Op): Op => ({ ...op, ok: op.ok ?? 'NumberDetail', errors: { ...NOT_OURS, ...op.errors } })
const edit = (op: Op): Op => numberOp({ who: 'numbers.edit', ...op, errors: { 403: EDIT_DENIED, ...op.errors } })
const owner = (op: Op): Op => numberOp({ who: 'whatsapp.manage', ...op, errors: { 403: OWNER_DENIED, ...op.errors } })

const OWNER_ONLY = 'Only workspace owners can see or change webhook details.'
const WEBHOOK_STATUS = o({
  'lastAt*': 'date-time?',
  'callbackUrl*': 'string',
  'verifyTokenSet*': 'boolean',
  'signatureChecked*': 'boolean',
  appsAccepted: d('integer', 'Apps whose signatures are accepted (WEBHOOK_APP_SECRETS).'),
  last24h: { type: 'array', items: o({ field: 'string', count: 'integer' }) },
  pending: d('integer', 'Deliveries stored but not processed yet.'),
  failed: 'integer',
  sandboxNumbers: d('integer', 'Numbers on the account that are Meta test numbers (sandbox).'),
  unknownNumbers: d('integer', 'Deliveries this week for a number or account no workspace has.'),
  subscribedApps: d({ anyOf: [{ type: 'array', items: o({ id: 'string?', name: 'string?' }) }, { type: 'null' }] }, 'GET /{WABA}/subscribed_apps, read-only.'),
  listenerAppId: d('string?', 'This console’s own listening app (its Meta app id), to point it out in the list.'),
  baseline: d({ anyOf: [o({ apps: 'object[]', at: 'date-time' }), { type: 'null' }] }, 'The first list of subscribed apps seen.'),
})

export const whatsapp = area('WhatsApp', {
  '/api/whatsapp/config': {
    get: {
      id: 'signupConfig',
      summary: 'Is Embedded Signup available',
      description: 'What the browser needs to start Meta’s Embedded Signup, and which server settings are missing if not (META_APP_ID, META_ES_CONFIG_ID, META_APP_SECRET, TOKEN_ENCRYPTION_KEY).',
      ok: o({ 'ready*': 'boolean', 'missing*': 'string[]', 'appId*': 'string?', 'configId*': 'string?', 'sdkVersion*': 'string', 'partnerCredit*': d('boolean', 'Billing through Helo.ai is offered.') }),
    },
  },
  '/api/whatsapp/accounts': {
    get: { id: 'listWaAccounts', summary: 'Connected WhatsApp accounts', description: 'Never includes tokens or PINs.', ok: 'WaAccount[]' },
  },
  '/api/whatsapp/connect': {
    post: {
      id: 'connectWaAccount',
      summary: 'Finish Embedded Signup',
      description:
        'Takes the code from Meta’s signup popup, exchanges it for a token (stored encrypted), subscribes the app, registers the number (a new 6-digit PIN is made and returned once), sets billing and syncs details. Each step is recorded in `steps`.',
      who: 'whatsapp.manage',
      body: o({
        'code*': d('string', 'From the signup popup.'),
        'wabaId*': 'string',
        'phoneNumberId*': 'string',
        businessId: 'string',
        flow: d('new|coexistence', '`coexistence`: the number keeps using the WhatsApp Business app.'),
        billing: d('partner_credit|own', 'Pay through Helo.ai, or with your own card on Meta.'),
      }),
      ok: o({ 'account*': 'WaAccount', pin: d('string', 'The new PIN, shown once.') }),
      errors: {
        400: 'The signup didn’t return a WhatsApp account and number. Please run it again. / Meta didn’t accept the signup (…).',
        403: 'Only workspace owners can connect WhatsApp accounts.',
        409: 'This WhatsApp account is already connected to another workspace.',
        429: 'Too many signup attempts. Try again in an hour.',
        503: 'Embedded Signup isn’t set up on this server yet (missing META_APP_ID, …).',
      },
    },
  },
  '/api/whatsapp/accounts/{wabaId}': {
    delete: {
      id: 'disconnectWaAccount',
      summary: 'Disconnect an account',
      who: 'whatsapp.manage',
      errors: {
        400: 'This account is set up by Helo.ai on the server and can’t be disconnected here.',
        403: 'Only workspace owners can change WhatsApp accounts.',
        404: 'That WhatsApp account isn’t connected to this workspace.',
      },
    },
  },
  '/api/whatsapp/accounts/{wabaId}/retry': {
    post: { id: 'retryWaSignup', summary: 'Retry failed signup steps', who: 'whatsapp.manage', ok: 'WaAccount', errors: { 404: 'That WhatsApp account isn’t connected to this workspace.' } },
  },
  '/api/whatsapp/accounts/{wabaId}/billing': {
    post: {
      id: 'setWaBilling',
      summary: 'Choose who pays for messages',
      who: 'whatsapp.manage',
      body: o({ 'mode*': 'partner_credit|own', confirmed: d('boolean', 'For `own`: you’ve added a payment method in Meta’s Billing Hub.') }),
      ok: 'WaAccount',
      errors: { 400: 'Billing mode must be partner_credit or own. / Billing through Helo.ai isn’t available on this server.' },
    },
  },
  '/api/whatsapp/accounts/{wabaId}/pin': {
    get: { id: 'revealAccountPin', summary: 'Show the stored PIN', who: 'whatsapp.manage', ok: o({ 'pin*': 'string' }), errors: { 404: 'There’s no PIN stored for this number.' } },
  },

  '/api/whatsapp/health': {
    get: { id: 'numberHealth', summary: 'Quality, name status and messaging limits', description: 'Checks Meta the first time; then the daily check’s results.', ok: 'NumberHealth[]' },
    post: { id: 'checkNumberHealth', summary: 'Check with Meta now', ok: 'NumberHealth[]', errors: { 403: 'Connect a WhatsApp account first.' } },
  },
  '/api/whatsapp/webhook-status': {
    get: {
      id: 'webhookStatus',
      summary: 'Are Meta’s webhooks reaching us',
      who: 'whatsapp.manage',
      description:
        'The inbox gets customers’ words and media only through webhooks. Also lists, read-only, every app Meta sends this account’s events to, next to the list saved earlier, so the owner can check the business’s own apps are all still subscribed.',
      ok: WEBHOOK_STATUS,
      errors: { 403: OWNER_ONLY },
    },
  },
  '/api/whatsapp/webhook-status/baseline': {
    post: {
      id: 'markWebhookAppsExpected',
      summary: 'Mark the current list of apps as expected',
      who: 'whatsapp.manage',
      description: 'After an app was added or removed on purpose: the apps Meta lists now become the list the status compares against. Reads Meta; changes nothing there.',
      ok: WEBHOOK_STATUS,
      errors: { 403: OWNER_ONLY, 502: 'Couldn’t read the list from Meta right now. Try again.' },
    },
  },

  '/api/whatsapp/numbers': {
    get: {
      id: 'listNumbers',
      summary: 'Your WhatsApp numbers',
      who: 'numbers.view',
      query: { refresh: d('string', 'Present: sync with Meta first.') },
      ok: 'WaNumber[]',
    },
  },
  '/api/whatsapp/numbers/{numberId}': {
    get: numberOp({ id: 'getNumber', summary: 'One number: profile, ice breakers, activity', who: 'numbers.view' }),
  },
  '/api/whatsapp/numbers/{numberId}/photo': {
    post: edit({
      id: 'setNumberPhoto',
      summary: 'Change the profile photo',
      description: 'The request body is the image itself (JPG or PNG, 5 MB at most).',
      bodyType: 'image/jpeg',
      body: { type: 'string', format: 'binary' },
      errors: {
        400: 'Use a JPG or PNG image. / That file is empty.',
        413: 'Profile photos can be 5 MB at most.',
        502: 'WhatsApp didn’t take the photo (…). You can change it in WhatsApp Manager instead.',
      },
    }),
  },
  '/api/whatsapp/numbers/{numberId}/profile': {
    put: edit({ id: 'setNumberProfile', summary: 'Edit the business profile', description: 'Rules in src/app/whatsapp/profileRules.ts.', body: { $ref: '#/components/schemas/Profile' }, errors: { 400: 'The first problem found.' } }),
  },
  '/api/whatsapp/numbers/{numberId}/display-name': {
    post: edit({ id: 'requestDisplayName', summary: 'Request a new display name', description: 'Meta reviews it.', body: o({ 'name*': 'string' }), errors: { 400: 'The first problem found.' } }),
  },
  '/api/whatsapp/numbers/{numberId}/automation': {
    put: edit({ id: 'setIceBreakers', summary: 'Ice breakers and commands', body: { $ref: '#/components/schemas/Automation' }, errors: { 400: 'The first problem found.' } }),
  },
  '/api/whatsapp/numbers/{numberId}/blocked': {
    get: edit({ id: 'listBlocked', summary: 'Blocked customers', ok: { type: 'array', items: o({ 'user*': 'string' }) } }),
    post: edit({
      id: 'blockUser',
      summary: 'Block a customer',
      body: o({ 'user*': d('string', 'Their number with country code.') }),
      ok: 'any',
      okDescription: '{ok: true}',
      errors: {
        400: 'Enter the customer’s number with its country code. / WhatsApp only lets you block someone who messaged this number in the last 24 hours. / The block list is full (64,000 people). Unblock someone first.',
      },
    }),
  },
  '/api/whatsapp/numbers/{numberId}/blocked/{user}': {
    delete: edit({ id: 'unblockUser', summary: 'Unblock a customer', ok: 'any', okDescription: '{ok: true}' }),
  },
  '/api/whatsapp/numbers/{numberId}/request-code': {
    post: edit({
      id: 'requestVerificationCode',
      summary: 'Send a verification code',
      body: o({ method: 'SMS|VOICE', language: d('string', 'Default en.') }),
      ok: 'any',
      okDescription: '{ok: true}',
      errors: { 429: 'Too many codes asked for this number. Try again in an hour.' },
    }),
  },
  '/api/whatsapp/numbers/{numberId}/verify-code': {
    post: edit({ id: 'verifyCode', summary: 'Enter the verification code', body: o({ 'code*': 'string' }), errors: { 400: 'Enter the code WhatsApp sent you.' } }),
  },
  '/api/whatsapp/numbers/{numberId}/pin': {
    get: owner({ id: 'revealNumberPin', summary: 'Show the stored PIN', ok: o({ 'pin*': 'string' }), errors: { 404: 'We don’t have this number’s PIN. Set a new one below.' } }),
    post: owner({ id: 'setNumberPin', summary: 'Set a new two-step PIN', body: o({ 'pin*': d('string', '6 digits.', { pattern: String.raw`^\d{6}$` }) }), errors: { 400: 'The PIN is 6 digits.' } }),
  },
  '/api/whatsapp/numbers/{numberId}/register': {
    post: owner({ id: 'registerNumber', summary: 'Register the number with WhatsApp', body: o({ pin: d('string', 'Optional when a PIN is stored.') }), errors: { 400: 'Enter the number’s 6-digit PIN to register it.' } }),
  },
  '/api/whatsapp/numbers/{numberId}/deregister': {
    post: owner({
      id: 'deregisterNumber',
      summary: 'Deregister the number',
      description: 'It stops sending and receiving on the API.',
      body: o({ 'confirm*': d('string', 'The number as displayed, to confirm.') }),
      errors: { 400: 'Type the number exactly to confirm.' },
    }),
  },
})
