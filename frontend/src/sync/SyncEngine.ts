import type { RoomState } from '../types/room'
import type { LocalPlayerState, PlayerAdapter } from '../services/youtube/PlayerAdapter'
import { ClockSync, highResNow, type NowFn } from './ClockSync'
import { DriftCorrection, type CorrectionType } from './DriftCorrection'
import { SyncConfig, isSyncDebug } from './SyncConfig'
import { getExpectedPosition as timelineExpected, isStartPending } from './Timeline'

/**
 * SyncEngine: coordena relógio, timeline, player local e correção de drift.
 *
 * Fluxo de um comando:
 *   servidor envia estado novo com executeAt (relógio do servidor)
 *   → engine converte executeAt para o relógio local
 *   → prepara o player (pausa + posiciona) se for início de reprodução
 *   → no instante local equivalente, aplica play/pause/seek
 *   → loop local mede drift e corrige com histerese
 */

export type SyncUiState = 'waiting' | 'syncing' | 'synced' | 'adjusting' | 'buffering' | 'unstable'

export interface SyncStatus {
  rtt: number
  clockOffset: number
  drift: number
  lastClockSync: number
  ui: SyncUiState
  correction: CorrectionType
}

export interface SyncEngineDeps {
  clock: ClockSync
  onTrackEnded: (itemId: string) => void
  onTrackMeta: (itemId: string, title: string | null, duration: number | null) => void
  onStatus: (status: SyncStatus) => void
  onPlayerError?: (code: number) => void
  now?: NowFn
  cfg?: typeof SyncConfig
  /** Para testes: substitui setTimeout/setInterval. */
  timers?: {
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (id: unknown) => void
    setInterval: (fn: () => void, ms: number) => unknown
    clearInterval: (id: unknown) => void
  }
}

const defaultTimers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
}

export class SyncEngine {
  private readonly clock: ClockSync
  private readonly correction: DriftCorrection
  private readonly cfg: typeof SyncConfig
  private readonly now: NowFn
  private readonly timers: NonNullable<SyncEngineDeps['timers']>
  private readonly debug = typeof window !== 'undefined' && isSyncDebug()

  private player: PlayerAdapter | null = null
  private state: RoomState | null = null

  private loadedItemId: string | null = null
  private cuedPosition: number | null = null
  private scheduleTimer: unknown = null
  private checkTimer: unknown = null
  private pending = false
  private prerolling = false
  private mutedByEngine = false
  private forceNext = false
  private wasBuffering = false
  private endedSentFor: string | null = null
  private endedSentAt = 0
  private metaSentFor = new Set<string>()
  private lastCorrection: CorrectionType = 'none'
  private ui: SyncUiState = 'waiting'
  private drift = 0
  private visibilityHandler = () => this.onVisibilityChange()

  constructor(private readonly deps: SyncEngineDeps) {
    this.clock = deps.clock
    this.cfg = deps.cfg ?? SyncConfig
    this.now = deps.now ?? highResNow
    this.timers = deps.timers ?? defaultTimers
    this.correction = new DriftCorrection(this.cfg)
  }

  // ---- ciclo de vida -------------------------------------------------------

  start(): void {
    this.stop()
    this.checkTimer = this.timers.setInterval(() => this.reconcile(false), this.cfg.localCheckIntervalMs)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  stop(): void {
    if (this.checkTimer != null) this.timers.clearInterval(this.checkTimer)
    this.checkTimer = null
    this.clearSchedule()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibilityHandler)
  }

  attachPlayer(player: PlayerAdapter): void {
    this.player = player
    this.loadedItemId = null
    if (this.state) this.applyState(this.state)
  }

  detachPlayer(): void {
    this.player = null
    this.loadedItemId = null
  }

  // ---- API pública ---------------------------------------------------------

  /** Posição esperada da sala agora (s). Função central — não duplicar. */
  getExpectedPosition(state: RoomState | null = this.state, estimatedServerNow = this.clock.serverNowSec()): number {
    return state ? timelineExpected(state, estimatedServerNow) : 0
  }

  getStatus(): SyncStatus {
    return {
      rtt: this.clock.rtt,
      clockOffset: this.clock.offset,
      drift: this.drift,
      lastClockSync: this.clock.lastSyncAt,
      ui: this.ui,
      correction: this.lastCorrection,
    }
  }

  /** Aplica um novo estado oficial da sala (já filtrado por stateVersion). */
  applyState(state: RoomState): void {
    this.state = state
    this.clearSchedule()
    const player = this.player
    if (!player) return

    const track = state.currentTrack
    if (!track) {
      if (this.loadedItemId) player.stop()
      this.loadedItemId = null
      this.setUi('waiting')
      return
    }

    if (track.id !== this.loadedItemId) {
      this.loadTrack(state)
      return
    }
    this.schedule(state)
  }

