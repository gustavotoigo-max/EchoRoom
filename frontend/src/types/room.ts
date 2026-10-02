// Tipos de domínio da sala. Tempos do relógio do servidor em SEGUNDOS (float).

export type PlaybackState = 'playing' | 'paused' | 'buffering' | 'stopped'

export interface QueueItem {
  id: string
  videoId: string
  title: string
  author: string
  thumbnail: string
  duration?: number | null
  addedBy: string
  /** false enquanto o título é provisório (ex.: "youtu.be/ID"). */
  titleResolved?: boolean
}

export interface Participant {
  id: string
  name: string
  connected: boolean
  /** Avatar do Discord, quando a pessoa entrou com Discord. */
  avatar?: string | null
}

/**
 * Documento oficial da sala, guardado em /rooms/{chave}/state no Firebase.
 * Toda alteração passa por uma transação e incrementa stateVersion.
 */
export interface RoomDoc {
  roomId: string
  currentTrack: QueueItem | null
  playbackState: Exclude<PlaybackState, 'buffering'>
  /** Posição base da timeline (s). */
  position: number
  /** Instante (relógio do servidor) em que a reprodução partiu de `position`. */
  startedAt: number | null
  /** Instante (relógio do servidor) em que o último comando passa a valer. */
  executeAt: number | null
  stateVersion: number
  queue: QueueItem[]
}

/** Estado completo usado pela interface. */
export interface RoomState extends RoomDoc {
  currentVideoId: string | null
  participants: Participant[]
}

/** Estado mínimo exigido pela timeline. */
export type TimelineSnapshot = Pick<RoomDoc, 'playbackState' | 'position' | 'startedAt'> & {
  currentTrack?: Pick<QueueItem, 'duration'> | null
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'not_found' | 'closed'
