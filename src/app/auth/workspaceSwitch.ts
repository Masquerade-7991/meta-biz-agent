import { toast } from 'sonner'
import { errorDetail } from '@/app/api/meta'
import { authApi, type Me } from './api'

/**
 * Every cache in the app (wizard state, lists, live events) belongs to one workspace, so moving to
 * another reloads the console from Home instead of patching each one.
 */
const reopen = () => window.location.assign('/')

export async function switchWorkspace(id: string) {
  try {
    await authApi.switchWorkspace(id)
    reopen()
  } catch (err) {
    toast.error('Couldn’t switch workspace', { description: errorDetail(err) })
  }
}

export async function answerInvite(id: string, accept: boolean): Promise<Me | null> {
  try {
    const me = accept ? await authApi.acceptInvite(id) : await authApi.declineInvite(id)
    if (accept) reopen()
    else toast.success('Invite declined')
    return me
  } catch (err) {
    toast.error(accept ? 'Couldn’t join the workspace' : 'Couldn’t decline the invite', { description: errorDetail(err) })
    return null
  }
}

export async function leaveWorkspace() {
  try {
    await authApi.leaveWorkspace()
    reopen()
  } catch (err) {
    toast.error('Couldn’t leave the workspace', { description: errorDetail(err) })
  }
}

export async function createWorkspace(name: string) {
  await authApi.createWorkspace(name)
  reopen()
}
