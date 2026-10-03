/**
 * Regras da sala, executadas dentro de transações do Firebase.
 *
 * Funções puras: recebem o documento atual e o instante estimado do
 * servidor (s) e devolvem o novo documento. A transação do Firebase
 * garante que alterações simultâneas sejam serializadas (se dois
 * usuários clicarem ao mesmo tempo, a segunda reexecuta sobre o
 * resultado da primeira).
 *
 * Retornar `null` significa "nada mudou" (a transação é abortada).
 */

import { SyncConfig } from '../sync/SyncConfig'
import { getExpectedPosition } from '../sync/Timeline'
import type { CommandActor, QueueItem, RepeatMode, RoomDoc } from '../types/room'

export class CommandError extends Error {}

export type RoomCommand =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; position: number }
  | { type: 'TRACK_ADD'; item: QueueItem }
  | { type: 'TRACK_ADD_MANY'; items: QueueItem[] }
  | { type: 'TRACK_REMOVE'; itemId: string }
  | { type: 'TRACK_MOVE'; itemId: string; toIndex: number }
  | { type: 'TRACK_SKIP'; currentItemId: string | null; reason?: 'user' | 'vote' | 'error' }
  | { type: 'TRACK_ENDED'; itemId: string }
  | { type: 'TRACK_META'; itemId: string; title: string | null; duration: number | null }
  | { type: 'SET_MODES'; shuffle?: boolean; repeat?: RepeatMode }

const sec = (ms: number) => ms / 1000

export function emptyRoom(roomId: string): RoomDoc {
  return {
    roomId,
    currentTrack: null,
    playbackState: 'stopped',
    position: 0,
    startedAt: null,
    executeAt: null,
    stateVersion: 0,
    queue: [],
    shuffle: false,
    repeat: 'off',
  }
}

/** O Firebase não guarda arrays vazios nem nulls: reconstrói o formato completo. */
export function normalizeRoom(raw: unknown, roomId = ''): RoomDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, any>
  const queueRaw = r.queue
  const queue: QueueItem[] = Array.isArray(queueRaw)
    ? queueRaw.filter(Boolean)
    : queueRaw && typeof queueRaw === 'object'
      ? Object.keys(queueRaw)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => queueRaw[k])
      : []
  return {
    roomId: r.roomId ?? roomId,
    currentTrack: r.currentTrack ?? null,
    playbackState: r.playbackState === 'playing' || r.playbackState === 'paused' ? r.playbackState : 'stopped',
    position: Number(r.position) || 0,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : null,
    executeAt: typeof r.executeAt === 'number' ? r.executeAt : null,
    stateVersion: Number(r.stateVersion) || 0,
    queue,
    shuffle: r.shuffle === true,
    repeat: r.repeat === 'all' || r.repeat === 'one' ? r.repeat : 'off',
  }
}

function startTrack(doc: RoomDoc, now: number): void {
  const at = now + sec(SyncConfig.trackChangeLeadTimeMs)
  doc.playbackState = 'playing'
  doc.position = 0
  doc.startedAt = at
  doc.executeAt = at
}

/**
 * Nova identidade para uma música que volta a tocar (repetir/ciclar): o
 * player recarrega e os votos/avisos de fim da vez anterior não contam.
 */
function again(item: QueueItem, version: number): QueueItem {
  return { ...item, id: `${item.id.split('~')[0]}~${version}` }
}

function advance(doc: RoomDoc, now: number, ended = false): void {
  const cur = doc.currentTrack
  // Repetir a música: só quando ela termina sozinha (pular avança normalmente).
  if (ended && cur && doc.repeat === 'one') {
    doc.currentTrack = again(cur, doc.stateVersion)
    startTrack(doc, now)
    return
  }
  // Ciclar: a música que saiu volta para o fim da fila.
  if (cur && doc.repeat === 'all') doc.queue.push(again(cur, doc.stateVersion))
  const index = doc.shuffle && doc.queue.length > 1 ? Math.floor(Math.random() * doc.queue.length) : 0
  const next = doc.queue.splice(index, 1)[0] ?? null
  doc.currentTrack = next
  if (next) startTrack(doc, now)
  else {
    doc.playbackState = 'stopped'
    doc.position = 0
    doc.startedAt = null
    doc.executeAt = null
  }
}

/**
 * Aplica um comando. Retorna o novo documento, ou null se nada mudou.
 * Lança CommandError com mensagem pronta para o usuário.
 */
