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
  /** uid de quem adicionou (permissões: quem adicionou pode remover). */
  addedByUid?: string
  /** false enquanto o título é provisório (ex.: "youtu.be/ID"). */
  titleResolved?: boolean
}

export interface Participant {
  /** uid do Firebase ("discord_…" para quem entrou com Discord). */
  id: string
  name: string
  connected: boolean
  /** Avatar do Discord, quando a pessoa entrou com Discord. */
  avatar?: string | null
  /** Entrou sem Discord. */
  guest?: boolean
}

/** Dados fixos da sala, em /rooms/{chave}/meta. */
export interface RoomMeta {
  roomId: string
  name: string
  /** uid do dono; ausente em salas antigas (antes de existir dono). */
  ownerUid: string | null
  ownerName: string
  createdAt: number
}

/** Configurações da sala (só o dono altera), em /rooms/{chave}/settings. */
export interface RoomSettings {
  /** Quem dá play, pausa, avança e reordena: todos ou só o dono. */
  controls: 'all' | 'owner'
  /** Quem adiciona músicas: todos ou só o dono. */
  adding: 'all' | 'owner'
  /** Pular exige votos de parte da sala (o dono pula direto). */
  voteSkip: boolean
  /** Porcentagem das pessoas conectadas necessária para pular. */
  voteSkipPercent: number
  /** Vídeo desligado para todos (só o som; o player fica no tamanho mínimo). */
  videoOff: boolean
  /** Máximo de músicas de cada pessoa na fila (0 = sem limite). */
  maxPerUser: number
  /** Convidados (sem Discord) podem entrar. */
  allowGuests: boolean
  /** Quem usa aleatório / ciclar / repetir. */
  modes: 'all' | 'owner' | 'off'
}

export const DEFAULT_SETTINGS: RoomSettings = {
  controls: 'all',
  adding: 'all',
  voteSkip: false,
  voteSkipPercent: 50,
  videoOff: false,
  maxPerUser: 0,
  allowGuests: true,
  modes: 'all',
}

export function normalizeSettings(raw: unknown): RoomSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof RoomSettings, unknown>>
  const pct = Number(r.voteSkipPercent)
  const max = Number(r.maxPerUser)
  return {
    controls: r.controls === 'owner' ? 'owner' : 'all',
    adding: r.adding === 'owner' ? 'owner' : 'all',
    voteSkip: r.voteSkip === true,
    voteSkipPercent: [25, 50, 66, 75, 100].includes(pct) ? pct : 50,
    videoOff: r.videoOff === true,
    maxPerUser: Number.isInteger(max) && max >= 0 && max <= 50 ? max : 0,
    allowGuests: r.allowGuests !== false,
    modes: r.modes === 'owner' || r.modes === 'off' ? r.modes : 'all',
  }
}

/** Quem está pedindo o comando (permissões verificadas dentro da transação). */
export interface CommandActor {
  uid: string
  isOwner: boolean
  settings: RoomSettings
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
  /** Próxima música sorteada da fila. */
  shuffle: boolean
  /** off · all = ciclar a fila (a que termina volta para o fim) · one = repetir a música. */
  repeat: RepeatMode
}

export type RepeatMode = 'off' | 'all' | 'one'

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
