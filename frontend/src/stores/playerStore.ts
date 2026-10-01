import type { SyncStatus, SyncUiState } from '../sync/SyncEngine'
import { storage } from '../utils/storage'
import { createStore } from './createStore'

export interface PlayerStoreState {
  sync: SyncUiState
  /** Métricas técnicas (somente modo debug). */
  metrics: SyncStatus | null
  playerError: string | null
  playerReady: boolean
  /** Volume local 0–100 e mudo (não sincronizados com a sala). */
  volume: number
  muted: boolean
  /** O navegador bloqueou o som até um clique na página. */
  needsGesture: boolean
}

export const playerStore = createStore<PlayerStoreState>({
  sync: 'waiting',
  metrics: null,
  playerError: null,
  playerReady: false,
  volume: typeof window !== 'undefined' ? storage.getVolume() : 80,
  muted: typeof window !== 'undefined' ? storage.getMuted() : false,
  needsGesture: false,
})
