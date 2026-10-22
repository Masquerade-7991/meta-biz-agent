// server/contacts.ts: contacts, custom fields, tags and segments.
import { area, d, o } from './helpers.ts'

const GONE = { 404: 'That contact no longer exists.' }
const UNMODIFIED = { 'If-Unmodified-Since': d('string', 'The `x-updated-at` you read. When someone saved after it, the answer is 409 “Changed by someone else”. Leave it out to save anyway.') }
const CHANGED_HEADERS = 'The answer carries `x-updated-at` (ISO) and `x-updated-by` (URL-encoded name) headers.'
const INPUT_ERRORS = {
  400: 'X isn’t a phone number with a country code (8 to 15 digits). / That email address doesn’t look right. / Birthday must be a date.',
}

export const contacts = area('Contacts', {
  '/api/contacts': {
    get: {
      id: 'listContacts',
      summary: 'List contacts',
      description: '5000 at most, each with whether it has an open ticket.',
      query: { q: d('string', 'Name, number or email.'), tag: 'string', segment: d('string', 'A segment id; only its contacts.') },
      ok: 'Contact[]',
      errors: { 404: 'That segment no longer exists.' },
    },
    post: {
      id: 'createContact',
      summary: 'Add a contact',
      body: { $ref: '#/components/schemas/ContactInput' },
      ok: 'Contact',
      errors: { ...INPUT_ERRORS, 409: '+919876543210 is already a contact.' },
    },
  },
  '/api/contacts/import': {
    post: {
      id: 'importContacts',
      summary: 'Import contacts',
      description:
        'The browser reads the CSV (src/app/contacts/csv.ts) and sends the rows as JSON, up to 10,000 (and 1 MB). Existing numbers are updated. Bad rows are skipped with a reason (the first 100 listed).',
      who: 'contacts.manage',
      body: o({
        'rows*': { type: 'array', maxItems: 10000, items: o({ 'phone*': 'string', name: 'string', email: 'string', tags: 'string[]', fields: 'object' }) },
        tags: d('string', 'Comma-separated tags added to every imported contact.'),
      }),
      ok: o({ 'added*': 'integer', 'updated*': 'integer', 'skipped*': { type: 'array', items: o({ row: 'integer', reason: 'string' }) }, 'skippedCount*': 'integer' }),
      errors: { 403: 'Supervisors, admins and owners import contacts.' },
    },
  },
  '/api/contacts/tags': {
    get: { id: 'listTags', summary: 'Tags in use', ok: { type: 'array', items: o({ 'tag*': 'string', 'count*': 'integer' }) } },
  },
  '/api/contacts/fields': {
    get: { id: 'listFields', summary: 'Custom contact fields', description: `\`key\` is also the CSV column a field imports from. ${CHANGED_HEADERS}`, ok: 'FieldDef[]' },
    put: {
      id: 'saveFields',
      summary: 'Replace the custom fields',
      description: `The whole list (30 at most, names up to 60 characters). A field without a key is new; its key is made from the label. A field left out is removed: its values are cleared from every contact and segments stop filtering on it; a segment with no other filter is deleted. A changed type or choices clears the values that no longer fit. ${CHANGED_HEADERS}`,
      who: 'settings.manage',
      headers: UNMODIFIED,
      body: o({ 'fields*': { type: 'array', maxItems: 30, items: o({ key: 'string', 'label*': 'string', type: 'text|number|date|select', options: 'string[]' }) } }),
      ok: 'FieldDef[]',
      errors: {
        400: 'Every field needs a name. / Keep it to 30 fields or fewer. / Keep field names to 60 characters. / Two fields would both be called “X”. / Add the choices for X, separated by commas.',
        403: 'Only owners and admins can change contact fields.',
        409: 'Changed by someone else: someone saved after the If-Unmodified-Since you sent.',
      },
    },
  },
  '/api/contacts/fields/usage': {
    get: {
      id: 'fieldUsage',
      summary: 'What removing a field would clear',
      query: { 'key*': d('string', 'The field’s key.') },
      ok: o({ 'contacts*': d('integer', 'Contacts with a value for it.'), 'segments*': { type: 'array', items: o({ 'id*': 'string', 'name*': 'string' }) } }),
      errors: { 404: 'That field no longer exists.' },
    },
  },
  '/api/contacts/segments': {
    get: { id: 'listSegments', summary: 'Saved segments', description: 'Each with how many contacts match now.', ok: 'Segment[]' },
    post: {
      id: 'createSegment',
      summary: 'Save a segment',
      who: 'contacts.manage',
      body: o({ 'name*': 'string', 'filter*': 'SegmentFilter' }),
      ok: 'Segment',
      errors: { 400: 'Give the segment a name.', 403: 'Supervisors, admins and owners manage segments.' },
    },
  },
  '/api/contacts/segments/{id}': {
    delete: { id: 'deleteSegment', summary: 'Delete a segment', who: 'contacts.manage', errors: { 403: 'Supervisors, admins and owners manage segments.' } },
  },
  '/api/contacts/{phone}': {
    get: { id: 'getContact', summary: 'One contact', ok: 'Contact', errors: GONE },
    put: { id: 'updateContact', summary: 'Edit a contact', body: { $ref: '#/components/schemas/ContactInput' }, ok: 'Contact', errors: { ...INPUT_ERRORS, ...GONE } },
    delete: {
      id: 'deleteContact',
      summary: 'Delete a contact',
      description: 'Also deletes their chat, messages and tickets.',
      who: 'contacts.manage',
      errors: { 403: 'Supervisors, admins and owners delete contacts.', ...GONE },
    },
  },
})
