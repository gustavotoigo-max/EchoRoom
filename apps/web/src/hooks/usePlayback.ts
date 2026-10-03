import { useEffect, useState } from 'react'
import { useRoomSession } from '../services/RoomSessionContext'
import { useStore } from '../stores/createStore'
import { roomStore, selectIsOwner } from '../stores/roomStore'
import { showToast } from '../stores/toastStore'

/**
 * Play/pausa com resposta imediata: o botão mostra a intenção até a sala
 * confirmar. Usado pelos controles e pelo botão sobre o vídeo.
 */
export function usePlayback() {
  const session = useRoomSession()
  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const playback = useStore(roomStore, (s) => s.room?.playbackState ?? 'stopped')
  const connected = useStore(roomStore, (s) => s.connection === 'connected')
  const locked = useStore(roomStore, (s) => s.settings.controls === 'owner' && !selectIsOwner(s))
  const [intent, setIntent] = useState<'play' | 'pause' | null>(null)
  useEffect(() => setIntent(null), [playback, track?.id])

  const isPlaying = intent ? intent === 'play' : playback === 'playing'
  const disabled = !track || !connected || locked

  async function toggle(onError?: (message: string) => void) {
    if (disabled) return
    const next = isPlaying ? 'pause' : 'play'
    setIntent(next)
    try {
      await (next === 'pause' ? session.pause() : session.play())
    } catch (err) {
      setIntent(null)
      const message = (err as Error).message || 'Não foi possível.'
      if (onError) onError(message)
      else showToast(message, 'error')
    }
  }

  return { isPlaying, pending: intent !== null, disabled, locked, toggle }
}
