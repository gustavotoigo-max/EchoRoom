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
import type { QueueItem, RoomDoc } from '../types/room'

export class CommandError extends Error {}

export type RoomCommand =
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; position: number }
  | { type: 'TRACK_ADD'; item: QueueItem }
  | { type: 'TRACK_REMOVE'; itemId: string }
  | { type: 'TRACK_MOVE'; itemId: string; toIndex: number }
  | { type: 'TRACK_SKIP'; currentItemId: string | null }
  | { type: 'TRACK_ENDED'; itemId: string }
  | { type: 'TRACK_META'; itemId: string; title: string | null; duration: number | null }

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
  }
}

function startTrack(doc: RoomDoc, now: number): void {
  const at = now + sec(SyncConfig.trackChangeLeadTimeMs)
  doc.playbackState = 'playing'
  doc.position = 0
  doc.startedAt = at
  doc.executeAt = at
}

function advance(doc: RoomDoc, now: number): void {
  const next = doc.queue.shift() ?? null
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
export function applyCommand(current: RoomDoc, cmd: RoomCommand, now: number): RoomDoc | null {
  const doc: RoomDoc = structuredClone(current)
  const lead = sec(SyncConfig.commandLeadTimeMs)
  const changed = run(doc, cmd, now, lead)
  if (!changed) return null
  doc.stateVersion = current.stateVersion + 1
  return doc
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
      advance(doc, now)
      return true
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

/** Remove `undefined` (o Firebase recusa) mantendo o resto. */
export function toFirebase<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
