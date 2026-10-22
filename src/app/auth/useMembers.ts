import { useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { authApi, type Member } from './api'
import { MembersContext } from './membersContext'

/** The workspace's people, for assign menus. If they can't be loaded (e.g. dummy mode), just you.
 *  Inside Settings they come from the area's one shared load. */
export function useMembers(): Member[] {
  const shared = useContext(MembersContext)
  const { me } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  useEffect(() => {
    if (shared) return
    authApi.members().then(
      (r) => setMembers(r.members),
      () => me && setMembers([{ userId: me.user.id, name: me.user.name, email: me.user.email, role: me.role ?? 'owner', joinedAt: '' }]),
    )
  }, [me, shared])
  return shared?.members ?? members
}
