import { playerStore } from '../stores/playerStore'
import { applyRoomState, roomStore } from '../stores/roomStore'
import { CommandError, type RoomCommand } from '../rooms/roomLogic'
import { ClockSync } from '../sync/ClockSync'
import { SyncConfig, isSyncDebug } from '../sync/SyncConfig'
import { SyncEngine } from '../sync/SyncEngine'
import type { RoomState } from '../types/room'
import { extractVideoId } from '../utils/youtubeUrlParser'
import { FirebaseRoomBackend } from './firebase/FirebaseRoomBackend'
import { fetchVideoMeta, thumbnailUrl } from './youtube/metadata'
import { describeYouTubeError, type LocalPlayerState, type PlayerAdapter } from './youtube/PlayerAdapter'

/**
 * Liga as peças de uma sessão de sala:
 *   Firebase (FirebaseRoomBackend) ⇄ stores ⇄ SyncEngine ⇄ player
 * Os componentes React chamam apenas as ações expostas aqui.
 */
export class RoomSession {
  readonly backend: FirebaseRoomBackend
  readonly clock: ClockSync
  readonly engine: SyncEngine
  private resyncTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    readonly roomId: string,
    roomKey: string,
    private readonly name: string,
    private readonly participantId: string,
  ) {
    this.clock = new ClockSync((t1) => void this.backend.clockPing(t1))
    this.backend = new FirebaseRoomBackend(roomId, roomKey, participantId, name, this.clock, {
      onState: (room) => this.onRoomState(room),
      onStatus: (s) => {
        roomStore.set({ connection: s })
        if (s === 'reconnecting') this.clock.stop()
        if (s === 'not_found') roomStore.set({ fatalError: 'A sala não existe mais.' })
      },
      onConnected: () => this.onConnected(),
    })
    this.engine = new SyncEngine({
      clock: this.clock,
      onTrackEnded: (itemId) => this.fire({ type: 'TRACK_ENDED', itemId }),
      onTrackMeta: (itemId, title, duration) => this.fire({ type: 'TRACK_META', itemId, title, duration }),
      onStatus: (status) => {
        playerStore.set({ sync: status.ui })
        if (isSyncDebug()) playerStore.set({ metrics: status })
      },
      onPlayerError: (code) => playerStore.set({ playerError: describeYouTubeError(code) }),
    })
  }

  start(): void {
    roomStore.set({ participantId: this.participantId, fatalError: null })
    this.engine.start()
    this.backend.start().catch((err: Error) => roomStore.set({ fatalError: err.message, connection: 'closed' }))
    if (isSyncDebug()) (window as unknown as Record<string, unknown>).__echoroom = this
  }

  stop(): void {
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.engine.stop()
    this.clock.stop()
    this.backend.stop()
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

  play = () => this.backend.command({ type: 'PLAY' })
  pause = () => this.backend.command({ type: 'PAUSE' })
  seek = (position: number) => this.backend.command({ type: 'SEEK', position })
  restart = () => this.seek(0)
  skip = () =>
    this.backend.command({ type: 'TRACK_SKIP', currentItemId: roomStore.get().room?.currentTrack?.id ?? null })
  removeTrack = (itemId: string) => this.backend.command({ type: 'TRACK_REMOVE', itemId })
  moveToTop = (itemId: string) => this.backend.command({ type: 'TRACK_MOVE', itemId, toIndex: 0 })

  addTrack = async (url: string) => {
    const videoId = extractVideoId(url)
    if (!videoId) throw new CommandError('Link do YouTube inválido. Use youtube.com/watch?v=…, youtu.be/… ou /shorts/….')
    const meta = await fetchVideoMeta(videoId)
    return this.backend.command({
      type: 'TRACK_ADD',
      item: {
        id: Math.random().toString(36).slice(2, 14),
        videoId,
        title: meta.title,
        author: meta.author,
        thumbnail: thumbnailUrl(videoId),
        addedBy: this.name,
        titleResolved: meta.resolved,
      },
    })
  }

  // ---- internos ---------------------------------------------------------------

  private fire(cmd: RoomCommand): void {
    this.backend.command(cmd).catch(() => {
      /* comandos automáticos: falhas são reenviadas pelo próprio engine */
    })
  }

  private onConnected(): void {
    this.clock.start() // burst imediato + intervalo
    // Depois do burst de clock sync, recalcula a posição sem histerese.
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.resyncTimer = setTimeout(
      () => this.engine.resync(),
      SyncConfig.clockBurstCount * SyncConfig.clockBurstSpacingMs + 400,
    )
  }

  private onRoomState(room: RoomState): void {
    if (applyRoomState(room)) this.engine.applyState(room)
  }
}
