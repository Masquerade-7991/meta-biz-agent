// Home's setup guide, in the order a new workspace does things. Each step is done from live data
// (never from a click); the current one is the first required step not done yet, and every
// required step after it waits for the one before. Inviting the team is optional: it never locks
// and never holds back "all done".

export type SetupStepId = 'connect' | 'account' | 'build' | 'test' | 'live' | 'invite'

export interface SetupSignals {
  connected: boolean
  billed: boolean
  built: boolean
  tested: boolean
  live: boolean
  invited: boolean
  /** Whether the invite step is shown at all (members.manage). */
  canInvite: boolean
}

export interface SetupStep {
  id: SetupStepId
  /** 1-based, as shown. */
  n: number
  done: boolean
  current: boolean
  optional: boolean
  /** The step this one waits for (its number), when it can't be started yet. */
  unlocksAfter: number | null
}

const ORDER: [SetupStepId, keyof SetupSignals][] = [
  ['connect', 'connected'],
  ['account', 'billed'],
  ['build', 'built'],
  ['test', 'tested'],
  ['live', 'live'],
  ['invite', 'invited'],
]

export function setupSteps(s: SetupSignals) {
  const rows = ORDER.filter(([id]) => id !== 'invite' || s.canInvite)
  const current = rows.findIndex(([id, key]) => id !== 'invite' && !s[key])
  const steps: SetupStep[] = rows.map(([id, key], i) => {
    const optional = id === 'invite'
    const done = !!s[key]
    return { id, n: i + 1, done, current: i === current, optional, unlocksAfter: !done && !optional && current >= 0 && i > current ? i : null }
  })
  return { steps, done: steps.filter((x) => x.done).length, total: steps.length, allDone: current < 0 }
}
