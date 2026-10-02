import { useEffect, useState } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'
import { NextIcon, PauseIcon, PlayIcon, RestartIcon } from '../ui/Icons'
import { Equalizer } from '../ui/Equalizer'
import { ProgressBar } from './ProgressBar'
import { VolumeControl } from './VolumeControl'

export function Controls() {
  const session = useRoomSession()
  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const playback = useStore(roomStore, (s) => s.room?.playbackState ?? 'stopped')
  const loaded = useStore(roomStore, (s) => s.room !== null)
  const connected = useStore(roomStore, (s) => s.connection === 'connected')

  // Feedback imediato: o botão mostra a intenção até o servidor confirmar.
  const [intent, setIntent] = useState<'play' | 'pause' | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setIntent(null), [playback, track?.id])

  const isPlaying = intent ? intent === 'play' : playback === 'playing'
  const disabled = !track || !connected

  async function run(action: () => Promise<unknown>, nextIntent: 'play' | 'pause' | null = null) {
    setError(null)
    setIntent(nextIntent)
    try {
      await action()
    } catch (err) {
      setIntent(null)
      setError((err as Error).message)
    }
  }

  return (
    <section className="now-playing" aria-label="Tocando agora">
      <div className="np-meta">
        {loaded ? (
          <>
            <span className="np-eyebrow">
              <Equalizer on={playback === 'playing'} />
              {track ? (playback === 'playing' ? 'Tocando agora para a sala' : 'Pausado para a sala') : 'Sala em silêncio'}
            </span>
            <h2 className="np-title" title={track?.title}>
              {track ? track.title : 'Nenhuma música tocando'}
            </h2>
            <p className="np-sub">
              {track ? (
                <>
                  {track.author && <span>{track.author}</span>}
                  <span className="np-added">adicionada por {track.addedBy}</span>
                </>
              ) : (
                'A fila está vazia.'
              )}
            </p>
          </>
        ) : (
          <>
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-sub" />
          </>
        )}
      </div>

      <div className="np-controls">
        <button
          type="button"
          className="icon-btn"
          title="Voltar ao início"
          aria-label="Voltar ao início da música"
          disabled={disabled}
          onClick={() => run(session.restart)}
        >
          <RestartIcon />
        </button>
        <button
          type="button"
          className={`icon-btn play-btn ${intent ? 'is-pending' : ''}`}
          aria-label={isPlaying ? 'Pausar' : 'Tocar'}
          title={isPlaying ? 'Pausar' : 'Tocar'}
          disabled={disabled}
          onClick={() => (isPlaying ? run(session.pause, 'pause') : run(session.play, 'play'))}
        >
          {isPlaying ? <PauseIcon width={24} height={24} /> : <PlayIcon width={24} height={24} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Próxima"
          aria-label="Próxima música"
          disabled={disabled}
          onClick={() => run(session.skip)}
        >
          <NextIcon />
        </button>
        <VolumeControl />
      </div>

      <ProgressBar duration={track?.duration ?? null} trackId={track?.id ?? null} disabled={disabled} />
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