  /** Após reconexão ou retorno da aba: recalcula tudo e corrige sem histerese. */
  resync(): void {
    if (this.state) this.applyState(this.state)
    this.forceNext = true
  }

  handlePlayerState(s: LocalPlayerState): void {
    const player = this.player
    const state = this.state
    if (!player || !state) return

    if (this.prerolling && (s === 'playing' || s === 'paused')) {
      // Vídeo carregado e com buffer: posiciona e aguarda o instante agendado.
      this.prerolling = false
      player.pause()
      player.seek(state.position)
      this.restoreMute()
      this.log('preroll pronto', { position: state.position })
      return
    }

    if (s === 'buffering') {
      this.wasBuffering = true
      if (state.playbackState === 'playing') this.setUi('buffering')
      return
    }

    if (s === 'playing') {
      this.sendMetaOnce()
      if (this.wasBuffering || this.forceNext) {
        this.timers.setTimeout(() => this.reconcile(true), 0)
      }
      return
    }

    if (s === 'ended' && state.currentTrack && state.playbackState === 'playing') {
      this.sendEnded(state.currentTrack.id)
    }
  }

  handlePlayerError(code: number): void {
    this.deps.onPlayerError?.(code)
  }

  // ---- internos --------------------------------------------------------------

  private loadTrack(state: RoomState): void {
    const player = this.player!
    const track = state.currentTrack!
    this.loadedItemId = track.id
    this.correction.reset()
    this.endedSentFor = null
    this.prerolling = false
    this.restoreMute()

    const serverNow = this.clock.serverNowSec()
    if (state.playbackState === 'playing') {
      if (isStartPending(state, serverNow)) {
        // Carrega mudo para formar buffer; pausa assim que tocar; inicia no instante agendado.
        this.prerolling = true
        this.muteForPreroll()
        player.load(track.videoId, state.position)
        this.cuedPosition = null
        this.scheduleAt(state.startedAt!)
      } else {
        player.load(track.videoId, this.getExpectedPosition(state, serverNow))
        this.cuedPosition = null
        this.forceNext = true
      }
      this.setUi('syncing')
    } else {
      player.cue(track.videoId, state.position)
      this.cuedPosition = state.position
      this.setUi('synced')
    }
    this.log('carregando faixa', { videoId: track.videoId, state: state.playbackState })
  }

  private schedule(state: RoomState): void {
    const execAt = state.executeAt
    const msLeft = execAt != null ? this.clock.msUntil(execAt) : -1
    if (msLeft > 15) {
      if (state.playbackState === 'playing') this.prepareStart(state.position)
      // pause agendado: continua tocando até o instante.
      this.scheduleAt(execAt!)
      return
    }
    this.reconcile(true)
  }

  /** Deixa o player pausado exatamente em `position`, pronto para dar play. */
  private prepareStart(position: number): void {
    const player = this.player!
    const local = player.getState()
    if (local === 'playing' || local === 'paused' || local === 'buffering') {
      player.pause()
      if (Math.abs(player.getCurrentTime() - position) * 1000 > this.cfg.ignoreDriftMs / 3) player.seek(position)
    } else if (this.state?.currentTrack) {
      // cued/unstarted/ended: seekTo faria tocar; usa preroll mudo.
      this.prerolling = true
      this.muteForPreroll()
      player.load(this.state.currentTrack.videoId, position)
      this.cuedPosition = null
    }
  }

  private scheduleAt(serverSec: number): void {
    this.clearSchedule()
    this.pending = true
    const ms = Math.max(0, this.clock.msUntil(serverSec))
    this.scheduleTimer = this.timers.setTimeout(() => {
      this.scheduleTimer = null
      this.pending = false
      if (this.prerolling) {
        // Buffer não ficou pronto a tempo: começa assim mesmo e corrige depois.
        this.prerolling = false
        this.restoreMute()
        this.forceNext = true
      }
      this.reconcile(true)
    }, ms)
  }

  private clearSchedule(): void {
    if (this.scheduleTimer != null) this.timers.clearTimeout(this.scheduleTimer)
    this.scheduleTimer = null
    this.pending = false
  }

