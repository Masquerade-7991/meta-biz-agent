// server/auth.ts: sign-up, login, the signed-in account and the workspace's people.
import { area, d, o } from './helpers.ts'

const EMAIL = d('string', 'Up to 254 characters.', { format: 'email' })
const PASSWORD = d('string', '8 to 200 characters.', { minLength: 8, maxLength: 200 })
const NAME = d('string', 'Up to 80 characters.', { maxLength: 80 })
const ROLE = d('owner|admin|supervisor|agent', 'Owners can give any role; admins can’t make or change owners.')
const SETS_COOKIE = 'Sets the session cookie `sid` (HttpOnly, SameSite=Lax, 30 days; Secure on https).'
const JSON_ONLY = 'Auth routes refuse a body that isn’t JSON (415 “Send JSON.”).'

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
      errors: { 400: 'Your account is already set up. / Enter your name. / Use at least 8 characters for your password.' },
    },
  },
  '/api/account/new-password': {
    post: {
      id: 'setNewPassword',
      summary: 'Set a new password from a reset link',
      description: 'Also logs out every other device.',
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
      who: { text: 'Signed in with setup finished.' },
      body: o({ 'currentPassword*': 'string', 'newPassword*': PASSWORD }),
      errors: { 400: 'Your current password is incorrect.', 429: 'Too many attempts.' },
    },
  },
  '/api/account/email': {
    post: {
      id: 'changeEmail',
      summary: 'Change your email',
      description: 'Emails a confirmation link to the new address; the change happens when it’s opened (POST /api/auth/verify).',
      who: { text: 'Signed in with setup finished.' },
      body: o({ 'password*': 'string', 'newEmail*': EMAIL }),
      errors: { 400: 'Your current password is incorrect.', 409: 'Another account already uses that email.', 429: 'Too many attempts.' },
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
      description: 'Joins the workspace with the invited role and switches this session to it. Emails the inviter.',
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
  '/api/workspace/leave': {
    post: {
      id: 'leaveWorkspace',
      summary: 'Leave this workspace',
      description: 'Ends your membership of the session’s workspace and emails its owners. Your other workspaces are untouched; the session moves to the one you joined most recently.',
      ok: 'Me',
      errors: { 400: 'You’re the only owner. Make someone else an owner before you leave.' },
    },
  },
  '/api/workspace/members': {
    get: { id: 'listMembers', summary: 'People in the workspace', description: 'Members, plus pending invites for those who manage members.', ok: 'Members' },
  },
  '/api/workspace/invites': {
    post: {
      id: 'invite',
      summary: 'Invite someone',
      description: 'Emails an invite link (valid 7 days). Someone who already has an account keeps their other workspaces and answers the invite in the app.',
      who: 'members.manage',
      body: o({ 'email*': EMAIL, role: { ...ROLE, default: 'agent' } }),
      errors: {
        403: 'Your role can’t invite someone as an owner.',
        409: 'Already in this workspace, or already invited.',
        429: 'Too many invites (50 an hour per workspace).',
      },
    },
  },
  '/api/workspace/invites/{id}': {
    delete: { id: 'revokeInvite', summary: 'Revoke an invite', who: 'members.manage', errors: { 404: 'This invite was already accepted, revoked or has expired.' } },
  },
  '/api/workspace/invites/{id}/resend': {
    post: { id: 'resendInvite', summary: 'Resend an invite', who: 'members.manage', errors: { 404: 'This invite was already accepted, revoked or has expired.', 429: 'Too many invites.' } },
  },
  '/api/workspace/members/{userId}': {
    put: {
      id: 'changeRole',
      summary: 'Change a member’s role',
      who: 'members.manage',
      body: o({ 'role*': ROLE }),
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
