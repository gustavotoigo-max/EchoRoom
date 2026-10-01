import { SyncConfig } from '../../sync/SyncConfig'
import type {
  AckPayload,
  ClientEventType,
  ConnectionStatus,
  ErrorPayload,
  ServerMessage,
} from '../../types/websocket'

type Handler = (msg: ServerMessage<any>) => void

/** Códigos de fechamento definidos em backend/app/main.py */
const CLOSE_UNAUTHORIZED = 4401
const CLOSE_NOT_FOUND = 4404

interface PendingRequest {
  resolve: (changed: boolean) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Comunicação WebSocket: conexão, reconexão automática com backoff,
 * request/ACK com timeout. Não contém lógica de sala nem de sincronização.
 */
export class WebSocketService {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private statusHandlers = new Set<(s: ConnectionStatus) => void>()
  private pending = new Map<string, PendingRequest>()
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldRun = false
  private seq = 0
  status: ConnectionStatus = 'idle'

  constructor(
    private readonly urlFactory: () => string,
    private readonly onOpen: () => void,
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.reconnectNow())
    }
  }

  connect(): void {
    this.shouldRun = true
    this.open()
  }

  disconnect(): void {
    this.shouldRun = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: 'ROOM_LEAVE', payload: {} }))
      } catch {
        /* ignorado */
      }
      ws.close()
    }
    this.failPending('Conexão encerrada.')
    this.setStatus('closed')
  }

  reconnectNow(): void {
    if (!this.shouldRun) return
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.attempt = 0
    this.open()
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  onStatus(fn: (s: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(fn)
    return () => this.statusHandlers.delete(fn)
  }

  /** Envio simples (sem confirmação). Retorna false se desconectado. */
  send(type: ClientEventType, payload: Record<string, unknown> = {}, requestId?: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(requestId ? { type, payload, request_id: requestId } : { type, payload }))
    return true
  }

  /** Envio com confirmação do servidor (ACK) ou erro legível (ERROR). */
  request(type: ClientEventType, payload: Record<string, unknown> = {}): Promise<boolean> {
    const requestId = `r${++this.seq}`
    return new Promise((resolve, reject) => {
      if (!this.send(type, payload, requestId)) {
        reject(new Error('Sem conexão com a sala. Tentando reconectar…'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('O servidor não respondeu a tempo.'))
      }, SyncConfig.requestTimeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
    })
  }

  // ---- internos ----------------------------------------------------------

  private open(): void {
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
    }
    this.setStatus(this.attempt === 0 && this.status !== 'reconnecting' ? 'connecting' : 'reconnecting')
    const ws = new WebSocket(this.urlFactory())
    this.ws = ws

    ws.onopen = () => {
      this.attempt = 0
      this.setStatus('connected')
      this.onOpen()
    }

    ws.onmessage = (ev) => {
      let msg: ServerMessage<any>
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'ACK') {
        const p = msg.payload as AckPayload
        const req = this.pending.get(p.request_id)
        if (req) {
          clearTimeout(req.timer)
          this.pending.delete(p.request_id)
          req.resolve(Boolean(p.changed))
        }
      } else if (msg.type === 'ERROR') {
        const p = msg.payload as ErrorPayload
        const req = p.request_id ? this.pending.get(p.request_id) : undefined
        if (req) {
          clearTimeout(req.timer)
          this.pending.delete(p.request_id!)
          req.reject(new Error(p.message))
        }
      }
      this.handlers.get(msg.type)?.forEach((h) => h(msg))
      this.handlers.get('*')?.forEach((h) => h(msg))
    }

    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      this.failPending('Sua conexão com a sala foi perdida.')
      if (ev.code === CLOSE_UNAUTHORIZED) {
        this.shouldRun = false
        this.setStatus('unauthorized')
        return
      }
      if (ev.code === CLOSE_NOT_FOUND) {
        this.shouldRun = false
        this.setStatus('not_found')
        return
      }
      if (!this.shouldRun) {
        this.setStatus('closed')
        return
      }
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting')
    const delay = Math.min(SyncConfig.reconnectMaxMs, SyncConfig.reconnectBaseMs * 2 ** this.attempt)
    this.attempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldRun) this.open()
    }, delay)
  }

  private failPending(message: string): void {
    this.pending.forEach((req) => {
      clearTimeout(req.timer)
      req.reject(new Error(message))
    })
    this.pending.clear()
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return
    this.status = s
    this.statusHandlers.forEach((fn) => fn(s))
  }
}
