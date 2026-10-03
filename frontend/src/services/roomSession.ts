import { playerStore } from '../stores/playerStore'
import { applyRoomState, roomStore, selectIsOwner, validVotes, votesNeeded } from '../stores/roomStore'
import { CommandError, queueCapacity, withoutDuplicates, type RoomCommand } from '../rooms/roomLogic'
import { ClockSync } from '../sync/ClockSync'
import { SyncConfig, isSyncDebug } from '../sync/SyncConfig'
import { SyncEngine } from '../sync/SyncEngine'
import { dismissToast, showToast } from '../stores/toastStore'
import type { QueueItem, RoomState } from '../types/room'
import { formatTime } from '../utils/format'
import { storage } from '../utils/storage'
import { parseYouTubeLink } from '../utils/youtubeUrlParser'
import { consumePendingAdd, setActiveSession } from './externalAdd'
import { FirebaseRoomBackend } from './firebase/FirebaseRoomBackend'
import { fixTrackTitle, recordPlaylist, recordTrack } from './firebase/library'
import { fetchManyVideoMeta, fetchPlaylistTitle, fetchVideoMeta, thumbnailUrl } from './youtube/metadata'
import { loadPlaylistVideoIds } from './youtube/playlist'
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
  private player: PlayerAdapter | null = null
  private gotFirstState = false
  private errorSkipTimer: ReturnType<typeof setTimeout> | null = null
  private unsubStore: (() => void) | null = null
  private voteSkipFiredFor: string | null = null

  constructor(
    readonly roomId: string,
    roomKey: string,
    private readonly name: string,
    avatar: string | null = null,
  ) {
    this.clock = new ClockSync((t1) => void this.backend.clockPing(t1))
    this.backend = new FirebaseRoomBackend(roomId, roomKey, name, avatar, this.clock, {
      onIdentity: (uid) => roomStore.set({ participantId: uid }),
      onRemoved: (message) => {
        roomStore.set({ removedReason: message })
        void import('./firebase/social').then((m) => m.forgetMyRoom(roomId)).catch(() => {})
      },
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
      onTrackMeta: (itemId, title, duration) => {
        this.fire({ type: 'TRACK_META', itemId, title, duration })
        const videoId = roomStore.get().room?.currentTrack?.videoId
        if (title && videoId) void fixTrackTitle(this.backend.roomKey, videoId, title)
      },
      onStatus: (status) => {
        playerStore.set({ sync: status.ui })
        if (isSyncDebug()) playerStore.set({ metrics: status })
      },
      onPlayerError: (code) => this.onPlayerError(code),
      isUserMuted: () => playerStore.get().muted,
      onNeedsGesture: (needed) => playerStore.set({ needsGesture: needed }),
    })
  }

  start(): void {
    roomStore.set({ fatalError: null, removedReason: null })
    this.unsubStore = roomStore.subscribe(() => this.checkVotes())
    this.engine.start()
    this.backend.start().catch((err: Error) => roomStore.set({ fatalError: err.message, connection: 'closed' }))
    setActiveSession(this)
    storage.setLastRoom(this.roomId)
    if (isSyncDebug()) (window as unknown as Record<string, unknown>).__echoroom = this
  }

  stop(): void {
    setActiveSession(null)
    this.unsubStore?.()
    this.unsubStore = null
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    if (this.errorSkipTimer) clearTimeout(this.errorSkipTimer)
    playerStore.set({ needsGesture: false })
    this.engine.stop()
    this.clock.stop()
    this.backend.stop()
  }

  // ---- player (vindo do componente YouTubePlayer) -------------------------

  attachPlayer(p: PlayerAdapter): void {
    this.player = p
    playerStore.set({ playerReady: true })
    this.applyVolume()
    this.engine.attachPlayer(p)
  }
  detachPlayer(): void {
    this.player = null
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

  /** Clique no aviso "Clique para ouvir": libera o som bloqueado pelo navegador. */
  unlockAudio = () => {
    playerStore.set({ needsGesture: false })
    this.applyVolume()
    this.engine.unlockAudio()
  }

  /** Posição exibida na barra (timeline oficial da sala). */
  getDisplayPosition(): number {
    return roomStore.get().room?.currentTrack ? this.engine.getExpectedPosition() : 0
  }

  // ---- volume local (não vai para a sala) ----------------------------------

  setVolume = (volume: number) => {
    const v = Math.max(0, Math.min(100, Math.round(volume)))
    // Mexer no volume tira do mudo; arrastar até 0 equivale a mudo.
    playerStore.set({ volume: v, muted: v === 0 })
    storage.setVolume(v)
    storage.setMuted(v === 0)
    this.applyVolume()
  }

  toggleMute = () => {
    const { muted, volume } = playerStore.get()
    const next = !muted
    // Desmutar com volume 0 volta para um volume audível.
    if (!next && volume === 0) {
      playerStore.set({ volume: 50 })
      storage.setVolume(50)
    }
    playerStore.set({ muted: next })
    storage.setMuted(next)
    this.applyVolume()
  }

  private applyVolume(): void {
    const p = this.player
    if (!p) return
    const { volume, muted } = playerStore.get()
    try {
      p.setVolume(volume)
      if (muted) p.mute()
      else p.unMute()
    } catch {
      /* player ainda carregando */
    }
  }

  // ---- ações do usuário ----------------------------------------------------

  play = () => this.backend.command({ type: 'PLAY' })
  pause = () => this.backend.command({ type: 'PAUSE' })
  seek = (position: number) => this.backend.command({ type: 'SEEK', position })
  restart = () => this.seek(0)
  skip = () =>
    this.backend.command({ type: 'TRACK_SKIP', currentItemId: roomStore.get().room?.currentTrack?.id ?? null })
  /** Votar (ou tirar o voto) para pular a música atual. */
  toggleVoteSkip = async () => {
    const st = roomStore.get()
    const itemId = st.room?.currentTrack?.id
    if (!itemId) return
    const mine = st.votes.itemId === itemId && st.votes.voters.includes(st.participantId)
    await this.backend.vote(itemId, !mine)
  }

  /** Quem completa a votação dispara o pulo (a transação garante um só pulo). */
  private checkVotes(): void {
    const st = roomStore.get()
    const itemId = st.room?.currentTrack?.id
    if (!st.settings.voteSkip || !itemId || this.voteSkipFiredFor === itemId) return
    const votes = validVotes(st)
    if (!votes.includes(st.participantId) || votes.length < votesNeeded(st)) return
    this.voteSkipFiredFor = itemId
    this.fire({ type: 'TRACK_SKIP', currentItemId: itemId, reason: 'vote' })
  }

  get isOwner(): boolean {
    return selectIsOwner(roomStore.get())
  }

  removeTrack = (itemId: string) => this.backend.command({ type: 'TRACK_REMOVE', itemId })
  moveToTop = (itemId: string) => this.backend.command({ type: 'TRACK_MOVE', itemId, toIndex: 0 })
  moveTrack = (itemId: string, toIndex: number) => this.backend.command({ type: 'TRACK_MOVE', itemId, toIndex })

  /**
   * Adiciona um link do YouTube: vídeo, ou playlist inteira quando o link é
   * de playlist (ou quando `wholePlaylist` é pedido para um watch?v=…&list=…).
   * Retorna quantas músicas entraram e o título (ou nome) adicionado.
   */
  addTrack = async (
    url: string,
    opts: { title?: string; playlistTitle?: string; wholePlaylist?: boolean; onProgress?: (text: string) => void } = {},
  ): Promise<{ added: number; skipped: number; repeated?: number; title: string }> => {
    const link = parseYouTubeLink(url)
    if (link.kind === 'invalid') {
      throw new CommandError('Link do YouTube inválido. Use um link de vídeo, de shorts ou de playlist.')
    }
    if (link.kind === 'playlist' || (opts.wholePlaylist && link.playlistId)) {
      const playlistId = link.kind === 'playlist' ? link.playlistId : link.playlistId!
      const startAt = link.kind === 'video' ? link.videoId : null
      return this.addPlaylist(playlistId, startAt, opts.onProgress, link.kind === 'playlist' ? opts.title ?? opts.playlistTitle : opts.playlistTitle)
    }
    // Aviso rápido de repetida (a transação confere de novo).
    const room = roomStore.get().room
    if (room?.currentTrack?.videoId === link.videoId) throw new CommandError('Essa música já está tocando.')
    if (room?.queue.some((q) => q.videoId === link.videoId)) throw new CommandError('Essa música já está na fila.')
    const meta = await fetchVideoMeta(link.videoId)
    const title = meta.resolved ? meta.title : opts.title?.trim() || meta.title
    await this.backend.command({
      type: 'TRACK_ADD',
      item: this.makeItem(link.videoId, { ...meta, title, resolved: meta.resolved || !!opts.title }),
    })
    void recordTrack(this.backend.roomKey, link.videoId, title, meta.author, this.name)
    return { added: 1, skipped: 0, title }
  }

  private async addPlaylist(
    playlistId: string,
    startAtVideoId: string | null,
    onProgress?: (text: string) => void,
    knownTitle?: string,
  ): Promise<{ added: number; skipped: number; repeated: number; title: string }> {
    onProgress?.('Lendo a playlist…')
    const titlePromise = knownTitle ? Promise.resolve(knownTitle) : fetchPlaylistTitle(playlistId)
    let ids = await loadPlaylistVideoIds(playlistId)
    const fullSize = ids.length
    const firstVideoId = ids[0]
    if (startAtVideoId) {
      const i = ids.indexOf(startAtVideoId)
      if (i > 0) ids = ids.slice(i)
    }
    const room = roomStore.get().room
    const before = ids.length
    if (room) ids = withoutDuplicates(room, ids.map((videoId) => ({ videoId }))).map((x) => x.videoId)
    const repeated = before - ids.length
    if (!ids.length) throw new CommandError('Todas as músicas dessa playlist já estão na fila.')
    const total = ids.length
    const capacity = room ? queueCapacity(room) : total
    if (capacity <= 0) throw new CommandError('A fila atingiu o limite de músicas.')
    ids = ids.slice(0, capacity)
    const metas = await fetchManyVideoMeta(ids, (done, n) => onProgress?.(`Buscando títulos… ${done}/${n}`))
    onProgress?.('Adicionando à fila…')
    await this.backend.command({
      type: 'TRACK_ADD_MANY',
      items: ids.map((id, i) => this.makeItem(id, metas[i])),
    })
    const name = (await titlePromise) || `Playlist de ${metas[0]?.resolved ? metas[0].title : `${fullSize} músicas`}`
    void recordPlaylist(this.backend.roomKey, playlistId, name, fullSize, firstVideoId, this.name)
    return { added: ids.length, skipped: total - ids.length, repeated, title: name }
  }

  private makeItem(videoId: string, meta: { title: string; author: string; resolved: boolean }): QueueItem {
    return {
      id: Math.random().toString(36).slice(2, 14),
      videoId,
      title: meta.title,
      author: meta.author,
      thumbnail: thumbnailUrl(videoId),
      addedBy: this.name,
      addedByUid: this.backend.uid,
      titleResolved: meta.resolved,
    }
  }

  /** Música enviada pela extensão do Chrome (ou ?add= na URL). */
  addFromExternal = async (url: string, title?: string) => {
    const toastId = showToast(title ? `Adicionando "${title}"…` : 'Adicionando música da extensão…', 'info', 0)
    try {
      const res = await this.addTrack(url, { title })
      dismissToast(toastId)
      showToast(
        res.added > 1 ? `${res.added} músicas da playlist adicionadas à fila.` : `"${res.title}" adicionada à fila.`,
        'ok',
      )
    } catch (err) {
      dismissToast(toastId)
      showToast((err as Error).message || 'Não foi possível adicionar a música.', 'error')
    }
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
    if (!this.gotFirstState) {
      this.gotFirstState = true
      this.onFirstState(room)
    }
  }

  /** Primeiro estado recebido: avisa se a sala já está tocando e aplica música pendente. */
  private onFirstState(room: RoomState): void {
    if (room.playbackState === 'playing' && room.currentTrack) {
      const pos = this.engine.getExpectedPosition(room)
      showToast(
        `A sala já está tocando "${room.currentTrack.title}". Você entrou em ${formatTime(pos)} e vai ouvir junto com os outros a partir daqui.`,
        'info',
        8000,
      )
    }
    const pending = consumePendingAdd()
    if (pending) void this.addFromExternal(pending.url, pending.title)
  }

  private onPlayerError(code: number): void {
    // Vídeo indisponível (removido, privado, sem incorporação): pula sozinho.
    // Todos os navegadores tentam; a transação garante que só uma música é pulada.
    const autoSkip = [2, 100, 101, 150].includes(code)
    playerStore.set({
      playerError: `${describeYouTubeError(code)} ${autoSkip ? 'Pulando para a próxima…' : 'Use “Próxima” para pular.'}`,
    })
    if (!autoSkip) return
    const itemId = roomStore.get().room?.currentTrack?.id ?? null
    if (!itemId) return
    if (this.errorSkipTimer) clearTimeout(this.errorSkipTimer)
    this.errorSkipTimer = setTimeout(() => {
      if (roomStore.get().room?.currentTrack?.id === itemId) this.fire({ type: 'TRACK_SKIP', currentItemId: itemId, reason: 'error' })
    }, 2500)
  }
}
