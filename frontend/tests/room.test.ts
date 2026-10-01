import { describe, expect, it } from 'vitest'
import { parseFirebaseConfig } from '../src/config/firebase'
import { applyCommand, CommandError, emptyRoom, normalizeRoom, toFirebase } from '../src/rooms/roomLogic'
import { SyncConfig } from '../src/sync/SyncConfig'
import type { QueueItem, RoomDoc } from '../src/types/room'

const LEAD = SyncConfig.commandLeadTimeMs / 1000
const TRACK_LEAD = SyncConfig.trackChangeLeadTimeMs / 1000

let seq = 0
const item = (videoId = 'aaaaaaaaaaa', extra: Partial<QueueItem> = {}): QueueItem => ({
  id: `i${++seq}`,
  videoId,
  title: 't',
  author: '',
  thumbnail: '',
  addedBy: 'Gus',
  ...extra,
})

/** Aplica e falha se nada mudou. */
function must(doc: RoomDoc, cmd: Parameters<typeof applyCommand>[1], now: number): RoomDoc {
  const next = applyCommand(doc, cmd, now)
  if (!next) throw new Error(`comando ${cmd.type} não alterou a sala`)
  return next
}

describe('roomLogic', () => {
  it('primeira música começa a tocar com atraso de troca de faixa', () => {
    const r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item() }, 100)
    expect(r.playbackState).toBe('playing')
    expect(r.startedAt).toBeCloseTo(100 + TRACK_LEAD)
    expect(r.stateVersion).toBe(1)
  })

  it('comando sem efeito não gera versão nova', () => {
    const r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item() }, 0)
    expect(applyCommand(r, { type: 'PLAY' }, 10)).toBe(null)
  })

  it('pause congela no executeAt e play reagenda', () => {
    let r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item() }, 0)
    const start = r.startedAt!
    r = must(r, { type: 'PAUSE' }, 50)
    expect(r.executeAt).toBeCloseTo(50 + LEAD)
    expect(r.position).toBeCloseTo(50 + LEAD - start)
    expect(r.startedAt).toBe(null)
    r = must(r, { type: 'PLAY' }, 80)
    expect(r.startedAt).toBeCloseTo(80 + LEAD)
    expect(r.stateVersion).toBe(3)
  })

  it('seek mantém o estado de reprodução', () => {
    let r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item() }, 0)
    r = must(r, { type: 'SEEK', position: 153.44 }, 100)
    expect(r.playbackState).toBe('playing')
    expect(r.position).toBe(153.44)
    expect(r.startedAt).toBeCloseTo(100 + LEAD)
  })

  it('skip duplicado (dois cliques) só pula uma música', () => {
    let r = emptyRoom('ABCDE')
    for (const v of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) r = must(r, { type: 'TRACK_ADD', item: item(v) }, 0)
    const first = r.currentTrack!.id
    r = must(r, { type: 'TRACK_SKIP', currentItemId: first }, 10)
    expect(applyCommand(r, { type: 'TRACK_SKIP', currentItemId: first }, 10)).toBe(null)
    expect(r.currentTrack!.videoId).toBe('bbbbbbbbbbb')
  })

  it('fim de música: valida posição e ignora relatos repetidos', () => {
    let r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item('aaaaaaaaaaa', { duration: 200 }) }, 0)
    r = must(r, { type: 'TRACK_ADD', item: item('bbbbbbbbbbb') }, 0)
    const cur = r.currentTrack!.id
    const start = r.startedAt!
    expect(applyCommand(r, { type: 'TRACK_ENDED', itemId: cur }, start + 100)).toBe(null)
    r = must(r, { type: 'TRACK_ENDED', itemId: cur }, start + 199)
    expect(applyCommand(r, { type: 'TRACK_ENDED', itemId: cur }, start + 200)).toBe(null)
    expect(r.currentTrack!.videoId).toBe('bbbbbbbbbbb')
  })

  it('fila acaba: sala para e play avisa', () => {
    let r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item() }, 0)
    r = must(r, { type: 'TRACK_SKIP', currentItemId: null }, 5)
    expect(r.playbackState).toBe('stopped')
    let msg = ''
    try {
      applyCommand(r, { type: 'PLAY' }, 6)
    } catch (e) {
      msg = e instanceof CommandError ? e.message : 'outro erro'
    }
    expect(msg.startsWith('A fila está vazia')).toBe(true)
  })

  it('mover para o topo e remover', () => {
    let r = emptyRoom('ABCDE')
    for (const v of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']) r = must(r, { type: 'TRACK_ADD', item: item(v) }, 0)
    const last = r.queue[r.queue.length - 1].id
    r = must(r, { type: 'TRACK_MOVE', itemId: last, toIndex: 0 }, 0)
    expect(r.queue[0].videoId).toBe('ddddddddddd')
    r = must(r, { type: 'TRACK_REMOVE', itemId: last }, 0)
    expect(r.queue.map((q) => q.videoId)).toEqual(['bbbbbbbbbbb', 'ccccccccccc'])
  })

  it('TRACK_META preenche duração e título provisório uma vez', () => {
    let r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item('aaaaaaaaaaa', { title: 'youtu.be/x', titleResolved: false }) }, 0)
    const id = r.currentTrack!.id
    r = must(r, { type: 'TRACK_META', itemId: id, title: 'Seven Nation Army', duration: 231 }, 1)
    expect(r.currentTrack!.title).toBe('Seven Nation Army')
    expect(r.currentTrack!.duration).toBe(231)
    expect(applyCommand(r, { type: 'TRACK_META', itemId: id, title: 'Outro', duration: 99 }, 2)).toBe(null)
  })

  it('normaliza o formato que o Firebase devolve', () => {
    let r = emptyRoom('ABCDE')
    for (const v of ['aaaaaaaaaaa', 'bbbbbbbbbbb']) r = must(r, { type: 'TRACK_ADD', item: item(v) }, 0)
    r = must(r, { type: 'PAUSE' }, 3)
    const stored = toFirebase(r) as unknown as Record<string, unknown>
    // Firebase descarta nulls e arrays vazios
    delete stored.startedAt
    expect(normalizeRoom(stored)).toEqual(r)
    expect(normalizeRoom({ roomId: 'ABCDE', playbackState: 'stopped', stateVersion: 0, position: 0 })).toEqual(emptyRoom('ABCDE'))
    expect(normalizeRoom({ roomId: 'X', queue: { 0: item('q'), 1: item('r') } })!.queue.length).toBe(2)
  })
})

