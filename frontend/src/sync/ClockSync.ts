import { SyncConfig } from './SyncConfig'

/**
 * Estimativa do relógio do servidor (NTP simplificado).
 *
 *   T1 cliente envia → T2 servidor recebe → T3 servidor responde → T4 cliente recebe
 *   RTT    = (T4 - T1) - (T3 - T2)
 *   offset = ((T2 - T1) + (T3 - T4)) / 2      (servidor - local)
 *
 * Mantém uma janela de amostras e usa a mediana do offset das amostras de
 * menor RTT (as mais confiáveis). Unidades internas: milissegundos.
 */

export interface ClockSample {
  rtt: number
  offset: number
  timestamp: number
}

export type NowFn = () => number

export const highResNow: NowFn = () =>
  typeof performance !== 'undefined' && performance.timeOrigin
    ? performance.timeOrigin + performance.now()
    : Date.now()

export class ClockSync {
  private samples: ClockSample[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private burstTimers: ReturnType<typeof setTimeout>[] = []
  private cachedOffset = 0
  private listeners = new Set<() => void>()
  lastSyncAt = 0

  constructor(
    private readonly sendPing: (t1: number) => void,
    private readonly now: NowFn = highResNow,
    private readonly cfg = SyncConfig,
  ) {}

  localNow(): number {
    return this.now()
  }

  get ready(): boolean {
    return this.samples.length > 0
  }

  /** Offset estimado (servidor - local) em ms. */
  get offset(): number {
    return this.cachedOffset
  }

  /** Melhor RTT recente (ms). */
  get rtt(): number {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) : NaN
  }

  /** Desvio padrão do RTT recente (ms). */
  get jitter(): number {
    if (this.samples.length < 2) return 0
    const rtts = this.samples.map((s) => s.rtt)
    const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length
    return Math.sqrt(rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / rtts.length)
  }

  /** Tempo estimado do servidor, em ms. */
  serverNow(): number {
    return this.now() + this.cachedOffset
  }

  /** Tempo estimado do servidor, em segundos (mesma unidade do RoomState). */
  serverNowSec(): number {
    return this.serverNow() / 1000
  }

  /** Converte um instante do servidor (s) no instante local equivalente (ms). */
  serverSecToLocalMs(serverSec: number): number {
    return serverSec * 1000 - this.cachedOffset
  }

  /** Milissegundos locais até um instante do servidor (s). */
  msUntil(serverSec: number): number {
    return this.serverSecToLocalMs(serverSec) - this.now()
  }

  ping(): void {
    this.sendPing(this.now())
  }

  /** Processa CLOCK_PONG. t1 em ms local; t2/t3 em segundos do servidor. */
  handlePong(t1: number, t2Sec: number, t3Sec: number): ClockSample | null {
    const t4 = this.now()
    if (typeof t1 !== 'number' || !Number.isFinite(t1)) return null
    const t2 = t2Sec * 1000
    const t3 = t3Sec * 1000
    const rtt = Math.max(0, t4 - t1 - (t3 - t2))
    const offset = (t2 - t1 + (t3 - t4)) / 2
    const sample: ClockSample = { rtt, offset, timestamp: t4 }
    this.addSample(sample)
    return sample
  }

  addSample(sample: ClockSample): void {
    this.samples.push(sample)
    const minTs = sample.timestamp - this.cfg.clockSampleMaxAgeMs
    this.samples = this.samples.filter((s) => s.timestamp >= minTs).slice(-this.cfg.clockSampleWindow)
    this.cachedOffset = ClockSync.estimateOffset(this.samples, this.cfg.clockBestSamples)
    this.lastSyncAt = sample.timestamp
    this.listeners.forEach((l) => l())
  }

  static estimateOffset(samples: ClockSample[], best: number): number {
    if (!samples.length) return 0
    const chosen = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, best))
    const offsets = chosen.map((s) => s.offset).sort((a, b) => a - b)
    const mid = Math.floor(offsets.length / 2)
    return offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2
  }

  onUpdate(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Várias medições rápidas: entrada, reconexão, retorno da aba, mudança de rede. */
  burst(count = this.cfg.clockBurstCount): void {
    this.burstTimers.forEach(clearTimeout)
    this.burstTimers = []
    for (let i = 0; i < count; i++) {
      this.burstTimers.push(setTimeout(() => this.ping(), i * this.cfg.clockBurstSpacingMs))
    }
  }

  start(): void {
    this.stop()
    this.burst()
    this.timer = setInterval(() => this.ping(), this.cfg.clockSyncIntervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.burstTimers.forEach(clearTimeout)
    this.burstTimers = []
  }
}
