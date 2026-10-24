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
    // Sem startSeconds quando é 0: numa transmissão ao vivo o player começa no ao vivo, não no início do DVR.
    load: (videoId, startSeconds) => player.loadVideoById(startSeconds > 0 ? { videoId, startSeconds } : { videoId }),
    cue: (videoId, startSeconds) => player.cueVideoById(startSeconds > 0 ? { videoId, startSeconds } : { videoId }),
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
    getTitle: () => safe(() => videoData(player)?.title || null, null),
    isLive: () =>
      safe(() => {
        const d = videoData(player)
        return d?.isLive === true || d?.isWindowedLive === true
      }, false),
  }
}

/** getVideoData() existe no player, mas não está nos tipos da IFrame API. */
type VideoData = { title?: string; isLive?: boolean; isWindowedLive?: boolean }
function videoData(player: YT.Player): VideoData | undefined {
  return (player as unknown as { getVideoData(): VideoData }).getVideoData()
}