describe('parseFirebaseConfig', () => {
  it('aceita o trecho copiado do console', () => {
    const raw = `const firebaseConfig = {
      apiKey: "AIzaSyA-123",
      authDomain: "echoroom-1.firebaseapp.com",
      databaseURL: "https://echoroom-1-default-rtdb.firebaseio.com",
      projectId: "echoroom-1",
      storageBucket: "echoroom-1.firebasestorage.app",
      messagingSenderId: "123",
      appId: "1:123:web:abc",
    };`
    const cfg = parseFirebaseConfig(raw)!
    expect(cfg.projectId).toBe('echoroom-1')
    expect(cfg.databaseURL).toBe('https://echoroom-1-default-rtdb.firebaseio.com')
  })
  it('aceita o código completo com import e initializeApp', () => {
    const raw = `// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyX",
  authDomain: "echoroom-a622c.firebaseapp.com",
  databaseURL: "https://echoroom-a622c-default-rtdb.firebaseio.com",
  projectId: "echoroom-a622c",
  storageBucket: "echoroom-a622c.firebasestorage.app",
  messagingSenderId: "312335679044",
  appId: "1:312335679044:web:b5ee107fa52879fcf04611"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);`
    const cfg = parseFirebaseConfig(raw)!
    expect(cfg.projectId).toBe('echoroom-a622c')
    expect(cfg.databaseURL).toBe('https://echoroom-a622c-default-rtdb.firebaseio.com')
    expect(cfg.appId).toBe('1:312335679044:web:b5ee107fa52879fcf04611')
  })
  it('aceita JSON e completa databaseURL ausente', () => {
    const cfg = parseFirebaseConfig('{"apiKey":"k","projectId":"p1","appId":"a"}')!
    expect(cfg.databaseURL).toBe('https://p1-default-rtdb.firebaseio.com')
  })
  it('rejeita vazio ou incompleto', () => {
    expect(parseFirebaseConfig('')).toBe(null)
    expect(parseFirebaseConfig('{ apiKey: "x" }')).toBe(null)
  })
})
