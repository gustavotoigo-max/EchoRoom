import { describe, expect, it } from 'vitest'
import { ClockSync } from '../src/sync/ClockSync'
import { DriftCorrection } from '../src/sync/DriftCorrection'
import { SyncConfig } from '../src/sync/SyncConfig'
import { SyncEngine, type SyncStatus } from '../src/sync/SyncEngine'
import { getExpectedPosition, isStartPending } from '../src/sync/Timeline'
import type { LocalPlayerState, PlayerAdapter } from '../src/services/youtube/PlayerAdapter'
import type { RoomState } from '../src/types/room'
import { extractVideoId } from '../src/utils/youtubeUrlParser'

// ---------------------------------------------------------------------------
// Relógio virtual + timers determinísticos
// ---------------------------------------------------------------------------

class VirtualTime {
  now = 1_000_000 // ms locais
  private seq = 0
  private tasks: { id: number; at: number; fn: () => void; every?: number }[] = []

  timers = {
    setTimeout: (fn: () => void, ms: number) => this.add(fn, ms),
    clearTimeout: (id: unknown) => this.remove(id as number),
    setInterval: (fn: () => void, ms: number) => this.add(fn, ms, ms),
    clearInterval: (id: unknown) => this.remove(id as number),
  }

  private add(fn: () => void, ms: number, every?: number) {
    const id = ++this.seq
    this.tasks.push({ id, at: this.now + Math.max(0, ms), fn, every })
    return id
  }
  private remove(id: number) {
    this.tasks = this.tasks.filter((t) => t.id !== id)
  }

  advance(ms: number, onStep?: (dt: number) => void) {
    const end = this.now + ms
    for (;;) {
      this.tasks.sort((a, b) => a.at - b.at)
      const next = this.tasks[0]
      if (!next || next.at > end) break
      const dt = next.at - this.now
      onStep?.(dt)
      this.now = next.at
      if (next.every) next.at += next.every
      else this.remove(next.id)
      next.fn()
    }
    onStep?.(end - this.now)
    this.now = end
  }
}

/** Player falso: avança o tempo quando "tocando", com latência de play configurável. */
class FakePlayer implements PlayerAdapter {
  state: LocalPlayerState = 'unstarted'
  time = 0
  rate = 1
  muted = false
  videoId: string | null = null
  rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
  seeks: number[] = []
  onState?: (s: LocalPlayerState) => void

  private set(s: LocalPlayerState) {
    this.state = s
    this.onState?.(s)
  }
  tick(dtMs: number) {
    if (this.state === 'playing') this.time += (dtMs / 1000) * this.rate
  }
  load(videoId: string, start: number) {
    this.videoId = videoId
    this.time = start
    this.set('buffering')
    this.set('playing')
  }
  cue(videoId: string, start: number) {
    this.videoId = videoId
    this.time = start
    this.set('cued')
  }
  play() {
    if (this.state !== 'playing') this.set('playing')
  }
  pause() {
    if (this.state === 'playing' || this.state === 'buffering') this.set('paused')
  }
  stop() {
    this.set('unstarted')
  }
  seek(s: number) {
    this.seeks.push(s)
    this.time = s
    if (this.state === 'cued' || this.state === 'unstarted') this.set('playing')
  }
  getCurrentTime() {
    return this.time
  }
  getDuration() {
    return 240
  }
  getState() {
    return this.state
  }
  getAvailablePlaybackRates() {
    return this.rates
  }
  setPlaybackRate(r: number) {
    this.rate = r
  }
  mute() {
    this.muted = true
  }
  unMute() {
    this.muted = false
  }
  isMuted() {
    return this.muted
  }
  setVolume() {}
  getTitle() {
    return 'Seven Nation Army'
  }
}

function room(partial: Partial<RoomState>): RoomState {
  return {
    roomId: 'ABX72',
    currentTrack: { id: 'i1', videoId: 'dQw4w9WgXcQ', title: 't', author: '', thumbnail: '', addedBy: 'Gus', duration: 240 },
    currentVideoId: 'dQw4w9WgXcQ',
    shuffle: false,
    repeat: 'off',
    playbackState: 'paused',
    position: 0,
    startedAt: null,
    executeAt: null,
    stateVersion: 1,
    queue: [],
    participants: [],
    ...partial,
  }
}

/** Cliente completo: relógio local deslocado do servidor por `skewMs`. */
function makeClient(vt: VirtualTime, skewMs: number) {
  const clock = new ClockSync(() => {}, () => vt.now + skewMs)
  // servidor = vt.now; local = vt.now + skew → offset ideal = -skew
  clock.addSample({ rtt: 40, offset: -skewMs, timestamp: vt.now + skewMs })
  const player = new FakePlayer()
  const ended: string[] = []
  const statuses: SyncStatus[] = []
  const engine = new SyncEngine({
    clock,
    now: () => vt.now + skewMs,
    timers: vt.timers,
    onTrackEnded: (id) => ended.push(id),
    onTrackMeta: () => {},
    onStatus: (s) => statuses.push(s),
  })
  player.onState = (s) => engine.handlePlayerState(s)
  engine.start()
  engine.attachPlayer(player)
  return { clock, player, engine, ended, statuses }
}

