import { memo } from 'react'
import YouTube, { type YouTubeEvent } from 'react-youtube'
import { createYouTubeAdapter } from '../../services/youtube/youtubeAdapter'
import { mapYouTubeState, type LocalPlayerState, type PlayerAdapter } from '../../services/youtube/PlayerAdapter'

interface Props {
  onReady: (player: PlayerAdapter) => void
  onStateChange: (state: LocalPlayerState) => void
  onError: (code: number) => void
}

const opts = {
  width: '100%',
  height: '100%',
  playerVars: {
    autoplay: 0 as const,
    controls: 0 as const,
    disablekb: 1 as const,
    fs: 0 as const,
    iv_load_policy: 3 as const,
    modestbranding: 1 as const,
    playsinline: 1 as const,
    rel: 0 as const,
    origin: typeof window !== 'undefined' ? window.location.origin : undefined,
  },
}

/**
 * Camada fina sobre o player oficial (react-youtube → IFrame API).
 * Só reprodução local: sem WebSocket e sem lógica de sincronização.
 * O vídeo é carregado pelo SyncEngine via PlayerAdapter, por isso
 * este componente nunca re-renderiza.
 */
export const YouTubePlayer = memo(function YouTubePlayer({ onReady, onStateChange, onError }: Props) {
  return (
    <YouTube
      className="yt-host"
      iframeClassName="yt-iframe"
      opts={opts}
      onReady={(e: YouTubeEvent) => onReady(createYouTubeAdapter(e.target as unknown as YT.Player))}
      onStateChange={(e: YouTubeEvent<number>) => onStateChange(mapYouTubeState(e.data))}
      onError={(e: YouTubeEvent<number>) => onError(e.data)}
    />
  )
})
