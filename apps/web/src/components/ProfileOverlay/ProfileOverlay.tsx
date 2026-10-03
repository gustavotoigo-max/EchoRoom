import { useEffect, useRef } from 'react'
import { usePlayback } from '../../hooks/usePlayback'
import { ProfileContent } from '../../pages/Profile/Profile'
import { useRoomSession } from '../../services/RoomSessionContext'
import { closeProfileOverlay, profileOverlayStore, resetProfileOverlay, syncProfileOverlayWithUrl } from '../../services/profileOverlay'
import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'
import { Equalizer } from '../ui/Equalizer'
import { CloseIcon, PauseIcon, PlayIcon } from '../ui/Icons'

/**
 * Perfil por cima da sala: o vídeo continua tocando atrás, desfocado,
 * e o perfil aparece em cartões no centro.
 */
export function ProfileOverlay() {
  const open = useStore(profileOverlayStore, (s) => s.open)
  const session = useRoomSession()
  const panel = useRef<HTMLDivElement>(null)

  // Endereço com #perfil ao entrar; ao sair da sala, o perfil fecha junto.
  useEffect(() => {
    syncProfileOverlayWithUrl()
    return () => resetProfileOverlay()
  }, [])

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      // Esc fecha primeiro a playlist aberta (painel lateral), depois o perfil.
      if (e.key === 'Escape' && !document.querySelector('.drawer-wrap')) closeProfileOverlay()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Seu perfil">
      <div className="po-bar">
        <MiniPlayer />
        <button type="button" className="btn btn-secondary po-back" onClick={closeProfileOverlay}>
          <CloseIcon width={16} height={16} />
          <span>Voltar à sala</span>
        </button>
      </div>
      <div className="po-scroll" ref={panel} tabIndex={-1}>
        <main className="profile-main po-main">
          <ProfileContent currentRoomId={session.roomId} onBackToRoom={closeProfileOverlay} />
        </main>
      </div>
    </div>
  )
}

/** O que está tocando na sala, com play/pausa, enquanto o perfil está aberto. */
function MiniPlayer() {
  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const roomName = useStore(roomStore, (s) => s.meta?.name ?? '')
  const playing = useStore(roomStore, (s) => s.room?.playbackState === 'playing')
  const pb = usePlayback()
  return (
    <div className="po-now">
      <button
        type="button"
        className="icon-btn po-play"
        aria-label={pb.isPlaying ? 'Pausar' : 'Tocar'}
        title={pb.locked ? 'Nesta sala, só o dono controla a reprodução' : pb.isPlaying ? 'Pausar' : 'Tocar'}
        disabled={pb.disabled}
        onClick={() => void pb.toggle()}
      >
        {pb.isPlaying ? <PauseIcon width={18} height={18} /> : <PlayIcon width={18} height={18} />}
      </button>
      <span className="po-now-text">
        <span className="po-now-eyebrow">
          <Equalizer on={playing} />
          {roomName || 'Sala'}
        </span>
        <b title={track?.title}>{track ? track.title : 'Nenhuma música tocando'}</b>
      </span>
    </div>
  )
}
