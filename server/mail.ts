// Account emails, sent through Gmail SMTP as SMTP_USER (an App password in SMTP_PASS; helo.ai is on
// Google Workspace). Without SMTP_PASS the email is printed to the server log instead, so local work
// and tests never depend on Gmail and a link is never lost.
import { readFileSync } from 'node:fs'
import nodemailer from 'nodemailer'
import { env } from './upstream.ts'

const user = env('SMTP_USER') || 'soumik.choudhury@helo.ai'
const pass = env('SMTP_PASS').replace(/\s+/g, '')
export const appUrl = (env('APP_URL') || 'http://localhost:5175').replace(/\/+$/, '')
const transport = pass ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } }) : null
// Gmail and Outlook don't show SVG images, so emails carry a PNG of the official logo, inline.
const logo = readFileSync(new URL('./assets/helo-logo.png', import.meta.url))

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** One layout for every email: logo, heading, body, optional button, small print. */
function layout(o: { heading: string; lines: string[]; button?: { label: string; url: string }; note?: string }) {
  const button = o.button
    ? `<p style="margin:28px 0"><a href="${esc(o.button.url)}" style="background:#3186DF;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(o.button.label)}</a></p>
       <p style="color:#676E73;font-size:13px;margin:0 0 4px">Or paste this link into your browser:</p>
       <p style="font-size:13px;word-break:break-all;margin:0"><a href="${esc(o.button.url)}" style="color:#3186DF">${esc(o.button.url)}</a></p>`
    : ''
  const html = `<!doctype html><html><body style="margin:0;background:#F2F3F3;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#14181B">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border:1px solid #CED1D3;border-radius:8px;padding:32px">
      <img src="cid:helo-logo" alt="Helo.ai" width="120" height="60" style="display:block;margin-bottom:24px">
      <h1 style="font-size:20px;margin:0 0 16px">${esc(o.heading)}</h1>
      ${o.lines.map((l) => `<p style="font-size:15px;line-height:22px;margin:0 0 12px">${esc(l)}</p>`).join('')}
      ${button}
      ${o.note ? `<p style="color:#676E73;font-size:13px;margin:24px 0 0">${esc(o.note)}</p>` : ''}
    </div>
    <p style="color:#676E73;font-size:12px;text-align:center;margin:16px 0 0">Helo.ai · Meta Business Agent console</p>
  </div></body></html>`
  const text = [o.heading, '', ...o.lines, ...(o.button ? ['', `${o.button.label}: ${o.button.url}`] : []), ...(o.note ? ['', o.note] : [])].join('\n')
  return { html, text }
}

async function send(to: string, subject: string, body: Parameters<typeof layout>[0]) {
  const { html, text } = layout(body)
  if (!transport) {
    console.log(`\n[mail → ${to}] ${subject}\n${text}\n`)
    return
  }
  await transport.sendMail({
    from: `"Helo.ai" <${user}>`,
    to,
    subject,
    text,
    html,
    attachments: [{ filename: 'helo-logo.png', content: logo, cid: 'helo-logo' }],
  })
}

const link = (token: string) => `${appUrl}/auth/verify?token=${encodeURIComponent(token)}`

export const mail = {
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
  roleChanged: (to: string, workspace: string, role: string) =>
    send(to, `Your role in ${workspace} is now ${role}`, {
      heading: `You’re now ${role === 'owner' ? 'an Owner' : 'a Member'} of ${workspace}`,
      lines: [role === 'owner' ? 'You can now invite people and manage members.' : 'You can still work on the agents, but can no longer invite people or manage members.'],
    }),
}
