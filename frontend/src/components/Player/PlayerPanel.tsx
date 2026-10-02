import { useCallback, useEffect } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import type { LocalPlayerState, PlayerAdapter } from '../../services/youtube/PlayerAdapter'
import { useStore } from '../../stores/createStore'
import { playerStore } from '../../stores/playerStore'
import { roomStore } from '../../stores/roomStore'
import { storage } from '../../utils/storage'
import { ExpandIcon, PlayIcon, ShrinkIcon } from '../ui/Icons'
import { YouTubePlayer } from './YouTubePlayer'

function setVideoHidden(hidden: boolean) {
  playerStore.set({ videoHidden: hidden })
  storage.setVideoHidden(hidden)
}

/**
 * Player + opção "Esconder vídeo". Escondido, o player vira um mini player
 * de 200 px de altura (o mínimo que o YouTube permite para players
 * incorporados): ele passa a mandar uma resolução bem menor, o que reduz
 * processamento e dados, e a música continua sincronizada. O iframe não é
 * recriado ao alternar, então a reprodução não é interrompida.
 */
export function PlayerPanel() {
  const session = useRoomSession()
  const hasTrack = useStore(roomStore, (s) => !!s.room?.currentTrack)
  const loaded = useStore(roomStore, (s) => s.room !== null)
  const error = useStore(playerStore, (s) => s.playerError)
  const needsGesture = useStore(playerStore, (s) => s.needsGesture)
  const hiddenLocal = useStore(playerStore, (s) => s.videoHidden)
  // O dono pode desligar o vídeo para todos: vira mini player, sem a opção de mostrar.
  const videoOff = useStore(roomStore, (s) => s.settings.videoOff)
  const hidden = hiddenLocal || videoOff

  const onReady = useCallback((p: PlayerAdapter) => session.attachPlayer(p), [session])
  const onState = useCallback((s: LocalPlayerState) => session.handlePlayerState(s), [session])
  const onError = useCallback((c: number) => session.handlePlayerError(c), [session])

  useEffect(() => () => session.detachPlayer(), [session])

  return (
    <section className={`player-area ${hidden ? 'is-compact' : ''}`} aria-label="Vídeo">
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
        {needsGesture && hasTrack && !error && (
          <button type="button" className="player-unlock" onClick={session.unlockAudio}>
            <i aria-hidden="true">
              <PlayIcon width={28} height={28} />
            </i>
            <span>Clique para ouvir junto</span>
            <small>O navegador só libera o som depois de um clique na página.</small>
          </button>
        )}
        {error && hasTrack && (
          <div className="player-error" role="alert">
            {error}
          </div>
        )}
        {!hidden && !videoOff && (
          <button
            type="button"
            className="video-toggle"
            aria-label="Esconder vídeo"
            title="Esconder vídeo (economiza processamento)"
            onClick={() => setVideoHidden(true)}
          >
            <ShrinkIcon width={16} height={16} />
            <span>Esconder vídeo</span>
          </button>
        )}
      </div>

      {hidden && (
        <div className="player-compact-info">
          {videoOff ? (
            <>
              <strong>Vídeo desligado nesta sala</strong>
              <p>O dono deixou a sala só no som: o YouTube manda a menor resolução e a música continua sincronizada.</p>
            </>
          ) : (
            <>
              <strong>Vídeo reduzido</strong>
              <p>
                Com o vídeo pequeno, o YouTube envia uma resolução menor: menos processamento e menos dados. A música
                continua sincronizada.
              </p>
              <button type="button" className="btn btn-secondary" onClick={() => setVideoHidden(false)}>
                <ExpandIcon width={16} height={16} />
                <span>Mostrar vídeo</span>
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
