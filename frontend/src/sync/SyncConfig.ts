/**
 * Parâmetros de sincronização — ÚNICO lugar onde limites e intervalos vivem.
 * Valores iniciais; calibrar em testes reais.
 */
export const SyncConfig = {
  // Comandos agendados: executeAt = agora (relógio do servidor) + atraso.
  // Precisa cobrir a ida até o Firebase e a volta para os outros clientes.
  commandLeadTimeMs: 600,
  trackChangeLeadTimeMs: 1500,
  trackEndToleranceSec: 3,
  maxQueueSize: 200,

  // Verificação local de drift
  localCheckIntervalMs: 500,

  // Clock sync
  clockSyncIntervalMs: 10_000,
  clockSampleWindow: 10,
  clockSampleMaxAgeMs: 60_000,
  /** Quantas amostras de menor RTT entram na mediana do offset. */
  clockBestSamples: 3,
  clockBurstCount: 4,
  clockBurstSpacingMs: 250,

  // Faixas de drift
  ignoreDriftMs: 150,
  monitorDriftMs: 400,
  softCorrectionMaxMs: 1000,
  hardSeekThresholdMs: 1000,

  // Histerese
  softConfirmations: 3,
  hardSeekConfirmations: 2,
  /** Drift entre monitor e hard quando não há playback rate disponível. */
  monitorSeekConfirmations: 6,
  seekCooldownMs: 2500,
  /** Compensa o tempo que o player leva para efetivar um seek tocando. */
  seekCompensationMs: 60,

  // Correção suave (só se a velocidade existir em getAvailablePlaybackRates)
  softRatesFast: [1.05, 1.1],
  softRatesSlow: [0.95, 0.9],
  softCorrectionMaxDurationMs: 8000,

  // Rede
  unstableRttMs: 400,
  unstableJitterMs: 150,

  // Comandos
  requestTimeoutMs: 10_000,

  /** Reenvio de TRACK_ENDED se o servidor ainda não avançou. */
  trackEndedRetryMs: 3000,
} as const

export type SyncConfigType = typeof SyncConfig

export function isSyncDebug(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).has('debug') ||
      window.localStorage.getItem('echoroom.debug') === '1'
    )
  } catch {
    return false
  }
}
