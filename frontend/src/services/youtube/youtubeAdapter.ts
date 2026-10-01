import { mapYouTubeState, type PlayerAdapter } from './PlayerAdapter'

/** Adapta o YT.Player (IFrame API, entregue pelo react-youtube) para PlayerAdapter. */
export function createYouTubeAdapter(player: YT.Player): PlayerAdapter {
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch {
      return fallback
    }
  }

  return {
    load: (videoId, startSeconds) => player.loadVideoById({ videoId, startSeconds: Math.max(0, startSeconds) }),
    cue: (videoId, startSeconds) => player.cueVideoById({ videoId, startSeconds: Math.max(0, startSeconds) }),
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    stop: () => player.stopVideo(),
    seek: (seconds) => player.seekTo(Math.max(0, seconds), true),
    getCurrentTime: () => safe(() => player.getCurrentTime(), 0),
    getDuration: () => safe(() => player.getDuration(), 0),
    getState: () => mapYouTubeState(safe(() => player.getPlayerState() as number, -1)),
    getAvailablePlaybackRates: () => safe(() => player.getAvailablePlaybackRates(), [1]),
    setPlaybackRate: (rate) => player.setPlaybackRate(rate),
    mute: () => player.mute(),
    unMute: () => player.unMute(),
    isMuted: () => safe(() => player.isMuted(), false),
    setVolume: (volume) => player.setVolume(Math.max(0, Math.min(100, Math.round(volume)))),
    getTitle: () =>
      safe(() => (player as unknown as { getVideoData(): { title?: string } }).getVideoData()?.title || null, null),
  }
}
