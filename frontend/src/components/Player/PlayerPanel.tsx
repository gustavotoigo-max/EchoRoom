import { useCallback, useEffect } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import type { LocalPlayerState, PlayerAdapter } from '../../services/youtube/PlayerAdapter'
import { useStore } from '../../stores/createStore'
import { playerStore } from '../../stores/playerStore'
import { roomStore } from '../../stores/roomStore'
import { YouTubePlayer } from './YouTubePlayer'

export function PlayerPanel() {
  const session = useRoomSession()
  const hasTrack = useStore(roomStore, (s) => !!s.room?.currentTrack)
  const loaded = useStore(roomStore, (s) => s.room !== null)
  const error = useStore(playerStore, (s) => s.playerError)

  const onReady = useCallback((p: PlayerAdapter) => session.attachPlayer(p), [session])
  const onState = useCallback((s: LocalPlayerState) => session.handlePlayerState(s), [session])
  const onError = useCallback((c: number) => session.handlePlayerError(c), [session])

  useEffect(() => () => session.detachPlayer(), [session])

  return (
    <div className="player-frame">
      <YouTubePlayer onReady={onReady} onStateChange={onState} onError={onError} />
      {/* Bloqueia cliques no iframe: os controles da sala são a única fonte de comandos. */}
      <div className="player-shield" aria-hidden="true" />
      {!hasTrack && (
        <div className="player-empty">
          {loaded ? (
            <>
              <strong>Nada tocando ainda</strong>
              <span>Cole um link do YouTube em “Adicionar música” para começar.</span>
            </>
          ) : (
            <span>Carregando sala…</span>
          )}
        </div>
      )}
      {error && hasTrack && (
        <div className="player-error" role="alert">
          {error} Use “Próxima” para pular.
        </div>
      )}
    </div>
  )
}
