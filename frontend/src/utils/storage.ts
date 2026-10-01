/** Persistência local mínima (nome, id do participante, chaves de sala). */

const NAME_KEY = 'echoroom.name'
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

  /** Chave derivada da senha: evita pedir a senha de novo neste navegador. */
  getRoomKey: (roomId: string) => read(roomKeyKey(roomId)),
  setRoomKey: (roomId: string, key: string) => write(roomKeyKey(roomId), key),
  clearRoomKey: (roomId: string) => write(roomKeyKey(roomId), null),
}
