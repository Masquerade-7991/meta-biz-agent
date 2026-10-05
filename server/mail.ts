// Account emails, sent through Gmail SMTP as SMTP_USER (an App password in SMTP_PASS; helo.ai is on
// Google Workspace). Without SMTP_PASS the email is printed to the server log instead, so local work
// and tests never depend on Gmail and a link is never lost.
import { readFileSync } from 'node:fs'
import nodemailer from 'nodemailer'
import { env } from './upstream.ts'
import { ROLES, roleLabel, type Role } from '../src/app/lib/permissions.ts'
import { HttpError } from './http.ts'

const user = env('SMTP_USER') || 'soumik.choudhury@helo.ai'
const pass = env('SMTP_PASS').replace(/\s+/g, '')
export const appUrl = (env('APP_URL') || 'http://localhost:5175').replace(/\/+$/, '')
const transport = pass ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } }) : null
// Gmail and Outlook don't show SVG images, so emails carry PNGs of the official logo and partner badge, inline.
const logo = readFileSync(new URL('./assets/helo-logo.png', import.meta.url))
const badge = readFileSync(new URL('./assets/meta-partner.png', import.meta.url))

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
// Helo.ai brand (helo.ai site and logo): red buttons, ink text, blush accents on a light grey page.
const RED = '#ED1C24'
const TAGLINE = 'Helo.ai · Conversations personalised for billions with AI'

/** One layout for every email: red brand band, logo, heading, body, optional button, note, partner footer. */
function layout(o: { heading: string; lines: string[]; button?: { label: string; url: string }; note?: string }) {
  const button = o.button
    ? `<p style="margin:28px 0"><a href="${esc(o.button.url)}" style="background:${RED};color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;display:inline-block">${esc(o.button.label)}</a></p>
       <p style="color:#676E73;font-size:13px;margin:0 0 4px">Or paste this link into your browser:</p>
       <p style="font-size:13px;word-break:break-all;margin:0"><a href="${esc(o.button.url)}" style="color:${RED}">${esc(o.button.url)}</a></p>`
    : ''
  const html = `<!doctype html><html><body style="margin:0;background:#F7F7F8;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#14181B">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #ECE7E6;border-top:4px solid ${RED};border-radius:12px;padding:32px">
      <img src="cid:helo-logo" alt="Helo.ai" width="120" height="60" style="display:block;margin-bottom:24px">
      <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.01em;margin:0 0 16px">${esc(o.heading)}</h1>
      ${o.lines.map((l) => `<p style="font-size:15px;line-height:22px;margin:0 0 12px">${esc(l)}</p>`).join('')}
      ${button}
      ${o.note ? `<p style="background:#FDF3F1;color:#676E73;font-size:13px;line-height:19px;border-radius:8px;padding:12px 14px;margin:24px 0 0">${esc(o.note)}</p>` : ''}
    </div>
    <div style="text-align:center;margin:24px 0 0">
      <img src="cid:meta-partner" alt="Meta Partner" width="145" height="32" style="display:inline-block">
      <p style="color:#676E73;font-size:12px;margin:12px 0 4px">${TAGLINE}</p>
      <a href="https://www.helo.ai" style="color:#676E73;font-size:12px">www.helo.ai</a>
    </div>
  </div></body></html>`
  const text = [o.heading, '', ...o.lines, ...(o.button ? ['', `${o.button.label}: ${o.button.url}`] : []), ...(o.note ? ['', o.note] : []), '', '—', TAGLINE, 'https://www.helo.ai'].join('\n')
  return { html, text }
}

async function send(to: string, subject: string, body: Parameters<typeof layout>[0]) {
  const { html, text } = layout(body)
  if (!transport) {
    console.log(`\n[mail → ${to}] ${subject}\n${text}\n`)
    return
  }
  try {
    await transport.sendMail({
      from: `"Helo.ai" <${user}>`,
      to,
      subject,
      text,
      html,
      attachments: [
        { filename: 'helo-logo.png', content: logo, cid: 'helo-logo' },
        { filename: 'meta-partner.png', content: badge, cid: 'meta-partner' },
      ],
    })
  } catch (err) {
    // Say why in the app: a policy refusal (550 5.7.1, e.g. the Google Workspace blocks outside addresses) won't pass on a retry.
    console.log(`[mail → ${to}] failed: ${err instanceof Error ? err.message : err}`)
    const refused = (err as { responseCode?: number }).responseCode === 550
    throw new HttpError(
      502,
      refused
        ? `Gmail refused to deliver the email to ${to}. The sending Google Workspace account isn’t allowed to email this address; ask its admin to allow it.`
        : 'The email couldn’t be sent. Check the address and try again.',
    )
  }
}