  /** Compara player local com a timeline e age. Leve: chamado a cada ~500 ms. */
  reconcile(force: boolean): void {
    const player = this.player
    const state = this.state
    if (!player || !state || !state.currentTrack || this.pending || this.prerolling) {
      if (state && !state.currentTrack) this.setUi('waiting')
      this.emit()
      return
    }

    const local = player.getState()
    const nowMs = this.now()
    const expected = this.getExpectedPosition(state)

    if (state.playbackState === 'stopped') {
      if (local === 'playing') player.pause()
      this.setUi('waiting')
      return
    }

    if (state.playbackState === 'paused') {
      if (local === 'playing' || local === 'buffering') player.pause()
      if (local === 'cued' || local === 'unstarted') {
        if (this.cuedPosition == null || Math.abs(this.cuedPosition - expected) * 1000 > this.cfg.ignoreDriftMs) {
          player.cue(state.currentTrack.videoId, expected)
          this.cuedPosition = expected
        }
        this.drift = 0
      } else {
        this.drift = (player.getCurrentTime() - expected) * 1000
        if (Math.abs(this.drift) > this.cfg.ignoreDriftMs && local !== 'ended') {
          player.seek(expected)
          this.lastCorrection = 'seek'
        }
      }
      if (this.correction.softActive) {
        player.setPlaybackRate(1)
        this.correction.currentRate = 1
      }
      this.correction.reset()
      this.setUi('synced')
      return
    }

    // ---- tocando ----
    if (local === 'buffering') {
      this.wasBuffering = true
      this.setUi('buffering')
      return
    }

    if (local === 'ended') {
      const localDuration = player.getDuration() || state.currentTrack.duration || 0
      if (localDuration && expected >= localDuration - 1.5) {
        this.sendEnded(state.currentTrack.id)
        this.setUi('synced')
        return
      }
    }

    if (local !== 'playing') {
      // pausado/cued/ended fora de hora: volta para a timeline.
      if (Math.abs(player.getCurrentTime() - expected) * 1000 > this.cfg.ignoreDriftMs) {
        player.seek(expected)
        this.correction.noteSeek(nowMs)
      }
      player.play()
      this.lastCorrection = 'seek'
      this.setUi('syncing')
      return
    }

    this.drift = (player.getCurrentTime() - expected) * 1000
    const forced = force || this.forceNext || this.wasBuffering
    this.forceNext = false
    this.wasBuffering = false
    const decision = this.correction.decide(this.drift, nowMs, player.getAvailablePlaybackRates(), forced)
    this.lastCorrection = decision.type

    switch (decision.type) {
      case 'seek':
        player.setPlaybackRate(1)
        player.seek(expected + this.cfg.seekCompensationMs / 1000)
        break
      case 'rate':
      case 'rate-reset':
        player.setPlaybackRate(decision.rate ?? 1)
        break
    }

    if (decision.type !== 'none' && decision.type !== 'monitor') {
      this.log('correção', { type: decision.type, rate: decision.rate, drift: Math.round(this.drift) })
    }

    const adjusting = decision.type === 'seek' || decision.type === 'rate' || this.correction.softActive
    if (adjusting) this.setUi('adjusting')
    else if (this.isUnstable()) this.setUi('unstable')
    else this.setUi('synced')

    if (this.debug) {
      this.log('tick', {
        rtt: Math.round(this.clock.rtt),
        clockOffset: Math.round(this.clock.offset),
        expectedPosition: +expected.toFixed(3),
        actualPosition: +player.getCurrentTime().toFixed(3),
        drift: Math.round(this.drift),
        correctionType: decision.type,
      })
    }
  }

  private isUnstable(): boolean {
    return this.clock.rtt > this.cfg.unstableRttMs || this.clock.jitter > this.cfg.unstableJitterMs
  }

  private sendEnded(itemId: string): void {
    const nowMs = this.now()
    if (this.endedSentFor === itemId && nowMs - this.endedSentAt < this.cfg.trackEndedRetryMs) return
    this.endedSentFor = itemId
    this.endedSentAt = nowMs
    this.deps.onTrackEnded(itemId)
  }

  private sendMetaOnce(): void {
    const track = this.state?.currentTrack
    if (!track || !this.player || this.metaSentFor.has(track.id)) return
    const duration = this.player.getDuration()
    if (!duration) return
    this.metaSentFor.add(track.id)
    if (!track.duration || track.title.startsWith('youtu.be/')) {
      this.deps.onTrackMeta(track.id, this.player.getTitle(), duration)
    }
  }

  private muteForPreroll(): void {
    if (this.player && !this.player.isMuted()) {
      this.player.mute()
      this.mutedByEngine = true
    }
  }

  private restoreMute(): void {
    if (this.mutedByEngine && this.player) this.player.unMute()
    this.mutedByEngine = false
  }

  private onVisibilityChange(): void {
    if (document.visibilityState !== 'visible') return
    this.clock.burst()
    const wait = this.cfg.clockBurstCount * this.cfg.clockBurstSpacingMs + 100
    this.timers.setTimeout(() => this.resync(), wait)
  }

  private setUi(ui: SyncUiState): void {
    this.ui = ui
    this.emit()
  }

  private emit(): void {
    this.deps.onStatus(this.getStatus())
  }

  private log(msg: string, data?: unknown): void {
    if (this.debug) console.debug(`[EchoRoom sync] ${msg}`, data ?? '')
  }
}
