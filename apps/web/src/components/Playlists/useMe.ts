import { authStore } from '../../services/discordAuth'
import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'

/** Nome e avatar de quem está na sala (Discord ou convidado). */
export function useMe() {
  const profile = useStore(authStore, (s) => s.profile)
  const myName = useStore(roomStore, (s) => s.room?.participants.find((p) => p.id === s.participantId)?.name ?? '')
  return { name: profile?.name || myName || 'Alguém', avatar: profile?.avatarUrl ?? null }
}