const link = (token: string) => `${appUrl}/auth/verify?token=${encodeURIComponent(token)}`

export const mail = {
  /** A workspace alert for owners (budget, number quality, template paused). `path` opens the app there. */
  alert: (to: string, title: string, detail: string, action?: { label: string; path: string }) =>
    send(to, title, { heading: title, lines: [detail], ...(action && { button: { label: action.label, url: `${appUrl}${action.path}` } }) }),
  signup: (to: string, token: string) =>
    send(to, 'Verify your email for Helo.ai', {
      heading: 'Verify your email',
      lines: ['Click the button below to confirm this is your email. You’ll then finish setting up your account in Helo.ai.'],
      button: { label: 'Verify my email', url: link(token) },
      note: 'This link expires in 30 minutes and works once. If you didn’t ask for it, ignore this email.',
    }),
  invite: (to: string, token: string, inviter: string, workspace: string) =>
    send(to, `${inviter} invited you to ${workspace} on Helo.ai`, {
      heading: `Join ${workspace} on Helo.ai`,
      lines: [`${inviter} invited you to work on Meta Business Agents in the ${workspace} workspace. Click below to verify your email, then finish joining in Helo.ai.`],
      button: { label: 'Accept invite', url: link(token) },
      note: 'This invite expires in 7 days and works once.',
    }),
  reset: (to: string, token: string) =>
    send(to, 'Reset your Helo.ai password', {
      heading: 'Reset your password',
      lines: ['Click the button below to verify it’s you. You’ll then choose a new password in Helo.ai.'],
      button: { label: 'Reset my password', url: link(token) },
      note: 'This link expires in 30 minutes and works once. If you didn’t ask for it, your password hasn’t changed and you can ignore this email.',
    }),
  emailChange: (to: string, token: string) =>
    send(to, 'Confirm your new Helo.ai email', {
      heading: 'Confirm your new email',
      lines: ['Click the button below to start using this address to log in to Helo.ai.'],
      button: { label: 'Confirm this email', url: link(token) },
      note: 'This link expires in 30 minutes and works once. If you didn’t ask for it, ignore this email.',
    }),
  welcome: (to: string, name: string, workspace: string) =>
    send(to, 'Your Helo.ai account is ready', {
      heading: `Welcome, ${name}`,
      lines: [`Your account is ready and you’re in the ${workspace} workspace.`, `Log in any time with ${to} and your password.`],
      button: { label: 'Open Helo.ai', url: appUrl },
    }),
  memberJoined: (to: string, member: string, workspace: string) =>
    send(to, `${member} joined ${workspace}`, { heading: `${member} joined ${workspace}`, lines: [`${member} accepted your invite and can now work on your agents.`] }),
  passwordChanged: (to: string) =>
    send(to, 'Your Helo.ai password was changed', {
      heading: 'Your password was changed',
      lines: ['The password for your Helo.ai account was just changed, and other devices were logged out.'],
      note: 'If this wasn’t you, reset your password from the login page right away.',
    }),
  emailChanged: (to: string, newEmail: string) =>
    send(to, 'Your Helo.ai email was changed', {
      heading: 'Your login email was changed',
      lines: [`Your Helo.ai account now logs in with ${newEmail}. This address will no longer work.`],
      note: 'If this wasn’t you, contact your workspace owner right away.',
    }),
  removed: (to: string, workspace: string) =>
    send(to, `You were removed from ${workspace}`, {
      heading: `You were removed from ${workspace}`,
      lines: [`An owner removed you from the ${workspace} workspace. Your Helo.ai account still exists, and you can create your own workspace when you next log in.`],
    }),
  roleChanged: (to: string, workspace: string, role: Role) =>
    send(to, `Your role in ${workspace} is now ${roleLabel(role)}`, {
      heading: `You’re now ${role === 'owner' || role === 'admin' || role === 'agent' ? 'an' : 'a'} ${roleLabel(role)} of ${workspace}`,
      lines: [ROLES.find((r) => r.id === role)?.description ?? ''],
    }),
}
