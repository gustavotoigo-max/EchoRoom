import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlayback } from '../../hooks/usePlayback'
import { useRoomSession } from '../../services/RoomSessionContext'
import type { LocalPlayerState, PlayerAdapter } from '../../services/youtube/PlayerAdapter'
import { useStore } from '../../stores/createStore'
import { playerStore, setVideoSize, type VideoSize } from '../../stores/playerStore'
import { roomStore } from '../../stores/roomStore'
import { ProgressBar } from '../Controls/ProgressBar'
import { ExitFullscreenIcon, FullscreenIcon, PauseIcon, PlayIcon } from '../ui/Icons'
import { EndCard } from './EndCard'
import { YouTubePlayer } from './YouTubePlayer'

const SIZES: [VideoSize, string][] = [
  ['small', 'Pequeno'],
  ['normal', 'Normal'],
  ['max', 'Máximo'],
]

/** Pequeno (só o som, mínimo de processamento) · Normal · Máximo (modo cinema). */
function SizePicker({ size, overlay }: { size: VideoSize; overlay?: boolean }) {
  return (
    <div className={`size-picker ${overlay ? 'is-overlay' : ''}`} role="radiogroup" aria-label="Tamanho do vídeo">
      {SIZES.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={size === v} className={size === v ? 'on' : ''} onClick={() => setVideoSize(v)}>
          {label}
        </button>
      ))}
    </div>
  )
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
  const sizeLocal = useStore(playerStore, (s) => s.videoSize)
  // O dono pode desligar o vídeo para todos: vira mini player, sem a opção de mudar.
  const videoOff = useStore(roomStore, (s) => s.settings.videoOff)
  const size: VideoSize = videoOff ? 'small' : sizeLocal
  const hidden = size === 'small'

  // Máximo: modo cinema (a página esconde as colunas laterais).
  useEffect(() => {
    document.documentElement.classList.toggle('video-max', size === 'max')
    return () => document.documentElement.classList.remove('video-max')
  }, [size])

  const onReady = useCallback((p: PlayerAdapter) => session.attachPlayer(p), [session])
  const onState = useCallback((s: LocalPlayerState) => session.handlePlayerState(s), [session])
  const onError = useCallback((c: number) => session.handlePlayerError(c), [session])

  useEffect(() => () => session.detachPlayer(), [session])

  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const playback = usePlayback()
  const stageRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const clickTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void stageRef.current?.requestFullscreen?.().catch(() => {})
  }

  // Clique no vídeo: play/pausa. Duplo clique: tela cheia (como no YouTube).
  function onVideoClick() {
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => void playback.toggle(), 220)
  }
  function onVideoDoubleClick() {
    clearTimeout(clickTimer.current)
    if (!hidden) toggleFullscreen()
  }

  const overlay = hasTrack && !needsGesture && !error

  return (
    <div className={`player-stage ${fullscreen ? 'is-fullscreen' : ''}`} ref={stageRef}>
    <section className={`player-area ${hidden ? 'is-compact' : ''}`} aria-label="Vídeo">
      <div className={`player-frame ${playback.isPlaying ? 'is-playing' : 'is-paused'}`}>
        <YouTubePlayer onReady={onReady} onStateChange={onState} onError={onError} />
        {/* Cobre o iframe: os comandos passam pela sala (clique = play/pausa, duplo clique = tela cheia). */}
        <div
          className={`player-shield ${overlay && !playback.disabled ? 'is-clickable' : ''}`}
          aria-hidden="true"
          onClick={overlay ? onVideoClick : undefined}
          onDoubleClick={overlay ? onVideoDoubleClick : undefined}
        />
        {overlay && (
          <button
            type="button"
            className="video-play"
            aria-label={playback.isPlaying ? 'Pausar' : 'Tocar'}
            title={playback.locked ? 'Nesta sala, só o dono controla a reprodução' : playback.isPlaying ? 'Pausar' : 'Tocar'}
            disabled={playback.disabled}
            onClick={() => void playback.toggle()}
          >
            {playback.isPlaying ? <PauseIcon width={30} height={30} /> : <PlayIcon width={30} height={30} />}
          </button>
        )}
        {overlay && !hidden && (
          <button
            type="button"
            className="video-fullscreen"
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <ExitFullscreenIcon width={20} height={20} /> : <FullscreenIcon width={20} height={20} />}
          </button>
        )}
        {overlay && !hidden && <EndCard />}
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
        {!hidden && !fullscreen && <SizePicker size={size} overlay />}
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
              <strong>Vídeo pequeno</strong>
              <p>
                Com o vídeo pequeno, o YouTube envia uma resolução menor: menos processamento e menos dados. A música
                continua sincronizada.
              </p>
              <SizePicker size={size} />
            </>
          )}
        </div>
      )}
    </section>
    {/* Tempo da música logo abaixo do vídeo */}
    <div className="video-bar">
      <ProgressBar duration={track?.duration ?? null} trackId={track?.id ?? null} disabled={!track || playback.disabled} />
    </div>
    </div>
  )
}