export function applyCommand(current: RoomDoc, cmd: RoomCommand, now: number, actor?: CommandActor): RoomDoc | null {
  const doc: RoomDoc = structuredClone(current)
  const c = { ...cmd } as RoomCommand // a transação pode repetir: não altera o comando original
  if (actor) checkPermission(doc, c, actor)
  const lead = sec(SyncConfig.commandLeadTimeMs)
  const changed = run(doc, c, now, lead)
  if (!changed) return null
  doc.stateVersion = current.stateVersion + 1
  return doc
}

/**
 * Permissões conforme as configurações da sala. O dono pode tudo.
 * Comandos automáticos (fim da música, título real, vídeo indisponível,
 * votação concluída) valem para todos.
 */
function checkPermission(doc: RoomDoc, cmd: RoomCommand, actor: CommandActor): void {
  const { settings } = actor
  if (cmd.type === 'SET_MODES') {
    // Desligar é sempre permitido (ex.: o dono desativou a opção com algo ligado).
    const turningOn = cmd.shuffle === true || (cmd.repeat && cmd.repeat !== 'off')
    if (turningOn && settings.modes === 'off') throw new CommandError('O dono desativou o aleatório e a repetição nesta sala.')
    if (!actor.isOwner && settings.modes === 'owner') throw new CommandError('Nesta sala, só o dono muda o aleatório e a repetição.')
    return
  }
  if (actor.isOwner) return
  const controlsLocked = settings.controls === 'owner'
  switch (cmd.type) {
    case 'PLAY':
    case 'PAUSE':
    case 'SEEK':
      if (controlsLocked) throw new CommandError('Nesta sala, só o dono controla a reprodução.')
      return
    case 'TRACK_MOVE':
      if (controlsLocked) throw new CommandError('Nesta sala, só o dono reorganiza a fila.')
      return
    case 'TRACK_SKIP':
      if (cmd.reason === 'vote' || cmd.reason === 'error') return
      if (settings.voteSkip) throw new CommandError('Nesta sala, pular é por votação.')
      if (controlsLocked) throw new CommandError('Nesta sala, só o dono pula músicas.')
      return
    case 'TRACK_ADD':
    case 'TRACK_ADD_MANY': {
      if (settings.adding === 'owner') throw new CommandError('Nesta sala, só o dono adiciona músicas.')
      if (settings.maxPerUser > 0) {
        const mine = doc.queue.filter((q) => q.addedByUid === actor.uid).length
        const room = settings.maxPerUser - mine
        if (room <= 0) {
          throw new CommandError(
            `Você já tem ${mine} ${mine === 1 ? 'música' : 'músicas'} na fila (limite da sala: ${settings.maxPerUser}).`,
          )
        }
        // Playlist: entra só o que cabe no limite da pessoa.
        if (cmd.type === 'TRACK_ADD_MANY') cmd.items = cmd.items.slice(0, room + (doc.currentTrack ? 0 : 1))
      }
      return
    }
    case 'TRACK_REMOVE': {
      const item = doc.queue.find((q) => q.id === cmd.itemId)
      if (item && item.addedByUid !== actor.uid) {
        throw new CommandError('Só o dono da sala ou quem adicionou pode remover esta música.')
      }
      return
    }
    default:
      return
  }
}

