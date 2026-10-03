import type { TimelineSnapshot } from '../types/room'

/**
 * Timeline lógica da sala. Única implementação de expectedPosition no front.
 *
 *   tocando: expected = position + (serverNow - startedAt)
 *   pausado: expected = position
 *
 * Unidades: segundos, relógio do servidor.
 */
export function getExpectedPosition(state: TimelineSnapshot, estimatedServerNowSec: number): number {
  let pos = state.position
  if (state.playbackState === 'playing' && state.startedAt != null) {
    pos = state.position + Math.max(0, estimatedServerNowSec - state.startedAt)
  }
  const duration = state.currentTrack?.duration
  if (duration && duration > 0) pos = Math.min(pos, duration)
  return Math.max(0, pos)
}

/** True se a reprodução está agendada para começar no futuro. */
export function isStartPending(state: TimelineSnapshot, estimatedServerNowSec: number): boolean {
  return state.playbackState === 'playing' && state.startedAt != null && state.startedAt > estimatedServerNowSec
}
