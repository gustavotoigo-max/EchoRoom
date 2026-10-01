/**
 * Interface mínima de controle do player usada pelo SyncEngine.
 * O SyncEngine não conhece react-youtube nem a IFrame API diretamente,
 * o que permite testá-lo com um player falso.
 */

export type LocalPlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

export interface PlayerAdapter {
  /** Carrega e começa a tocar a partir de `startSeconds`. */
  load(videoId: string, startSeconds: number): void
  /** Carrega sem tocar, posicionado em `startSeconds`. */
  cue(videoId: string, startSeconds: number): void
  play(): void
  pause(): void
  stop(): void
  seek(seconds: number): void
  getCurrentTime(): number
  getDuration(): number
  getState(): LocalPlayerState
  getAvailablePlaybackRates(): number[]
  setPlaybackRate(rate: number): void
  mute(): void
  unMute(): void
  isMuted(): boolean
  /** Volume local de 0 a 100 (só deste navegador). */
  setVolume(volume: number): void
  getTitle(): string | null
}

/** Códigos de estado da YouTube IFrame API. */
export function mapYouTubeState(code: number): LocalPlayerState {
  switch (code) {
    case 0:
      return 'ended'
    case 1:
      return 'playing'
    case 2:
      return 'paused'
    case 3:
      return 'buffering'
    case 5:
      return 'cued'
    default:
      return 'unstarted'
  }
}

/** Mensagens concretas para os códigos de erro da IFrame API. */
export function describeYouTubeError(code: number): string {
  switch (code) {
    case 2:
      return 'O link deste vídeo é inválido.'
    case 5:
      return 'O navegador não conseguiu reproduzir este vídeo.'
    case 100:
      return 'Este vídeo foi removido ou é privado.'
    case 101:
    case 150:
      return 'Este vídeo não permite reprodução incorporada.'
    default:
      return `O player do YouTube retornou um erro (${code}).`
  }
}
