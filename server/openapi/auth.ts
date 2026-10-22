// server/auth.ts: sign-up, login, the signed-in account and the workspace's people.
import { area, d, o } from './helpers.ts'

const EMAIL = d('string', 'Up to 254 characters.', { format: 'email' })
const PASSWORD = d('string', '8 to 200 characters.', { minLength: 8, maxLength: 200 })
const NAME = d('string', 'Up to 80 characters.', { maxLength: 80 })
const ROLE = d('owner|admin|supervisor|agent', 'Owners can give any role; admins can’t make or change owners.')
const SETS_COOKIE = 'Sets the session cookie `sid` (HttpOnly, SameSite=Lax, 30 days; Secure on https).'
const JSON_ONLY = 'Auth routes refuse a body that isn’t JSON (415 “Send JSON.”).'
const COOKIE_ONLY = 'Needs the session cookie: an API token gets 403.'
const SIGNED_IN = { text: 'Signed in with setup finished.' }

export const auth = area('Accounts & workspace', {
  '/api/auth/signup': {
    post: {
      id: 'signup',
      summary: 'Start sign-up',
      description: `Emails a sign-up link (valid 30 minutes). ${JSON_ONLY}`,
      who: 'public',
      body: o({ 'email*': EMAIL }),
      errors: {
        400: 'Enter a valid email address.',
        409: 'You already have an account. Log in instead.',
        429: 'Too many attempts (5 an hour per email, 20 per IP).',
        502: 'Email not sent.',
      },
    },
  },
  '/api/auth/verify': {
    post: {
      id: 'verifyLink',
      summary: 'Open an emailed link',
      description: `Redeems the token from a sign-up, invite, password-reset or email-change link. ${SETS_COOKIE} (not for an email change). An invite to someone who already has an account is not redeemed here: the answer carries \`invite\`, and the person accepts it signed in as that email (acceptInvite). No session is started for it.`,
      who: 'public',
      body: o({ 'token*': 'string' }),
      ok: o({
        'purpose*': 'signup|invite|reset|email_change',
        me: 'Me',
        email: d('string', 'The new address, for an email change.'),
        invite: d(o({ 'id*': 'string', 'email*': 'string', 'workspaceName*': 'string', 'inviterName*': 'string?', 'role*': ROLE, 'already*': 'boolean' }), 'An invite to an existing account, to accept or decline in the app.'),
      }),
      errors: { 410: 'This link has expired or was already used. / This workspace no longer exists.', 409: 'Already exists.' },
    },
  },
  '/api/auth/login': {
    post: {
      id: 'login',
      summary: 'Log in',
      description: `${SETS_COOKIE} ${JSON_ONLY}`,
      who: 'public',
      body: o({ 'email*': EMAIL, password: 'string' }),
      ok: 'Me',
      errors: { 401: 'Email or password is incorrect.', 429: 'Too many attempts (10 an hour per email and IP).' },
    },
  },
  '/api/auth/logout': {
    post: { id: 'logout', summary: 'Log out', description: 'Ends this session and clears the cookie.', who: 'public' },
  },
  '/api/auth/me': {
    get: { id: 'getMe', summary: 'Who am I', description: 'Works before setup is finished.', who: { text: 'Anyone signed in (setup may be unfinished).' }, ok: 'Me' },
  },
  '/api/auth/forgot': {
    post: {
      id: 'forgotPassword',
      summary: 'Email a password-reset link',
      description: 'Answers the same whether or not the account exists.',
      who: 'public',
      body: o({ 'email*': EMAIL }),
      errors: { 400: 'Enter a valid email address.', 429: 'Too many attempts.' },
    },
  },
  '/api/account/setup': {
    post: {
      id: 'finishSetup',
      summary: 'Finish setting up a new account',
      description: 'After the sign-up link: name, password, and a workspace name unless joining through an invite.',
      who: { text: 'Signed in, setup at the `account` step.' },
      body: o({ 'name*': NAME, 'password*': PASSWORD, workspaceName: d('string', 'Required unless joining a workspace through an invite.', { maxLength: 80 }) }),
      ok: 'Me',
      errors: {
        400: 'Your account is already set up. / Enter your name. / Use at least 8 characters for your password.',
        410: 'Your invite to X was withdrawn. Ask for a new one, or create your own workspace. (The invite was revoked or the sign-up cancelled; sending again with a workspaceName creates your own.)',
      },
    },
  },
  '/api/account/new-password': {
    post: {
      id: 'setNewPassword',
      summary: 'Set a new password from a reset link',
      description: 'Also logs out every other device and revokes every API token you have.',
      who: { text: 'Signed in from a reset link (setup at the `password` step).' },
      body: o({ 'password*': PASSWORD }),
      ok: 'Me',
      errors: { 400: 'Use Settings to change your password.' },
    },
  },
  '/api/account': {
    put: {
      id: 'updateAccount',
      summary: 'Change your name',
      description: 'Recorded in the activity log (the event, not the name).',
      who: { text: 'Signed in with setup finished.' },
      body: o({ 'name*': NAME }),
      ok: 'Me',
      errors: { 400: 'Enter your name.' },
    },
  },
  '/api/account/password': {
    post: {
      id: 'changePassword',
      summary: 'Change your password',
      description: 'Other devices log out and every API token you have stops working (`tokensRevoked` says how many). The confirmation email is best effort: a failed email never fails the change.',
      who: { text: 'Signed in with setup finished.' },
      body: o({ 'currentPassword*': 'string', 'newPassword*': PASSWORD }),
      ok: o({ 'ok*': { type: 'boolean', const: true }, 'tokensRevoked*': 'integer' }),
      errors: { 400: 'Your current password is incorrect.', 429: 'Too many attempts.' },
    },
  },
  '/api/account/email': {
    post: {
      id: 'changeEmail',
      summary: 'Change your email',
      description: 'Emails a confirmation link to the new address; the change happens when it’s opened (POST /api/auth/verify), which logs out your other devices. Until then `pendingEmail` on Me shows it; asking again replaces the earlier link.',
      who: { text: 'Signed in with setup finished.' },
      body: o({ 'password*': 'string', 'newEmail*': EMAIL }),
      errors: { 400: 'Your current password is incorrect.', 409: 'Another account already uses that email.', 429: 'Too many attempts.' },
    },
  },
  '/api/account/email/cancel': {
    post: { id: 'cancelEmailChange', summary: 'Withdraw a pending email change', description: 'The emailed link stops working.', who: SIGNED_IN, ok: 'Me' },
  },
  '/api/account/sessions': {
    get: {
      id: 'listSessions',
      summary: 'Your signed-in devices',
      description: `Every live session of yours, last used first. ${COOKIE_ONLY}`,
      who: SIGNED_IN,
      ok: o({ 'sessions*': 'Session[]' }),
    },
  },
  '/api/account/sessions/{sessionId}': {
    delete: {
      id: 'revokeSession',
      summary: 'Sign out one device',
      description: `Signing out the current session also clears its cookie (\`current: true\`). ${COOKIE_ONLY}`,
      who: SIGNED_IN,
      params: { sessionId: d('string', 'Session id.', { pattern: '^[a-f0-9]{24}$' }) },
      ok: o({ 'ok*': { type: 'boolean', const: true }, 'current*': 'boolean' }),
      errors: { 404: 'That device is already signed out.' },
    },
  },
  '/api/account/sessions/revoke-others': {
    post: { id: 'revokeOtherSessions', summary: 'Sign out everywhere else', description: `Every session but this one. ${COOKIE_ONLY}`, who: SIGNED_IN, ok: o({ 'revoked*': 'integer' }) },
  },
  '/api/account/notifications': {
    get: { id: 'getNotificationPrefs', summary: 'Your email notifications', description: `For the workspace this session works in. ${COOKIE_ONLY}`, ok: 'NotificationPrefs' },
    put: {
      id: 'setNotificationPrefs',
      summary: 'Change your email notifications',
      description: `Partial: keys left out keep their value. ${COOKIE_ONLY}`,
      body: o({ escalations: 'boolean', assigned: 'boolean', slaBreach: 'boolean', budget: 'boolean', digest: 'boolean' }),
      ok: 'NotificationPrefs',
      errors: { 400: 'escalations must be true or false.' },
    },
  },
  '/api/account/workspace': {
    post: {
      id: 'switchWorkspace',
      summary: 'Switch workspace',
      description: 'This session works in the given workspace from now on. Other sessions keep theirs.',
      who: { text: 'Signed in with setup finished, a member of that workspace.' },
      body: o({ 'workspaceId*': 'string' }),
      ok: 'Me',
      errors: { 404: 'You’re not a member of that workspace.' },
    },
  },
  '/api/account/invites/{id}/accept': {
    post: {
      id: 'acceptInvite',
      summary: 'Accept an invite',
      description: 'Joins the workspace with the invited role and switches this session to it. Emails the inviter. Accepting the same invite again (a double click) answers the same Me.',
      who: { text: 'Signed in with setup finished, as the invited email.' },
      ok: 'Me',
      errors: { 410: 'This invite was revoked, has expired or was already answered. / This workspace no longer exists.' },
    },
  },
  '/api/account/invites/{id}/decline': {
    post: {
      id: 'declineInvite',
      summary: 'Decline an invite',
      who: { text: 'Signed in with setup finished, as the invited email.' },
      ok: 'Me',
      errors: { 410: 'This invite was revoked, has expired or was already answered.' },
    },
  },
  '/api/workspace': {
    get: { id: 'getWorkspace', summary: 'This workspace', description: 'Its id and creation date (for support), and the owner named on it.', ok: 'Workspace' },
    put: {
      id: 'renameWorkspace',
      summary: 'Rename the workspace',
      who: { text: 'An owner of the workspace.' },
      body: o({ 'name*': NAME }),
      ok: 'Me',
      errors: { 400: 'Enter a workspace name.', 403: 'Only owners can rename the workspace.' },
    },
    post: {
      id: 'createWorkspace',
      summary: 'Create a workspace',
      description: 'You become its owner, and this session switches to it. You can belong to several workspaces.',
      who: { text: 'Signed in with setup finished.' },
      body: o({ 'name*': NAME }),
      ok: 'Me',
      errors: { 429: 'Too many workspaces created (5 an hour).' },
    },
  },
  '/api/workspace/transfer': {
    post: {
      id: 'transferOwnership',
      summary: 'Hand over the workspace',
      description: 'Makes another member an owner and the workspace’s named owner. `stepDown: true` also makes you an admin. Needs your password.',
      who: { text: 'An owner of the workspace.' },
      body: o({ 'userId*': d('string', 'The member to make owner.', { format: 'uuid' }), 'password*': 'string', stepDown: d('boolean', 'Become an admin afterwards.', { default: false }) }),
      ok: 'Me',
      errors: {
        400: 'Your password is incorrect. / Pick someone else to make owner.',
        403: 'Only owners can hand over the workspace.',
        404: 'This person isn’t in your workspace.',
        409: 'A workspace needs at least one owner. Someone else changed the owners at the same moment; try again.',
        429: 'Too many attempts.',
      },
    },
  },
  '/api/workspace/joining/{userId}': {
    delete: {
      id: 'cancelJoining',
      summary: 'Cancel someone’s sign-up',
      description: 'For a person who opened their invite and hasn’t finished setting up: they won’t join (finishing setup creates their own workspace instead).',
      who: 'members.manage',
      errors: { 403: 'Only owners can cancel someone joining as an owner.', 404: 'This person already finished joining or was cancelled.' },
    },
  },
  '/api/workspace/leave': {
    post: {
      id: 'leaveWorkspace',
      summary: 'Leave this workspace',
      description: 'Ends your membership of the session’s workspace and emails its owners. Your other workspaces are untouched; the session moves to the one you joined most recently.',
      ok: 'Me',
      errors: { 400: 'You’re the only owner. Make someone else an owner before you leave.' },
    },
  },
  '/api/account/tokens': {
    get: {
      id: 'listApiTokens',
      summary: 'Your API tokens',
      description: 'Your tokens in the workspace you’re working in. Never includes the token itself.',
      ok: 'ApiTokens',
    },
    post: {
      id: 'createApiToken',
      summary: 'Create an API token',
      description:
        'Returns the token once, in `token`: store it now. It acts as you, in this workspace, with your current role (`Authorization: Bearer hk_…`), and stops working if you leave the workspace. Needs the session cookie: an API token can’t create tokens.',
      body: o({ 'name*': d('string', 'Up to 60 characters, e.g. “CI” or “Docs try it”.', { maxLength: 60 }), expiresInDays: d({ type: 'integer', enum: [30, 90, 365, 0] }, '0: never expires.', { default: 90 }) }),
      ok: { allOf: [{ $ref: '#/components/schemas/ApiToken' }, o({ 'token*': d('string', 'The token. Shown only this once.') })] },
      errors: { 400: 'Enter a name for the token. / expiresInDays must be 30, 90, 365 or 0 (never).', 429: 'Too many tokens created (20 an hour).' },
    },
  },
  '/api/account/tokens/{tokenId}': {
    delete: {
      id: 'revokeApiToken',
      summary: 'Revoke one of your API tokens',
      description: 'It stops working at once. Needs the session cookie.',
      params: { tokenId: d('string', 'Token id.', { format: 'uuid' }) },
      errors: { 404: 'This token was already revoked or has expired.' },
    },
  },
  '/api/workspace/tokens': {
    get: { id: 'listWorkspaceApiTokens', summary: 'Everyone’s API tokens', description: 'Every token in the workspace, with whose it is.', who: 'tokens.manage', ok: 'ApiTokens' },
  },
  '/api/workspace/tokens/{tokenId}': {
    delete: {
      id: 'revokeWorkspaceApiToken',
      summary: 'Revoke someone’s API token',
      who: 'tokens.manage',
      params: { tokenId: d('string', 'Token id.', { format: 'uuid' }) },
      errors: { 404: 'This token was already revoked or has expired.' },
    },
  },
  '/api/workspace/members': {
    get: { id: 'listMembers', summary: 'People in the workspace', description: 'Members, plus pending invites for those who manage members.', ok: 'Members' },
  },
  '/api/workspace/invites': {
    post: {
      id: 'invite',
      summary: 'Invite someone',
      description: 'Emails an invite link (valid 7 days). Someone who already has an account keeps their other workspaces and answers the invite in the app. One live invite per person per workspace.',
      who: 'members.manage',
      body: o({ 'email*': EMAIL, role: { ...ROLE, default: 'agent' } }),
      errors: {
        400: 'Enter a valid email address. / Role must be owner, admin, supervisor or agent.',
        403: 'Your role can’t invite someone as an owner.',
        409: 'This person is already in this workspace. / This person is already invited. Resend the invite from the list. / This person is already joining.',
        429: 'Too many invites (50 an hour per workspace, 5 emails an hour per address).',
        502: 'Email not sent (the invite is withdrawn).',
      },
    },
  },
  '/api/workspace/invites/{id}': {
    delete: {
      id: 'revokeInvite',
      summary: 'Revoke an invite',
      description: 'Expired invites can be revoked too. Someone who already opened an earlier link and is still setting up won’t join either.',
      who: 'members.manage',
      errors: { 403: 'Your role can’t manage an invite as Owner.', 404: 'This invite was already accepted or revoked.' },
    },
  },
  '/api/workspace/invites/{id}/resend': {
    post: {
      id: 'resendInvite',
      summary: 'Resend an invite',
      description: 'Sends a new link (valid 7 days, expired invites too); the old link stops working. If the email fails, the old invite stays as it was.',
      who: 'members.manage',
      errors: { 403: 'Your role can’t manage an invite as Owner.', 404: 'This invite was already accepted or revoked.', 429: 'Too many emails sent to this address.', 502: 'Email not sent.' },
    },
  },
  '/api/workspace/members/{userId}': {
    put: {
      id: 'changeRole',
      summary: 'Change a member’s role',
      who: 'members.manage',
      body: o({ 'role*': ROLE }),
      description: 'The email to the person is best effort: a failed email never fails the change.',
      errors: { 400: 'Role must be owner, admin, supervisor or agent. / A workspace needs at least one owner.', 403: 'Only owners can change an owner.', 404: 'Not found.' },
    },
    delete: {
      id: 'removeMember',
      summary: 'Remove a member',
      who: 'members.manage',
      errors: { 400: 'You can’t remove yourself.', 403: 'Only owners can remove an owner.', 404: 'Not found.' },
    },
  },
})
