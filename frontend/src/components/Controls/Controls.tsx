import { useState } from 'react'
import { usePlayback } from '../../hooks/usePlayback'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner, validVotes, votesNeeded } from '../../stores/roomStore'
import { NextIcon, PauseIcon, PlayIcon, RestartIcon } from '../ui/Icons'
import { Equalizer } from '../ui/Equalizer'
import { VolumeControl } from './VolumeControl'

export function Controls() {
  const session = useRoomSession()
  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const playback = useStore(roomStore, (s) => s.room?.playbackState ?? 'stopped')
  const loaded = useStore(roomStore, (s) => s.room !== null)
  const connected = useStore(roomStore, (s) => s.connection === 'connected')
  const isOwner = useStore(roomStore, selectIsOwner)
  const settings = useStore(roomStore, (s) => s.settings)
  const voteCount = useStore(roomStore, (s) => validVotes(s).length)
  const voted = useStore(roomStore, (s) => validVotes(s).includes(s.participantId))
  const needed = useStore(roomStore, votesNeeded)
  const voterNames = useStore(roomStore, (s) => {
    const votes = new Set(validVotes(s))
    return (s.room?.participants ?? []).filter((p) => votes.has(p.id) && p.id !== s.participantId).map((p) => p.name).join(', ')
  })
  const pb = usePlayback()
  const [error, setError] = useState<string | null>(null)

  const disabled = !track || !connected
  const locked = settings.controls === 'owner' && !isOwner
  const voting = settings.voteSkip && !isOwner
  const lockTitle = 'Nesta sala, só o dono controla a reprodução'

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (err) {
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
          title={locked ? lockTitle : 'Voltar ao início'}
          aria-label="Voltar ao início da música"
          disabled={disabled || locked}
          onClick={() => run(session.restart)}
        >
          <RestartIcon />
        </button>
        <button
          type="button"
          className={`icon-btn play-btn ${pb.pending ? 'is-pending' : ''}`}
          aria-label={pb.isPlaying ? 'Pausar' : 'Tocar'}
          title={locked ? lockTitle : pb.isPlaying ? 'Pausar' : 'Tocar'}
          disabled={pb.disabled}
          onClick={() => {
            setError(null)
            void pb.toggle(setError)
          }}
        >
          {pb.isPlaying ? <PauseIcon width={24} height={24} /> : <PlayIcon width={24} height={24} />}
        </button>
        <span className="skip-wrap">
        {settings.voteSkip && track && voteCount > 0 && (
          <span className="vote-prompt" role="status">
            {voted ? (
              <>
                <span>
                  Você votou para pular · <b>{voteCount}/{needed}</b>
                </span>
                <button type="button" className="link-btn" onClick={() => run(session.toggleVoteSkip)}>
                  Desfazer
                </button>
              </>
            ) : isOwner ? (
              <>
                <span>
                  {voterNames || 'Alguém'} quer pular · <b>{voteCount}/{needed}</b>
                </span>
                <button type="button" className="btn btn-primary" onClick={() => run(session.skip)}>
                  Pular agora
                </button>
              </>
            ) : (
              <>
                <span>
                  {voterNames || 'Alguém'} quer pular. <strong>Pular?</strong> <b>{voteCount}/{needed}</b>
                </span>
                <button type="button" className="btn btn-primary" onClick={() => run(session.toggleVoteSkip)}>
                  Sim, pular
                </button>
              </>
            )}
          </span>
        )}
        {voting ? (
          <button
            type="button"
            className={`icon-btn vote-btn ${voted ? 'is-voted' : ''}`}
            title={voted ? 'Tirar meu voto para pular' : 'Votar para pular'}
            aria-label={`${voted ? 'Tirar voto' : 'Votar para pular'}: ${voteCount} de ${needed}`}
            aria-pressed={voted}
            disabled={disabled}
            onClick={() => run(session.toggleVoteSkip)}
          >
            <NextIcon />
            <b>
              {voteCount}/{needed}
            </b>
          </button>
        ) : (
          <button
            type="button"
            className="icon-btn"
            title={locked ? 'Nesta sala, só o dono pula músicas' : 'Próxima'}
            aria-label="Próxima música"
            disabled={disabled || locked}
            onClick={() => run(session.skip)}
          >
            <NextIcon />
          </button>
        )}
        </span>
        <VolumeControl />
      </div>

      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