function run(doc: RoomDoc, cmd: RoomCommand, now: number, lead: number): boolean {
  const dur = doc.currentTrack?.duration ?? null

  switch (cmd.type) {
    case 'PLAY': {
      if (!doc.currentTrack) throw new CommandError('A fila está vazia. Adicione uma música para tocar.')
      if (doc.playbackState === 'playing') return false
      if (dur && doc.position >= dur - 0.5) doc.position = 0 // estava no fim: recomeça
      const at = now + lead
      doc.playbackState = 'playing'
      doc.startedAt = at
      doc.executeAt = at
      return true
    }

    case 'PAUSE': {
      if (doc.playbackState !== 'playing') return false
      const at = now + lead
      // Congela exatamente na posição em que todos vão pausar.
      doc.position = getExpectedPosition(doc, at)
      doc.playbackState = 'paused'
      doc.startedAt = null
      doc.executeAt = at
      return true
    }

    case 'SEEK': {
      if (!doc.currentTrack) throw new CommandError('Nenhuma música tocando.')
      let pos = Number(cmd.position)
      if (!Number.isFinite(pos)) throw new CommandError('Posição inválida.')
      pos = Math.max(0, dur ? Math.min(pos, Math.max(0, dur - 0.25)) : pos)
      const at = now + lead
      doc.position = pos
      doc.executeAt = at
      doc.startedAt = doc.playbackState === 'playing' ? at : null
      if (doc.playbackState === 'stopped') doc.playbackState = 'paused'
      return true
    }

    case 'TRACK_ADD': {
      if (doc.currentTrack?.videoId === cmd.item.videoId) throw new CommandError('Essa música já está tocando.')
      if (doc.queue.some((q) => q.videoId === cmd.item.videoId)) throw new CommandError('Essa música já está na fila.')
      if (doc.queue.length >= SyncConfig.maxQueueSize) throw new CommandError('A fila atingiu o limite de músicas.')
      if (!doc.currentTrack) {
        // Sala vazia: a música começa a tocar para todos.
        doc.currentTrack = cmd.item
        startTrack(doc, now)
      } else {
        doc.queue.push(cmd.item)
      }
      return true
    }

    case 'TRACK_ADD_MANY': {
      // Playlist: entra o que couber na fila, na ordem, sem repetir músicas.
      const fresh = withoutDuplicates(doc, cmd.items)
      if (!fresh.length) throw new CommandError('Todas essas músicas já estão na fila.')
      const items = fresh.slice(0, queueCapacity(doc))
      if (!items.length) throw new CommandError('A fila atingiu o limite de músicas.')
      if (!doc.currentTrack) {
        doc.currentTrack = items.shift()!
        startTrack(doc, now)
      }
      doc.queue.push(...items)
      return true
    }

    case 'TRACK_REMOVE': {
      const i = doc.queue.findIndex((q) => q.id === cmd.itemId)
      if (i < 0) return false
      doc.queue.splice(i, 1)
      return true
    }

    case 'TRACK_MOVE': {
      const i = doc.queue.findIndex((q) => q.id === cmd.itemId)
      if (i < 0) return false
      const to = Math.max(0, Math.min(Math.trunc(cmd.toIndex), doc.queue.length - 1))
      if (to === i) return false
      const [item] = doc.queue.splice(i, 1)
      doc.queue.splice(to, 0, item)
      return true
    }

    case 'TRACK_SKIP': {
      // O cliente diz qual música queria pular: dois cliques simultâneos não pulam duas.
      if (!doc.currentTrack) return false
      if (cmd.currentItemId && cmd.currentItemId !== doc.currentTrack.id) return false
      advance(doc, now)
      return true
    }

    case 'TRACK_ENDED': {
      // Vários clientes relatam o fim; só o primeiro avança (os outros já veem outra música).
      const cur = doc.currentTrack
      if (!cur || cur.id !== cmd.itemId || doc.playbackState !== 'playing') return false
      const pos = getExpectedPosition({ ...doc, currentTrack: null }, now)
      if (cur.duration ? pos < cur.duration - SyncConfig.trackEndToleranceSec : pos < 1) return false
      advance(doc, now, true)
      return true
    }

    case 'SET_MODES': {
      let changed = false
      if (typeof cmd.shuffle === 'boolean' && cmd.shuffle !== doc.shuffle) {
        doc.shuffle = cmd.shuffle
        changed = true
      }
      if (cmd.repeat && ['off', 'all', 'one'].includes(cmd.repeat) && cmd.repeat !== doc.repeat) {
        doc.repeat = cmd.repeat
        changed = true
      }
      return changed
    }

    case 'TRACK_META': {
      const items = [...(doc.currentTrack ? [doc.currentTrack] : []), ...doc.queue]
      const item = items.find((q) => q.id === cmd.itemId)
      if (!item) return false
      let changed = false
      const d = Number(cmd.duration)
      if (!item.duration && d > 0 && d < 86_400) {
        item.duration = d
        changed = true
      }
      if (cmd.title && item.titleResolved === false) {
        item.title = String(cmd.title).slice(0, 200)
        item.titleResolved = true
        changed = true
      }
      return changed
    }
  }
}

/** Tira músicas que já estão tocando, na fila ou repetidas na própria lista. */
export function withoutDuplicates<T extends { videoId: string }>(
  doc: Pick<RoomDoc, 'queue' | 'currentTrack'>,
  items: T[],
): T[] {
  const seen = new Set([doc.currentTrack?.videoId, ...doc.queue.map((q) => q.videoId)].filter(Boolean) as string[])
  return items.filter((i) => (seen.has(i.videoId) ? false : (seen.add(i.videoId), true)))
}

/** Quantas músicas ainda cabem (a atual não conta para o limite da fila). */
export function queueCapacity(doc: Pick<RoomDoc, 'queue' | 'currentTrack'>): number {
  return Math.max(0, SyncConfig.maxQueueSize - doc.queue.length) + (doc.currentTrack ? 0 : 1)
}

/** Remove `undefined` (o Firebase recusa) mantendo o resto. */
export function toFirebase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
