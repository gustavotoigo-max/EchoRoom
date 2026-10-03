import {
  get,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type DatabaseReference,
} from 'firebase/database'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { applyCommand, CommandError, normalizeRoom, toFirebase, type RoomCommand } from '../../rooms/roomLogic'
import type { ClockSync } from '../../sync/ClockSync'
import { highResNow } from '../../sync/ClockSync'
import { SyncConfig } from '../../sync/SyncConfig'
import {
  normalizeSettings,
  type ConnectionStatus,
  type Participant,
  type RoomDoc,
  type RoomMeta,
  type RoomState,
} from '../../types/room'
import { describeDbError, ensureSignedIn, getDb, isDiscordUid, isPermissionDenied } from './app'
import { explainAccessDenied } from './roomsApi'

/** Só aceita avatares do CDN do Discord. */
function safeAvatar(url: unknown): string | null {
  return typeof url === 'string' && /^https:\/\/cdn\.discordapp\.com\//.test(url) ? url : null
}

/** Presença e inatividade (tempos em ms). */
export const PresenceConfig = {
  /** Desconectados aparecem como "Desconectado" por este tempo e depois somem. */
  awayVisibleMs: 10 * 60_000,
  /** Cada aba aberta confirma que está viva neste intervalo… */
  heartbeatMs: 60_000,
  /** …e conta como desconectada se ficar este tempo sem confirmar (aba congelada, rede caiu). */
  staleMs: 3 * 60_000,
  /** Sem nenhuma interação de ninguém por este tempo: pausa e libera a lista. */
  idleMs: 60 * 60_000,
  /** Interações são publicadas no máximo uma vez neste intervalo. */
  activityPublishMs: 60_000,
}

interface ParticipantRecord {
  name?: string
  avatar?: string | null
  lastSeen?: number
  /** Última confirmação de que a aba está aberta. */
  beat?: number
  /** Última interação da pessoa com a sala. */
  activeAt?: number
  conns?: Record<string, boolean>
}

/**
 * Comunicação da sala via Firebase Realtime Database.
 *
 * - /rooms/{chave}/state          documento oficial (RoomDoc), alterado só por transação
 * - /rooms/{chave}/meta           nome e dono
 * - /rooms/{chave}/settings       configurações (só o dono altera)
 * - /rooms/{chave}/participants   presença: conexões (onDisconnect remove), beat (aba viva),
 *                                 activeAt (última interação, base da pausa por inatividade)
 * - /rooms/{chave}/members/{uid}  quem já entrou (base para convites)
 * - /rooms/{chave}/banned, kicks  moderação do dono
 * - /rooms/{chave}/votes/{item}   votos para pular
 * - /rooms/{chave}/clock/{uid}    pings para estimar o relógio do servidor
 *
 * O id do participante é o uid do Firebase: as regras do banco conferem que
 * cada um só escreve a própria presença, voto e cadastro.
 *
 * Não contém regra de sala (rooms/roomLogic) nem lógica de sync (sync/).
 */
export class FirebaseRoomBackend {
  private unsubs: (() => void)[] = []
  private stateRef!: DatabaseReference
  private doc: RoomDoc | null = null
  private participants: Participant[] = []
  private participantRecords: Record<string, ParticipantRecord> = {}
  private connId = Math.random().toString(36).slice(2, 10)
  private everConnected = false
  private generation = 0
  private participantId = ''
  private joinedAt = 0
  private votesUnsub: (() => void) | null = null
  private votesItem: string | null = null
  private recordedMembership = false
  /** Saiu da lista por inatividade (até clicar em "Voltar"). */
  private idle = false
  private lastActivity = Date.now()
  private lastActivityPublished = 0
  status: ConnectionStatus = 'idle'

  constructor(
    readonly roomId: string,
    readonly roomKey: string,
    private readonly name: string,
    private readonly avatar: string | null,
    private readonly clock: ClockSync,
    private readonly handlers: {
      onState: (room: RoomState) => void
      onStatus: (s: ConnectionStatus) => void
      onConnected: () => void
      onIdentity: (uid: string) => void
      /** A sala ficou inativa (true) ou a pessoa voltou (false). */
      onIdle: (idle: boolean) => void
      /** Removido pelo dono, bloqueado ou sem permissão: a sessão deve acabar. */
      onRemoved: (message: string) => void
    },
  ) {}

  get uid(): string {
    return this.participantId
  }