const serverSec = (vt: VirtualTime) => vt.now / 1000

// ---------------------------------------------------------------------------

describe('Timeline', () => {
  it('calcula a posição esperada tocando e pausado', () => {
    expect(getExpectedPosition(room({ playbackState: 'playing', position: 125, startedAt: 1000 }), 1030)).toBeCloseTo(155)
    expect(getExpectedPosition(room({ playbackState: 'paused', position: 42 }), 99999)).toBe(42)
  })
  it('não avança antes do startedAt e respeita a duração', () => {
    const s = room({ playbackState: 'playing', position: 10, startedAt: 1000 })
    expect(getExpectedPosition(s, 999)).toBe(10)
    expect(isStartPending(s, 999)).toBe(true)
    expect(getExpectedPosition(room({ playbackState: 'playing', position: 0, startedAt: 0 }), 9999)).toBe(240)
  })
})

describe('ClockSync', () => {
  it('estima offset e RTT a partir de T1..T4', () => {
    let local = 10_000
    const clock = new ClockSync(() => {}, () => local)
    // servidor está 500 ms à frente; ida 30 ms, volta 50 ms, processamento 2 ms
    const t1 = local
    const t2 = (t1 + 500 + 30) / 1000
    const t3 = t2 + 0.002
    local = t1 + 30 + 2 + 50
    const sample = clock.handlePong(t1, t2, t3)!
    expect(sample.rtt).toBeCloseTo(80)
    expect(sample.offset).toBeCloseTo(490) // erro = assimetria/2 = 10 ms
    expect(clock.serverNow()).toBeCloseTo(local + 490)
  })
  it('prefere amostras com menor RTT', () => {
    const clock = new ClockSync(() => {}, () => 0)
    clock.addSample({ rtt: 400, offset: 900, timestamp: 0 })
    clock.addSample({ rtt: 20, offset: 100, timestamp: 1 })
    clock.addSample({ rtt: 25, offset: 104, timestamp: 2 })
    clock.addSample({ rtt: 30, offset: 98, timestamp: 3 })
    expect(clock.offset).toBe(100)
    expect(clock.rtt).toBe(20)
  })
  it('converte executeAt do servidor para instante local', () => {
    const clock = new ClockSync(() => {}, () => 5000)
    clock.addSample({ rtt: 10, offset: 2000, timestamp: 0 })
    expect(clock.serverSecToLocalMs(7.5)).toBe(5500)
    expect(clock.msUntil(7.5)).toBe(500)
  })
})

describe('DriftCorrection', () => {
  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
  it('ignora drift pequeno', () => {
    const d = new DriftCorrection()
    expect(d.decide(100, 0, rates).type).toBe('none')
    expect(d.decide(-300, 500, rates).type).toBe('monitor')
  })
  it('exige confirmação antes do seek (histerese)', () => {
    const d = new DriftCorrection()
    expect(d.decide(-1500, 0, rates).type).toBe('monitor')
    expect(d.decide(-1500, 500, rates).type).toBe('seek')
    // logo depois, outro drift grande respeita o cooldown
    d.decide(-1500, 1000, rates)
    expect(d.decide(-1500, 1500, rates).type).toBe('monitor')
  })
  it('usa playback rate só quando disponível', () => {
    const withRate = new DriftCorrection()
    const decisions = [0, 500, 1000].map((t) => withRate.decide(-600, t, [...rates, 1.05]))
    expect(decisions[2]).toEqual({ type: 'rate', rate: 1.05 })

    const noRate = new DriftCorrection()
    const types = Array.from({ length: SyncConfig.monitorSeekConfirmations }, (_, i) =>
      noRate.decide(-600, i * 500, rates).type,
    )
    expect(types.includes('rate')).toBe(false)
    expect(types[types.length - 1]).toBe('seek')
  })
  it('encerra a correção suave quando o drift some', () => {
    const d = new DriftCorrection()
    ;[0, 500, 1000].forEach((t) => d.decide(-600, t, [1, 1.05]))
    expect(d.softActive).toBe(true)
    expect(d.decide(-50, 1500, [1, 1.05])).toEqual({ type: 'rate-reset', rate: 1 })
  })
  it('modo forçado corrige direto', () => {
    expect(new DriftCorrection().decide(-500, 0, rates, true).type).toBe('seek')
  })
})

