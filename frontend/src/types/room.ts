// Tipos de domínio da sala. Tempos do servidor em SEGUNDOS (float).

export type PlaybackState = 'playing' | 'paused' | 'buffering' | 'stopped'

export interface QueueItem {
  id: string
  videoId: string
  title: string
  author: string
  thumbnail: string
  duration?: number | null
  addedBy: string
}

export interface Participant {
  id: string
  name: string
  connected: boolean
}

export interface RoomState {
  roomId: string
  currentTrack: QueueItem | null
  currentVideoId: string | null
  playbackState: PlaybackState
  /** Posição base da timeline (s). */
  position: number
  /** Timestamp do servidor quando esta foto do estado foi gerada (s). */
  serverTimestamp: number
  /** Instante (relógio do servidor) em que a reprodução partiu de `position`. */
  startedAt?: number | null
  /** Instante (relógio do servidor) em que o último comando passa a valer. */
  executeAt?: number | null
  stateVersion: number
  queue: QueueItem[]
  participants: Participant[]
}

/** Estado mínimo exigido pela timeline. */
export type TimelineSnapshot = Pick<RoomState, 'playbackState' | 'position' | 'startedAt'> & {
  currentTrack?: Pick<QueueItem, 'duration'> | null
}
