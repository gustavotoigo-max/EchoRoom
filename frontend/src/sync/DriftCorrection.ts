import { SyncConfig } from './SyncConfig'

/**
 * Decide a ação para um drift medido. Não toca no player: só decide.
 *
 *   drift = posição local - posição esperada  (ms)
 *   negativo = atrasado, positivo = adiantado
 *
 * Faixas (SyncConfig):
 *   < ignore            → ignorar
 *   ignore … monitor    → monitorar
 *   monitor … hard      → correção suave (playback rate) com histerese;
 *                         sem rate disponível → seek após mais confirmações
 *   > hard              → seek após confirmação
 */

export type CorrectionType = 'none' | 'monitor' | 'rate' | 'rate-reset' | 'seek'

export interface CorrectionDecision {
  type: CorrectionType
  rate?: number
}

export class DriftCorrection {
  private monitorCount = 0
  private hardCount = 0
  private softUntil = 0
  private softSign = 0
  private lastSeekAt = -Infinity
  currentRate = 1

  constructor(private readonly cfg = SyncConfig) {}

  reset(): void {
    this.monitorCount = 0
    this.hardCount = 0
    this.softUntil = 0
    this.softSign = 0
  }

  /** Registrar seek feito pelo engine (inclusive forçado). */
  noteSeek(nowMs: number): void {
    this.lastSeekAt = nowMs
    this.reset()
  }

  get softActive(): boolean {
    return this.currentRate !== 1
  }

  /**
   * @param force  ignora histerese (após carregar vídeo, buffering, aba voltar…)
   */
  decide(driftMs: number, nowMs: number, availableRates: number[], force = false): CorrectionDecision {
    const abs = Math.abs(driftMs)
    const cfg = this.cfg

    if (force) {
      if (abs > cfg.ignoreDriftMs) {
        return this.seekDecision(nowMs)
      }
      return this.softActive ? this.resetRate() : { type: 'none' }
    }

    // Correção suave em andamento
    if (this.softActive) {
      if (abs > cfg.hardSeekThresholdMs) return this.seekDecision(nowMs)
      const flipped = Math.sign(driftMs) !== this.softSign
      if (abs < cfg.ignoreDriftMs || flipped || nowMs >= this.softUntil) return this.resetRate()
      return { type: 'none' }
    }

    if (abs < cfg.ignoreDriftMs) {
      this.reset()
      return { type: 'none' }
    }

    if (abs > cfg.hardSeekThresholdMs) {
      this.hardCount++
      this.monitorCount++
      if (this.hardCount >= cfg.hardSeekConfirmations && this.cooldownOver(nowMs)) {
        return this.seekDecision(nowMs)
      }
      return { type: 'monitor' }
    }
    this.hardCount = 0

    if (abs < cfg.monitorDriftMs) {
      this.monitorCount = 0
      return { type: 'monitor' }
    }

    // monitor … softCorrectionMax
    this.monitorCount++
    if (this.monitorCount < cfg.softConfirmations) return { type: 'monitor' }

    const rate = this.pickRate(driftMs, availableRates)
    if (rate !== null && abs <= cfg.softCorrectionMaxMs) {
      const delta = Math.abs(rate - 1)
      const needed = abs / delta // ms de reprodução para recuperar o drift
      this.softUntil = nowMs + Math.min(needed, cfg.softCorrectionMaxDurationMs)
      this.softSign = Math.sign(driftMs)
      this.currentRate = rate
      return { type: 'rate', rate }
    }

    if (this.monitorCount >= cfg.monitorSeekConfirmations && this.cooldownOver(nowMs)) {
      return this.seekDecision(nowMs)
    }
    return { type: 'monitor' }
  }

  private pickRate(driftMs: number, available: number[]): number | null {
    const wanted = driftMs < 0 ? this.cfg.softRatesFast : this.cfg.softRatesSlow
    for (const r of wanted) {
      if (available.some((a) => Math.abs(a - r) < 1e-6)) return r
    }
    return null
  }

  private resetRate(): CorrectionDecision {
    this.currentRate = 1
    this.reset()
    return { type: 'rate-reset', rate: 1 }
  }

  private seekDecision(nowMs: number): CorrectionDecision {
    this.currentRate = 1
    this.noteSeek(nowMs)
    return { type: 'seek' }
  }

  private cooldownOver(nowMs: number): boolean {
    return nowMs - this.lastSeekAt >= this.cfg.seekCooldownMs
  }
}
