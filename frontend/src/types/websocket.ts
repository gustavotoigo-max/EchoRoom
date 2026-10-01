import type { RoomState } from './room'

export type ClientEventType =
  | 'ROOM_JOIN'
  | 'ROOM_LEAVE'
  | 'PLAYER_PLAY_REQUEST'
  | 'PLAYER_PAUSE_REQUEST'
  | 'PLAYER_SEEK_REQUEST'
  | 'TRACK_ADD'
  | 'TRACK_REMOVE'
  | 'TRACK_MOVE'
  | 'TRACK_SKIP'
  | 'TRACK_ENDED'
  | 'TRACK_META'
  | 'SYNC_REQUEST'
  | 'CLOCK_PING'

export type ServerEventType =
  | 'PLAYER_PLAY'
  | 'PLAYER_PAUSE'
  | 'PLAYER_SEEK'
  | 'TRACK_ADD'
  | 'TRACK_REMOVE'
  | 'TRACK_SKIP'
  | 'TRACK_ENDED'
  | 'QUEUE_UPDATE'
  | 'STATE_SYNC'
  | 'CLOCK_PONG'
  | 'USER_JOINED'
  | 'USER_LEFT'
  | 'ACK'
  | 'ERROR'

export interface ServerMessage<P = Record<string, unknown>> {
  type: ServerEventType
  room_id: string
  user_id?: string
  state_version?: number
  server_timestamp?: number
  payload: P
}

/** Payload de todo evento que altera a sala. */
export interface RoomEventPayload {
  room: RoomState
  executeAt?: number
  position?: number
  itemId?: string
  [key: string]: unknown
}

export interface ClockPongPayload {
  t1: number
  t2: number
  t3: number
}

export interface AckPayload {
  request_id: string
  changed?: boolean
}

export interface ErrorPayload {
  request_id?: string | null
  message: string
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unauthorized'
  | 'not_found'
  | 'closed'
