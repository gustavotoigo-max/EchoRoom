import { playerStore } from '../stores/playerStore'
import { applyRoomState, roomStore } from '../stores/roomStore'
import { ClockSync } from '../sync/ClockSync'
import { SyncConfig, isSyncDebug } from '../sync/SyncConfig'
import { SyncEngine } from '../sync/SyncEngine'
import type { RoomState } from '../types/room'
import type { ClockPongPayload, RoomEventPayload, ServerMessage } from '../types/websocket'
import { storage } from '../utils/storage'
import { wsUrl } from './api'
import { WebSocketService } from './websocket/WebSocketService'
import { describeYouTubeError, type LocalPlayerState, type PlayerAdapter } from './youtube/PlayerAdapter'

/**
 * Liga as peças de uma sessão de sala:
 *   WebSocketService ⇄ stores ⇄ SyncEngine ⇄ player
 * Os componentes React chamam apenas as ações expostas aqui.
 */
export class RoomSession {
  readonly ws: WebSocketService
  readonly clock: ClockSync
  readonly engine: SyncEngine
  private unsubs: (() => void)[] = []
  private resyncTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly roomId: string,
    token: string,
    private readonly name: string,
    private readonly participantId: string,
  ) {
    this.ws = new WebSocketService(
      () => wsUrl(roomId, token),
      () => this.onOpen(),
    )
    this.clock = new ClockSync((t1) => this.ws.send('CLOCK_PING', { t1 }))
    this.engine = new SyncEngine({
      clock: this.clock,
      onTrackEnded: (itemId) => this.ws.send('TRACK_ENDED', { itemId }),
      onTrackMeta: (itemId, title, duration) => this.ws.send('TRACK_META', { itemId, title, duration }),
      onStatus: (status) => {
        playerStore.set({ sync: status.ui })
        if (isSyncDebug()) playerStore.set({ metrics: status })
      },
      onPlayerError: (code) => playerStore.set({ playerError: describeYouTubeError(code) }),
    })
  }

  start(): void {
    roomStore.set({ participantId: this.participantId, fatalError: null })
    this.unsubs.push(
      this.ws.onStatus((s) => {
        roomStore.set({ connection: s })
        if (s === 'reconnecting') this.clock.stop()
        if (s === 'unauthorized') {
          storage.clearRoomToken(this.roomId)
          roomStore.set({ fatalError: 'Digite a senha da sala para entrar.' })
        }
        if (s === 'not_found') roomStore.set({ fatalError: 'A sala não existe mais.' })
      }),
      this.ws.on('CLOCK_PONG', (m: ServerMessage<ClockPongPayload>) =>
        this.clock.handlePong(m.payload.t1, m.payload.t2, m.payload.t3),
      ),
      this.ws.on('STATE_SYNC', (m: ServerMessage<RoomEventPayload>) => this.onRoomEvent(m.payload.room, true)),
      this.ws.on('*', (m: ServerMessage<any>) => {
        if (m.type !== 'STATE_SYNC' && m.payload?.room) this.onRoomEvent(m.payload.room as RoomState, false)
      }),
    )
    this.engine.start()
    this.ws.connect()
    if (isSyncDebug()) (window as unknown as Record<string, unknown>).__echoroom = this
  }

  stop(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.engine.stop()
    this.clock.stop()
    this.ws.disconnect()
  }

  // ---- player (vindo do componente YouTubePlayer) -------------------------

  attachPlayer(p: PlayerAdapter): void {
    playerStore.set({ playerReady: true })
    this.engine.attachPlayer(p)
  }
  detachPlayer(): void {
    playerStore.set({ playerReady: false })
    this.engine.detachPlayer()
  }
  handlePlayerState(s: LocalPlayerState): void {
    if (s === 'playing') playerStore.set({ playerError: null })
    this.engine.handlePlayerState(s)
  }
  handlePlayerError(code: number): void {
    this.engine.handlePlayerError(code)
  }

  /** Posição exibida na barra (timeline oficial da sala). */
  getDisplayPosition(): number {
    return roomStore.get().room?.currentTrack ? this.engine.getExpectedPosition() : 0
  }

  // ---- ações do usuário ----------------------------------------------------

  play = () => this.ws.request('PLAYER_PLAY_REQUEST')
  pause = () => this.ws.request('PLAYER_PAUSE_REQUEST')
  seek = (position: number) => this.ws.request('PLAYER_SEEK_REQUEST', { position })
  restart = () => this.seek(0)
  skip = () => this.ws.request('TRACK_SKIP', { currentItemId: roomStore.get().room?.currentTrack?.id ?? null })
  addTrack = (url: string) => this.ws.request('TRACK_ADD', { url })
  removeTrack = (itemId: string) => this.ws.request('TRACK_REMOVE', { itemId })
  moveToTop = (itemId: string) => this.ws.request('TRACK_MOVE', { itemId, toIndex: 0 })

  // ---- internos ---------------------------------------------------------------

  private onOpen(): void {
    this.ws.send('ROOM_JOIN', { participantId: this.participantId, name: this.name })
    this.clock.start() // burst imediato + intervalo
    // Depois que o burst de clock sync terminar, recalcula posição sem histerese.
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.resyncTimer = setTimeout(
      () => this.engine.resync(),
      SyncConfig.clockBurstCount * SyncConfig.clockBurstSpacingMs + 150,
    )
  }

  private onRoomEvent(room: RoomState, full: boolean): void {
    if (applyRoomState(room, full)) this.engine.applyState(room)
  }
}
