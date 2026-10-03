import { describe, expect, it } from 'vitest'
import { parseFirebaseConfig } from '../src/config/firebase'
import { applyCommand, CommandError, emptyRoom, normalizeRoom, queueCapacity, toFirebase } from '../src/rooms/roomLogic'
import { parseYouTubeLink } from '../src/utils/youtubeUrlParser'
import { SyncConfig } from '../src/sync/SyncConfig'
import { DEFAULT_SETTINGS, normalizeSettings, type CommandActor, type QueueItem, type RoomDoc, type RoomSettings } from '../src/types/room'

const LEAD = SyncConfig.commandLeadTimeMs / 1000
const TRACK_LEAD = SyncConfig.trackChangeLeadTimeMs / 1000

let seq = 0
// Cada música de teste tem um vídeo próprio (a sala recusa repetidas).
const item = (videoId?: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  id: `i${++seq}`,
  videoId: videoId ?? `v${seq}`.padEnd(11, '_'),
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

  it('playlist: primeira música toca e o resto vai para a fila', () => {
    const items = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((v) => item(v))
    const r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD_MANY', items }, 10)
    expect(r.currentTrack!.videoId).toBe('aaaaaaaaaaa')
    expect(r.queue.length).toBe(2)
    expect(r.playbackState).toBe('playing')
    expect(r.stateVersion).toBe(1)
  })

  it('playlist respeita o limite da fila', () => {
    let r = must(emptyRoom('ABCDE'), { type: 'TRACK_ADD', item: item() }, 0)
    const cap = queueCapacity(r)
    const many = Array.from({ length: cap + 5 }, () => item())
    r = must(r, { type: 'TRACK_ADD_MANY', items: many }, 0)
    expect(r.queue.length).toBe(SyncConfig.maxQueueSize)
    expect(queueCapacity(r)).toBe(0)
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

describe('parseYouTubeLink', () => {
  it('reconhece playlist, vídeo dentro de playlist e vídeo simples', () => {
    const list = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'
    expect(parseYouTubeLink(`https://www.youtube.com/playlist?list=${list}`)).toEqual({ kind: 'playlist', playlistId: list })
    expect(parseYouTubeLink(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${list}&index=3`)).toEqual({
      kind: 'video',
      videoId: 'dQw4w9WgXcQ',
      playlistId: list,
    })
    expect(parseYouTubeLink('https://youtu.be/dQw4w9WgXcQ')).toEqual({ kind: 'video', videoId: 'dQw4w9WgXcQ', playlistId: null })
    expect(parseYouTubeLink(`music.youtube.com/playlist?list=${list}`).kind).toBe('playlist')
    expect(parseYouTubeLink('https://vimeo.com/123?list=PLabcdefghijk').kind).toBe('invalid')
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

describe('permissões da sala (configurações do dono)', () => {
  const settings = (patch: Partial<RoomSettings> = {}): RoomSettings => ({ ...DEFAULT_SETTINGS, ...patch })
  const owner = (patch: Partial<RoomSettings> = {}): CommandActor => ({ uid: 'dono', isOwner: true, settings: settings(patch) })
  const guest = (patch: Partial<RoomSettings> = {}, uid = 'ana'): CommandActor => ({ uid, isOwner: false, settings: settings(patch) })
  const playing = (): RoomDoc => {
    const r = emptyRoom('ABCDE')
    r.currentTrack = item('aaaaaaaaaaa', { addedByUid: 'dono' })
    r.playbackState = 'playing'
    r.startedAt = 100
    r.queue = [item('bbbbbbbbbbb', { addedByUid: 'ana' }), item('ccccccccccc', { addedByUid: 'joao' })]
    return r
  }
  const errorOf = (fn: () => unknown): string => {
    try {
      fn()
      return ''
    } catch (e) {
      return e instanceof CommandError ? e.message : 'outro erro'
    }
  }

  it('controle só do dono bloqueia play/pausa/seek/pular dos outros, mas não do dono', () => {
    const doc = playing()
    expect(errorOf(() => applyCommand(doc, { type: 'PAUSE' }, 200, guest({ controls: 'owner' })))).toBe(
      'Nesta sala, só o dono controla a reprodução.',
    )
    expect(errorOf(() => applyCommand(doc, { type: 'TRACK_SKIP', currentItemId: doc.currentTrack!.id }, 200, guest({ controls: 'owner' })))).toBe(
      'Nesta sala, só o dono pula músicas.',
    )
    expect(applyCommand(doc, { type: 'PAUSE' }, 200, owner({ controls: 'owner' }))!.playbackState).toBe('paused')
  })

  it('comandos automáticos passam mesmo com controle travado', () => {
    const doc = playing()
    const id = doc.currentTrack!.id
    const next = applyCommand(doc, { type: 'TRACK_SKIP', currentItemId: id, reason: 'error' }, 200, guest({ controls: 'owner' }))
    expect(next!.currentTrack!.videoId).toBe('bbbbbbbbbbb')
  })

  it('votação: pular direto é recusado, pular por voto concluído é aceito', () => {
    const doc = playing()
    const id = doc.currentTrack!.id
    expect(errorOf(() => applyCommand(doc, { type: 'TRACK_SKIP', currentItemId: id }, 200, guest({ voteSkip: true })))).toBe(
      'Nesta sala, pular é por votação.',
    )
    const next = applyCommand(doc, { type: 'TRACK_SKIP', currentItemId: id, reason: 'vote' }, 200, guest({ voteSkip: true }))
    expect(next!.currentTrack!.videoId).toBe('bbbbbbbbbbb')
    // o dono pula direto
    expect(applyCommand(doc, { type: 'TRACK_SKIP', currentItemId: id }, 200, owner({ voteSkip: true }))).not.toBe(null)
  })

  it('só o dono adiciona quando configurado', () => {
    const doc = playing()
    expect(errorOf(() => applyCommand(doc, { type: 'TRACK_ADD', item: item() }, 200, guest({ adding: 'owner' })))).toBe(
      'Nesta sala, só o dono adiciona músicas.',
    )
    expect(applyCommand(doc, { type: 'TRACK_ADD', item: item() }, 200, owner({ adding: 'owner' }))!.queue.length).toBe(3)
  })

  it('limite por pessoa: recusa a mais e corta playlists', () => {
    const doc = playing()
    expect(errorOf(() => applyCommand(doc, { type: 'TRACK_ADD', item: item() }, 200, guest({ maxPerUser: 1 })))).toBe(
      'Você já tem 1 música na fila (limite da sala: 1).',
    )
    const items = [1, 2, 3, 4].map(() => item(undefined, { addedByUid: 'ana' }))
    const next = applyCommand(doc, { type: 'TRACK_ADD_MANY', items }, 200, guest({ maxPerUser: 3 }))
    expect(next!.queue.filter((q) => q.addedByUid === 'ana').length).toBe(3)
    // o comando original não é alterado (a transação pode repetir)
    expect(items.length).toBe(4)
  })

  it('remover: dono remove qualquer uma; os outros só as próprias', () => {
    const doc = playing()
    const deAna = doc.queue[0].id
    const deJoao = doc.queue[1].id
    expect(applyCommand(doc, { type: 'TRACK_REMOVE', itemId: deAna }, 200, guest())!.queue.length).toBe(1)
    expect(errorOf(() => applyCommand(doc, { type: 'TRACK_REMOVE', itemId: deJoao }, 200, guest()))).toBe(
      'Só o dono da sala ou quem adicionou pode remover esta música.',
    )
    expect(applyCommand(doc, { type: 'TRACK_REMOVE', itemId: deJoao }, 200, owner())!.queue.length).toBe(1)
  })

  it('configurações inválidas viram o padrão', () => {
    const s = normalizeSettings({ controls: 'x', voteSkipPercent: 7, maxPerUser: -2, allowGuests: false })
    expect(s.controls).toBe('all')
    expect(s.voteSkipPercent).toBe(50)
    expect(s.maxPerUser).toBe(0)
    expect(s.allowGuests).toBe(false)
  })
})

describe('músicas repetidas', () => {
  it('recusa a música que está tocando ou já está na fila', () => {
    const r = emptyRoom('ABCDE')
    r.currentTrack = item('aaaaaaaaaaa')
    r.queue = [item('bbbbbbbbbbb')]
    const err = (videoId: string) => {
      try {
        applyCommand(r, { type: 'TRACK_ADD', item: item(videoId) }, 100)
        return ''
      } catch (e) {
        return (e as Error).message
      }
    }
    expect(err('aaaaaaaaaaa')).toBe('Essa música já está tocando.')
    expect(err('bbbbbbbbbbb')).toBe('Essa música já está na fila.')
    expect(err('ccccccccccc')).toBe('')
  })
  it('playlist entra sem as repetidas', () => {
    const r = emptyRoom('ABCDE')
    r.currentTrack = item('aaaaaaaaaaa')
    r.queue = [item('bbbbbbbbbbb')]
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ccccccccccc', 'ddddddddddd']
    const next = applyCommand(r, { type: 'TRACK_ADD_MANY', items: ids.map((v) => item(v)) }, 100)!
    expect(next.queue.map((q) => q.videoId).join(',')).toBe('bbbbbbbbbbb,ccccccccccc,ddddddddddd')
  })
})
