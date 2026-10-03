/** Persistência local mínima (nome, id do participante, chaves de sala). */

const NAME_KEY = 'echoroom.name'
const VOLUME_KEY = 'echoroom.volume'
const MUTED_KEY = 'echoroom.muted'
const LAST_ROOM_KEY = 'echoroom.lastRoom'
const VIDEO_HIDDEN_KEY = 'echoroom.videoHidden'
const VIDEO_SIZE_KEY = 'echoroom.videoSize'
const PID_KEY = 'echoroom.participant'
const roomKeyKey = (roomId: string) => `echoroom.key.${roomId.toUpperCase()}`

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* modo privado: segue sem persistir */
  }
}

let memoryPid: string | null = null

export const storage = {
  getName: () => read(NAME_KEY) ?? '',
  setName: (name: string) => write(NAME_KEY, name.trim()),

  getParticipantId(): string {
    let id = read(PID_KEY) ?? memoryPid
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '')
      write(PID_KEY, id)
      memoryPid = id
    }
    return id
  },

  getVolume(): number {
    const v = Number(read(VOLUME_KEY))
    return read(VOLUME_KEY) !== null && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 80
  },
  setVolume: (v: number) => write(VOLUME_KEY, String(Math.round(v))),
  getMuted: () => read(MUTED_KEY) === '1',
  setMuted: (m: boolean) => write(MUTED_KEY, m ? '1' : '0'),

  /** Tamanho do vídeo: pequeno (mini player), normal ou máximo (modo cinema). */
  getVideoSize(): 'small' | 'normal' | 'max' {
    const v = read(VIDEO_SIZE_KEY)
    if (v === 'small' || v === 'normal' || v === 'max') return v
    return read(VIDEO_HIDDEN_KEY) === '1' ? 'small' : 'normal' // preferência antiga
  },
  setVideoSize: (v: 'small' | 'normal' | 'max') => write(VIDEO_SIZE_KEY, v),

  /** Última sala em que o usuário entrou (usada pela extensão). */
  getLastRoom: () => read(LAST_ROOM_KEY),
  setLastRoom: (roomId: string) => write(LAST_ROOM_KEY, roomId.toUpperCase()),

  /** Chave derivada da senha: evita pedir a senha de novo neste navegador. */
  getRoomKey: (roomId: string) => read(roomKeyKey(roomId)),
  setRoomKey: (roomId: string, key: string) => write(roomKeyKey(roomId), key),
  clearRoomKey: (roomId: string) => write(roomKeyKey(roomId), null),
}
