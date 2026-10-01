import type { RoomState } from '../types/room'
import type { ConnectionStatus } from '../types/room'
import { createStore } from './createStore'

export interface RoomStoreState {
  room: RoomState | null
  /** Última stateVersion aplicada. */
  version: number
  connection: ConnectionStatus
  /** Erro de sala (não existe, senha inválida...). */
  fatalError: string | null
  participantId: string
}

export const roomStore = createStore<RoomStoreState>({
  room: null,
  version: -1,
  connection: 'idle',
  fatalError: null,
  participantId: '',
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
  roomStore.set({ room: null, version: -1, connection: 'idle', fatalError: null })
}
