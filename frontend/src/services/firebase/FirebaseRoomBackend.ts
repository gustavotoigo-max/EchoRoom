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
import { roomStore } from '../../stores/roomStore'
import { applyCommand, CommandError, normalizeRoom, toFirebase, type RoomCommand } from '../../rooms/roomLogic'
import type { ClockSync } from '../../sync/ClockSync'
import { highResNow } from '../../sync/ClockSync'
import { SyncConfig } from '../../sync/SyncConfig'
import type { ConnectionStatus, Participant, RoomDoc, RoomState } from '../../types/room'
import { describeDbError, ensureSignedIn, getDb } from './app'

/** Só aceita avatares do CDN do Discord. */
function safeAvatar(url: unknown): string | null {
  return typeof url === 'string' && /^https:\/\/cdn\.discordapp\.com\//.test(url) ? url : null
}

/** Participantes desconectados somem da lista depois deste tempo. */
const AWAY_VISIBLE_MS = 2 * 60_000

interface ParticipantRecord {
  name?: string
  avatar?: string | null
  lastSeen?: number
  conns?: Record<string, boolean>
}

/**
 * Comunicação da sala via Firebase Realtime Database.
 *
 * - /rooms/{chave}/state         documento oficial (RoomDoc), alterado só por transação
 * - /rooms/{chave}/participants  presença (onDisconnect remove a conexão)
 * - /rooms/{chave}/clock/{id}    pings para estimar o relógio do servidor
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
  status: ConnectionStatus = 'idle'

  constructor(
    readonly roomId: string,
    private readonly roomKey: string,
    private readonly participantId: string,
    private readonly name: string,
    private readonly avatar: string | null,
    private readonly clock: ClockSync,
    private readonly handlers: {
      onState: (room: RoomState) => void
      onStatus: (s: ConnectionStatus) => void
      onConnected: () => void
    },
  ) {}

  async start(): Promise<void> {
    const gen = ++this.generation
    this.setStatus('connecting')
    await ensureSignedIn()
    if (gen !== this.generation) return // parado/reiniciado enquanto entrava
    const db = getDb()
    const base = `rooms/${this.roomKey}`
    this.stateRef = ref(db, `${base}/state`)
    const meRef = ref(db, `${base}/participants/${this.participantId}`)
    const myConnRef = ref(db, `${base}/participants/${this.participantId}/conns/${this.connId}`)

    // Conexão + presença
    this.unsubs.push(
      onValue(ref(db, '.info/connected'), (snap) => {
        if (snap.val() === true) {
          this.everConnected = true
          onDisconnect(myConnRef).remove()
          onDisconnect(ref(db, `${base}/participants/${this.participantId}/lastSeen`)).set(serverTimestamp())
          void update(meRef, { name: this.name, avatar: this.avatar, lastSeen: serverTimestamp() })
          void set(myConnRef, true)
          this.setStatus('connected')
          this.handlers.onConnected()
        } else if (this.everConnected) {
          this.setStatus('reconnecting')
        }
      }),
    )

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
        (err) => {
          roomStore.set({ fatalError: describeDbError(err) })
          this.setStatus('closed')
        },
      ),
    )

    // Participantes
    this.unsubs.push(
      onValue(ref(db, `${base}/participants`), (snap) => {
        this.participantRecords = (snap.val() as Record<string, ParticipantRecord>) ?? {}
        this.refreshParticipants()
      }),
    )
    const pruneTimer = setInterval(() => this.refreshParticipants(), 30_000)
    this.unsubs.push(() => clearInterval(pruneTimer))
  }

  stop(): void {
    this.generation++
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    if (this.stateRef) {
      const db = getDb()
      const base = `rooms/${this.roomKey}/participants/${this.participantId}`
      void set(ref(db, `${base}/conns/${this.connId}`), null)
      void update(ref(db, base), { lastSeen: serverTimestamp() })
    }
    this.setStatus('closed')
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
          const next = applyCommand(doc, cmd, this.clock.serverNowSec())
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

  // ---- internos ---------------------------------------------------------------

  private refreshParticipants(): void {
    const now = this.clock.serverNow()
    const list: Participant[] = []
    for (const [id, p] of Object.entries(this.participantRecords)) {
      const connected = !!p.conns && Object.keys(p.conns).length > 0
      if (!connected && (!p.lastSeen || now - p.lastSeen > AWAY_VISIBLE_MS)) continue
      list.push({ id, name: p.name || 'Convidado', connected, avatar: safeAvatar(p.avatar) })
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

