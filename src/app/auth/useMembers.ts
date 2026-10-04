import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { authApi, type Member } from './api'

/** The workspace's people, for assign menus. If they can't be loaded (e.g. dummy mode), just you. */
export function useMembers(): Member[] {
  const { me } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  useEffect(() => {
    authApi.members().then(
      (r) => setMembers(r.members),
      () => me && setMembers([{ userId: me.user.id, name: me.user.name, email: me.user.email, role: me.role ?? 'owner', joinedAt: '' }]),
    )
  }, [me])
  return members
}
