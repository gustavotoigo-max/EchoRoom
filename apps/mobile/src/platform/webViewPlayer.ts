import { mapYouTubeState, type LocalPlayerState, type PlayerAdapter } from '@web/services/youtube/PlayerAdapter'

/** Comando enviado à página do player (player.html no site). */
export type PlayerCommand =
  | { c: 'load' | 'cue'; id: string; t: number }
  | { c: 'seek'; t: number }
  | { c: 'rate' | 'volume'; v: number }
  | { c: 'play' | 'pause' | 'stop' | 'mute' | 'unmute' }

/** Mensagem que a página do player manda para o app. */
export type PlayerMessage =
  | { t: 'ready'; rates?: number[] }
  | { t: 'state'; s: number }
  | { t: 'error'; code: number }
  | { t: 'tick'; time: number; dur: number; state: number; muted: boolean; rate: number; title: string | null }

/**
 * PlayerAdapter (o que o SyncEngine usa) para o player do YouTube que roda
 * dentro de uma WebView. Os comandos vão por mensagem e as leituras são
 * respondidas com o último estado recebido; o tempo atual é extrapolado
 * entre as atualizações (4 por segundo), como o player do site faz por dentro.
 */
export class WebViewPlayer implements PlayerAdapter {
  private time = 0
  private timeAt = 0
  private duration = 0
  private stateCode = -1
  private muted = false
  private rate = 1
  private rates: number[] = [1]
  private title: string | null = null

  constructor(private readonly send: (cmd: PlayerCommand) => void) {}

  /** Atualiza o estado com uma mensagem da página. Devolve o novo estado, se mudou. */
  receive(msg: PlayerMessage): { state?: LocalPlayerState; error?: number } {
    switch (msg.t) {
      case 'ready':
        if (Array.isArray(msg.rates) && msg.rates.length) this.rates = msg.rates
        return {}
      case 'state':
        this.stateCode = msg.s
        return { state: mapYouTubeState(msg.s) }
      case 'error':
        return { error: msg.code }
      case 'tick':
        this.time = Number(msg.time) || 0
        this.timeAt = Date.now()
        this.duration = Number(msg.dur) || 0
        this.stateCode = msg.state
        this.muted = !!msg.muted
        this.rate = Number(msg.rate) || 1
        if (msg.title) this.title = msg.title
        return {}
    }
  }

  private setTime(t: number) {
    this.time = Math.max(0, t)
    this.timeAt = Date.now()
  }

  load(videoId: string, startSeconds: number): void {
    this.setTime(startSeconds)
    this.title = null
    this.send({ c: 'load', id: videoId, t: startSeconds })
  }
  cue(videoId: string, startSeconds: number): void {
    this.setTime(startSeconds)
    this.title = null
    this.send({ c: 'cue', id: videoId, t: startSeconds })
  }
  play(): void {
    this.send({ c: 'play' })
  }
  pause(): void {
    this.setTime(this.getCurrentTime())
    this.send({ c: 'pause' })
  }
  stop(): void {
    this.send({ c: 'stop' })
  }
  seek(seconds: number): void {
    this.setTime(seconds)
    this.send({ c: 'seek', t: seconds })
  }
  getCurrentTime(): number {
    if (this.stateCode !== 1) return this.time
    return this.time + ((Date.now() - this.timeAt) / 1000) * this.rate
  }
  getDuration(): number {
    return this.duration
  }
  getState(): LocalPlayerState {
    return mapYouTubeState(this.stateCode)
  }
  getAvailablePlaybackRates(): number[] {
    return this.rates
  }
  setPlaybackRate(rate: number): void {
    this.setTime(this.getCurrentTime())
    this.rate = rate
    this.send({ c: 'rate', v: rate })
  }
  mute(): void {
    this.muted = true
    this.send({ c: 'mute' })
  }
  unMute(): void {
    this.muted = false
    this.send({ c: 'unmute' })
  }
  isMuted(): boolean {
    return this.muted
  }
  setVolume(volume: number): void {
    this.send({ c: 'volume', v: volume })
  }
  getTitle(): string | null {
    return this.title
  }
}
