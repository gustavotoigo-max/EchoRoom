import type { SyncStatus, SyncUiState } from '../sync/SyncEngine'
import { createStore } from './createStore'

export interface PlayerStoreState {
  sync: SyncUiState
  /** Métricas técnicas (somente modo debug). */
  metrics: SyncStatus | null
  playerError: string | null
  playerReady: boolean
}

export const playerStore = createStore<PlayerStoreState>({
  sync: 'waiting',
  metrics: null,
  playerError: null,
  playerReady: false,
})