describe('SyncEngine', () => {
  it('play agendado: clientes com latências diferentes começam juntos', () => {
    const vt = new VirtualTime()
    const a = makeClient(vt, 0)
    const b = makeClient(vt, 3_600_000) // relógio local 1 h adiantado
    const base = room({ playbackState: 'paused', position: 30, stateVersion: 1 })
    a.engine.applyState(base)
    b.engine.applyState(base)
    vt.advance(100, (dt) => [a, b].forEach((c) => c.player.tick(dt)))
    expect(a.player.state).toBe('cued')

    const executeAt = serverSec(vt) + 0.4
    const playing = room({ playbackState: 'playing', position: 30, startedAt: executeAt, executeAt, stateVersion: 2 })
    // A recebe em 30 ms, B em 180 ms
    vt.advance(30, (dt) => [a, b].forEach((c) => c.player.tick(dt)))
    a.engine.applyState(playing)
    vt.advance(150, (dt) => [a, b].forEach((c) => c.player.tick(dt)))
    b.engine.applyState(playing)

    // antes do executeAt ninguém está tocando "de verdade" além do preroll mudo
    vt.advance(400, (dt) => [a, b].forEach((c) => c.player.tick(dt)))
    vt.advance(5000, (dt) => [a, b].forEach((c) => c.player.tick(dt)))
    const expected = getExpectedPosition(playing, serverSec(vt))
    expect(a.player.state).toBe('playing')
    expect(b.player.state).toBe('playing')
    expect(Math.abs(a.player.time - expected)).toBeLessThan(0.15)
    expect(Math.abs(b.player.time - expected)).toBeLessThan(0.15)
    expect(Math.abs(a.player.time - b.player.time)).toBeLessThan(0.1)
    expect(a.player.muted || b.player.muted).toBe(false)
  })

  it('pause agendado congela todos na mesma posição', () => {
    const vt = new VirtualTime()
    const a = makeClient(vt, 0)
    const start = serverSec(vt)
    const playing = room({ playbackState: 'playing', position: 0, startedAt: start, executeAt: start, stateVersion: 1 })
    a.engine.applyState(playing)
    vt.advance(10_000, (dt) => a.player.tick(dt))
    const execAt = serverSec(vt) + 0.4
    const pos = getExpectedPosition(playing, execAt)
    a.engine.applyState(room({ playbackState: 'paused', position: pos, executeAt: execAt, stateVersion: 2 }))
    vt.advance(200, (dt) => a.player.tick(dt))
    expect(a.player.state).toBe('playing') // ainda não chegou o instante
    vt.advance(400, (dt) => a.player.tick(dt))
    expect(a.player.state).toBe('paused')
    expect(Math.abs(a.player.time - pos)).toBeLessThan(0.15)
  })

  it('recupera após buffering local com seek', () => {
    const vt = new VirtualTime()
    const a = makeClient(vt, 0)
    const start = serverSec(vt)
    a.engine.applyState(room({ playbackState: 'playing', position: 0, startedAt: start, executeAt: start }))
    vt.advance(3000, (dt) => a.player.tick(dt))
    // 4 s de buffering
    a.player.state = 'buffering'
    a.engine.handlePlayerState('buffering')
    vt.advance(4000)
    expect(a.statuses.at(-1)!.ui).toBe('buffering')
    a.player.state = 'playing'
    a.engine.handlePlayerState('playing')
    vt.advance(600, (dt) => a.player.tick(dt))
    const expected = start + 0 // posição esperada = tempo decorrido
    const drift = a.player.time - (serverSec(vt) - expected)
    expect(Math.abs(drift)).toBeLessThan(0.15)
  })

  it('corrige drift persistente com histerese, sem seeks repetidos', () => {
    const vt = new VirtualTime()
    const a = makeClient(vt, 0)
    const start = serverSec(vt)
    a.engine.applyState(room({ playbackState: 'playing', position: 0, startedAt: start, executeAt: start }))
    vt.advance(2000, (dt) => a.player.tick(dt))
    const seeksBefore = a.player.seeks.length
    a.player.time -= 1.5 // atraso de 1,5 s
    vt.advance(5000, (dt) => a.player.tick(dt))
    expect(a.player.seeks.length - seeksBefore).toBe(1)
    expect(Math.abs(a.player.time - (serverSec(vt) - start))).toBeLessThan(0.15)
  })

  it('reporta TRACK_ENDED uma vez por janela de retry', () => {
    const vt = new VirtualTime()
    const a = makeClient(vt, 0)
    const start = serverSec(vt) - 239.9
    a.engine.applyState(room({ playbackState: 'playing', position: 0, startedAt: start, executeAt: start }))
    a.player.time = 240
    a.player.state = 'ended'
    a.engine.handlePlayerState('ended')
    vt.advance(1500)
    expect(a.ended).toEqual(['i1'])
    vt.advance(SyncConfig.trackEndedRetryMs + 600)
    expect(a.ended.length).toBe(2)
  })
})

describe('youtubeUrlParser', () => {
  it('aceita os formatos suportados', () => {
    const id = 'dQw4w9WgXcQ'
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `youtube.com/watch?v=${id}&t=10`,
      `https://youtu.be/${id}?si=x`,
      `https://youtube.com/shorts/${id}`,
      `https://m.youtube.com/watch?v=${id}`,
      id,
    ]) {
      expect(extractVideoId(url)).toBe(id)
    }
  })
  it('rejeita links inválidos', () => {
    for (const url of ['', 'https://vimeo.com/1', 'youtube.com/watch?v=abc', 'texto qualquer']) {
      expect(extractVideoId(url)).toBe(null)
    }
  })
})
