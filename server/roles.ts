// Which part of the server this process is. One bundle, four roles, chosen with ROLE:
//   api      the routes (and the Meta relay)
//   ingress  Meta's webhooks: store, acknowledge, queue the processing
//   worker   the background work: jobs, collectors, escalation, webhook retries
//   stream   /api/stream, the live events
// `all` (the default: local dev, the e2e harness, Vercel) is every role in one process, which is
// how the server always ran. Health and readiness are served by every role for the host's checks.
import { env } from './upstream.ts'

export type Role = 'api' | 'ingress' | 'worker' | 'stream' | 'all'
const ROLES: Role[] = ['api', 'ingress', 'worker', 'stream', 'all']
export const ROLE: Role = (ROLES as string[]).includes(env('ROLE')) ? (env('ROLE') as Role) : 'all'
export const isRole = (r: Exclude<Role, 'all'>) => ROLE === 'all' || ROLE === r

/** Whether this role answers `pathname`; anything else is 404, so a misrouted request can't make
 *  the ingress do the API's job. */
export function serves(pathname: string): boolean {
  if (pathname === '/api/health' || pathname === '/api/ready') return true
  switch (ROLE) {
    case 'all':
    case 'api':
      return true
    case 'ingress':
      return pathname.startsWith('/api/webhooks/')
    case 'stream':
      return pathname === '/api/stream'
    case 'worker':
      return false
  }
}

/** Webhook processing goes through the job queue (a worker does it) instead of inline, when asked
 *  for or when this process is only the ingress. */
export const queueWebhooks = () => env('WEBHOOK_PROCESS') === 'job' || ROLE === 'ingress'
