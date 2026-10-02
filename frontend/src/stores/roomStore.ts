import { DEFAULT_SETTINGS, type RoomMeta, type RoomSettings, type RoomState } from '../types/room'
import type { ConnectionStatus } from '../types/room'
import { createStore } from './createStore'

export interface RoomStoreState {
  room: RoomState | null
  /** Última stateVersion aplicada. */
  version: number
  connection: ConnectionStatus
  /** Erro de sala (não existe, senha inválida...). */
  fatalError: string | null
  /** uid do usuário atual (Firebase). */
  participantId: string
  meta: RoomMeta | null
  settings: RoomSettings
  /** Votos para pular a música atual. */
  votes: { itemId: string | null; voters: string[] }
  /** Pessoas bloqueadas pelo dono (uid → nome). */
  banned: Record<string, string>
  /** Motivo de saída forçada (removido, bloqueado, sala só para Discord). */
  removedReason: string | null
}

/** Votos necessários para pular: porcentagem das pessoas conectadas (mínimo 1). */
export function votesNeeded(s: RoomStoreState): number {
  const online = s.room?.participants.filter((p) => p.connected).length ?? 1
  return Math.max(1, Math.ceil((Math.max(1, online) * s.settings.voteSkipPercent) / 100))
}

/** Votos válidos (só de quem ainda está conectado). */
export function validVotes(s: RoomStoreState): string[] {
  const online = new Set(s.room?.participants.filter((p) => p.connected).map((p) => p.id) ?? [])
  return s.votes.itemId && s.votes.itemId === s.room?.currentTrack?.id ? s.votes.voters.filter((v) => online.has(v)) : []
}

export const selectIsOwner = (s: RoomStoreState) => !!s.meta?.ownerUid && s.meta.ownerUid === s.participantId

export const roomStore = createStore<RoomStoreState>({
  room: null,
  version: -1,
  connection: 'idle',
  fatalError: null,
  participantId: '',
  meta: null,
  settings: DEFAULT_SETTINGS,
  votes: { itemId: null, voters: [] },
  banned: {},
  removedReason: null,
})

/**
 * Aplica um estado recebido. Ignora versões antigas ou repetidas, exceto
 * STATE_SYNC completo (full=true), que sempre substitui.
 */
export function applyRoomState(room: RoomState, full = false): boolean {
  const { version } = roomStore.get()
  if (!full && room.stateVersion <= version) return false
  roomStore.set({ room, version: room.stateVersion })
  return true
}

export function resetRoomStore(): void {
  roomStore.set({
    room: null,
    version: -1,
    connection: 'idle',
    fatalError: null,
    meta: null,
    settings: DEFAULT_SETTINGS,
    votes: { itemId: null, voters: [] },
    banned: {},
    removedReason: null,
  })
}