  async start(): Promise<void> {
    const gen = ++this.generation
    this.setStatus('connecting')
    const uid = await ensureSignedIn()
    if (gen !== this.generation) return // parado/reiniciado enquanto entrava
    this.participantId = uid
    this.handlers.onIdentity(uid)
    const db = getDb()
    const base = `rooms/${this.roomKey}`
    this.stateRef = ref(db, `${base}/state`)

    // Cadastro na sala (antes de tudo: falha aqui = bloqueado ou sala só para Discord).
    this.joinedAt = Date.now()
    try {
      await update(ref(db, `${base}/members/${uid}`), {
        name: this.name.slice(0, 32),
        avatar: this.avatar,
        guest: !isDiscordUid(uid),
        lastAt: serverTimestamp(),
      })
    } catch (err) {
      if (gen !== this.generation) return
      return this.fail(err)
    }
    if (gen !== this.generation) return
    // Conexão + presença
    this.lastActivity = Date.now()
    this.unsubs.push(
      onValue(ref(db, '.info/connected'), (snap) => {
        if (snap.val() === true) {
          this.everConnected = true
          if (!this.idle) this.joinPresence()
          this.setStatus('connected')
          this.handlers.onConnected()
        } else if (this.everConnected) {
          this.setStatus('reconnecting')
        }
      }),
    )

    // Aba fechada: sai da lista na hora (o onDisconnect do servidor é o reforço).
    const onHide = () => this.leavePresence()
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted && !this.idle && this.status === 'connected') this.joinPresence()
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    this.unsubs.push(() => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
    })

    // Estimativa inicial do relógio (o Firebase calcula ao conectar).
    this.unsubs.push(
      onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
        const offset = Number(snap.val()) || 0
        // RTT alto de propósito: amostras de ping (mais precisas) têm prioridade.
        this.clock.addSample({ rtt: 250, offset: Date.now() + offset - highResNow(), timestamp: highResNow() })
      }),
    )

    // Estado oficial
    this.unsubs.push(
      onValue(
        this.stateRef,
        (snap) => {
          const doc = normalizeRoom(snap.val(), this.roomId)
          if (!doc) {
            this.setStatus('not_found')
            return
          }
          this.doc = doc
          this.emit()
        },
        (err) => this.fail(err),
      ),
    )

    // Participantes
    this.unsubs.push(
      onValue(ref(db, `${base}/participants`), (snap) => {
        this.participantRecords = (snap.val() as Record<string, ParticipantRecord>) ?? {}
        this.refreshParticipants()
      }),
    )

    // Nome e dono
    this.unsubs.push(
      onValue(ref(db, `${base}/meta`), (snap) => {
        const m = (snap.val() ?? {}) as Partial<RoomMeta>
        const meta: RoomMeta = {
          roomId: this.roomId,
          name: typeof m.name === 'string' && m.name.trim() ? m.name : `Sala ${this.roomId}`,
          ownerUid: typeof m.ownerUid === 'string' ? m.ownerUid : null,
          ownerName: typeof m.ownerName === 'string' ? m.ownerName : '',
          createdAt: Number(m.createdAt) || 0,
        }
        roomStore.set({ meta })
        this.recordMembership(meta)
      }),
    )

    // Configurações
    this.unsubs.push(
      onValue(ref(db, `${base}/settings`), (snap) => roomStore.set({ settings: normalizeSettings(snap.val()) })),
    )

    // Bloqueados (lista exibida nas configurações)
    this.unsubs.push(
      onValue(ref(db, `${base}/banned`), (snap) => {
        const v = (snap.val() ?? {}) as Record<string, { name?: string }>
        roomStore.set({ banned: Object.fromEntries(Object.entries(v).map(([k, b]) => [k, b?.name || 'Alguém'])) })
      }),
    )

    // Removido pelo dono
    this.unsubs.push(
      onValue(ref(db, `${base}/kicks/${uid}`), (snap) => {
        const at = Number(snap.val())
        if (at && at > this.joinedAt - 5000 + (this.clock.serverNow() - Date.now())) {
          void set(ref(db, `${base}/kicks/${uid}`), null).catch(() => {})
          this.handlers.onRemoved('O dono te removeu da sala.')
        }
      }),
    )
    const pruneTimer = setInterval(() => {
      this.refreshParticipants()
      this.checkIdle()
    }, 30_000)
    const beatTimer = setInterval(() => {
      if (this.status === 'connected' && !this.idle) void update(this.meRef(), { beat: serverTimestamp() }).catch(() => {})
    }, PresenceConfig.heartbeatMs)
    this.unsubs.push(() => {
      clearInterval(pruneTimer)
      clearInterval(beatTimer)
    })
  }

  stop(): void {
    this.generation++
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.votesUnsub?.()
    this.votesUnsub = null
    this.votesItem = null
    if (this.stateRef && !this.idle) this.leavePresence()
    this.setStatus('closed')
  }

  // ---- presença e inatividade ------------------------------------------------

  private meRef(): DatabaseReference {
    return ref(getDb(), `rooms/${this.roomKey}/participants/${this.participantId}`)
  }

  private joinPresence(): void {
    const me = this.meRef()
    const db = getDb()
    const base = `rooms/${this.roomKey}/participants/${this.participantId}`
    onDisconnect(ref(db, `${base}/conns/${this.connId}`)).remove()
    onDisconnect(ref(db, `${base}/lastSeen`)).set(serverTimestamp())
    this.lastActivityPublished = Date.now()
    void update(me, {
      name: this.name,
      avatar: this.avatar,
      lastSeen: serverTimestamp(),
      beat: serverTimestamp(),
      activeAt: serverTimestamp(),
      [`conns/${this.connId}`]: true,
    }).catch(() => {})
  }

  private leavePresence(): void {
    const db = getDb()
    const base = `rooms/${this.roomKey}/participants/${this.participantId}`
    void update(ref(db, base), { [`conns/${this.connId}`]: null, lastSeen: serverTimestamp() }).catch(() => {})
  }

  /** Clique, tecla, rolagem ou comando: a sala está em uso. */
  noteActivity(): void {
    this.lastActivity = Date.now()
    if (this.idle || this.status !== 'connected') return
    if (Date.now() - this.lastActivityPublished < PresenceConfig.activityPublishMs) return
    this.lastActivityPublished = Date.now()
    void update(this.meRef(), { activeAt: serverTimestamp() }).catch(() => {})
  }

  /** Última interação de qualquer pessoa (hora do servidor). */
  private lastRoomActivity(): number {
    const mine = this.clock.serverNow() - (Date.now() - this.lastActivity)
    let last = mine
    for (const p of Object.values(this.participantRecords)) {
      if (typeof p.activeAt === 'number' && p.activeAt > last) last = p.activeAt
    }
    return last
  }

  private checkIdle(): void {
    if (this.idle || this.status !== 'connected') return
    if (this.clock.serverNow() - this.lastRoomActivity() < PresenceConfig.idleMs) return
    this.idle = true
    // Sai da lista por completo (sem deixar "Desconectado").
    const db = getDb()
    const base = `rooms/${this.roomKey}/participants/${this.participantId}`
    void onDisconnect(ref(db, `${base}/conns/${this.connId}`)).cancel()
    void onDisconnect(ref(db, `${base}/lastSeen`)).cancel()
    void set(this.meRef(), null).catch(() => {})
    this.handlers.onIdle(true)
  }

  /** Voltou depois da pausa por inatividade. */
  resumeFromIdle(): void {
    this.lastActivity = Date.now()
    if (!this.idle) return
    this.idle = false
    if (this.status === 'connected') this.joinPresence()
    this.handlers.onIdle(false)
  }

  /** Executa um comando como transação. Resolve true se algo mudou. */
  async command(cmd: RoomCommand): Promise<boolean> {
    if (!this.stateRef) throw new Error('Ainda conectando à sala…')
    let failure: unknown = null
    const run = runTransaction(
      this.stateRef,
      (raw) => {
        if (raw === null) return null // cache vazio: o Firebase repete com o valor do servidor
        failure = null
        const doc = normalizeRoom(raw, this.roomId)
        if (!doc) return undefined
        try {
          const st = roomStore.get()
          const next = applyCommand(doc, cmd, this.clock.serverNowSec(), {
            uid: this.participantId,
            isOwner: selectIsOwner(st),
            settings: st.settings,
          })
          return next ? toFirebase(next) : undefined
        } catch (err) {
          failure = err
          return undefined
        }
      },
      { applyLocally: false },
    )
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('O Firebase não respondeu a tempo. Verifique a conexão.')), SyncConfig.requestTimeoutMs),
    )
    try {
      const res = await Promise.race([run, timeout])
      if (failure) throw failure
      return res.committed
    } catch (err) {
      if (err instanceof CommandError) throw err
      throw new Error(describeDbError(err))
    }
  }

  /**
   * Ping de relógio: grava o timestamp do servidor e lê de volta.
   *   offset ≈ servidor - (t1 + tAck) / 2,  rtt = tAck - t1
   */
  async clockPing(t1: number): Promise<void> {
    if (!this.stateRef || this.status !== 'connected') return
    const pingRef = ref(getDb(), `rooms/${this.roomKey}/clock/${this.participantId}`)
    try {
      await set(pingRef, serverTimestamp())
      const tAck = highResNow()
      const serverMs = Number((await get(pingRef)).val())
      if (!serverMs) return
      this.clock.addSample({ rtt: tAck - t1, offset: serverMs - (t1 + tAck) / 2, timestamp: tAck })
    } catch {
      /* amostra perdida: segue com as anteriores */
    }
  }

  // ---- votação para pular -------------------------------------------------------

  async vote(itemId: string, on: boolean): Promise<void> {
    await set(ref(getDb(), `rooms/${this.roomKey}/votes/${itemId}/${this.participantId}`), on ? true : null)
  }

  /** Acompanha os votos da música atual (troca a assinatura quando a música muda). */
  private watchVotes(itemId: string | null): void {
    if (itemId === this.votesItem) return
    this.votesUnsub?.()
    this.votesUnsub = null
    this.votesItem = itemId
    roomStore.set({ votes: { itemId, voters: [] } })
    if (!itemId) return
    this.votesUnsub = onValue(ref(getDb(), `rooms/${this.roomKey}/votes/${itemId}`), (snap) => {
      const voters = Object.keys((snap.val() ?? {}) as Record<string, true>)
      roomStore.set({ votes: { itemId, voters } })
    })
    // O dono limpa votos de músicas antigas.
    if (selectIsOwner(roomStore.get())) {
      void get(ref(getDb(), `rooms/${this.roomKey}/votes`))
        .then((snap) => {
          const old = Object.keys((snap.val() ?? {}) as object).filter((k) => k !== itemId)
          if (old.length) return update(ref(getDb(), `rooms/${this.roomKey}/votes`), Object.fromEntries(old.map((k) => [k, null])))
        })
        .catch(() => {})
    }
  }

  // ---- internos ---------------------------------------------------------------

  /** Guarda a sala no perfil de quem entrou com Discord (lista "Minhas salas"). */
  private recordMembership(meta: RoomMeta): void {
    if (!isDiscordUid(this.participantId)) return
    const db = getDb()
    const entry = {
      key: this.roomKey,
      name: meta.name.slice(0, 60),
      role: meta.ownerUid === this.participantId ? 'owner' : 'member',
      lastAt: serverTimestamp(),
    }
    if (this.recordedMembership) {
      // Só atualiza nome/papel se mudarem.
      void update(ref(db, `users/${this.participantId}/rooms/${this.roomId}`), { name: entry.name, role: entry.role }).catch(() => {})
      return
    }
    this.recordedMembership = true
    void update(ref(db, `users/${this.participantId}/rooms/${this.roomId}`), entry).catch(() => {})
  }

  private async fail(err: unknown): Promise<void> {
    if (isPermissionDenied(err)) {
      const why = await explainAccessDenied(this.roomKey).catch(() => null)
      if (why) {
        this.handlers.onRemoved(why)
        this.setStatus('closed')
        return
      }
    }
    roomStore.set({ fatalError: describeDbError(err) })
    this.setStatus('closed')
  }

  private refreshParticipants(): void {
    const now = this.clock.serverNow()
    const list: Participant[] = []
    for (const [id, p] of Object.entries(this.participantRecords)) {
      // Conectado = tem aba aberta e ela confirmou presença há pouco
      // (uma aba congelada ou sem rede deixa de confirmar).
      const connected =
        !!p.conns && Object.keys(p.conns).length > 0 && typeof p.beat === 'number' && now - p.beat < PresenceConfig.staleMs
      const seen = Math.max(p.lastSeen ?? 0, p.beat ?? 0)
      if (!connected && (!seen || now - seen > PresenceConfig.awayVisibleMs)) continue
      list.push({ id, name: p.name || 'Convidado', connected, avatar: safeAvatar(p.avatar), guest: !isDiscordUid(id) })
    }
    list.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
    const same =
      list.length === this.participants.length &&
      list.every((p, i) => p.id === this.participants[i].id && p.connected === this.participants[i].connected && p.name === this.participants[i].name && p.avatar === this.participants[i].avatar)
    if (same) return
    this.participants = list
    const room = roomStore.get().room
    if (room) roomStore.set({ room: { ...room, participants: list } })
    else this.emit()
  }

  private emit(): void {
    if (!this.doc) return
    this.watchVotes(this.doc.currentTrack?.id ?? null)
    const room: RoomState = {
      ...this.doc,
      currentVideoId: this.doc.currentTrack?.videoId ?? null,
      participants: this.participants,
    }
    this.handlers.onState(room)
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return
    this.status = s
    this.handlers.onStatus(s)
  }
}

