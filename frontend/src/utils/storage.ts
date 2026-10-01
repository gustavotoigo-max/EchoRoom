/** Persistência local mínima (nome, id do participante, tokens de sala). */

const NAME_KEY = 'echoroom.name'
const PID_KEY = 'echoroom.participant'
const tokenKey = (roomId: string) => `echoroom.token.${roomId.toUpperCase()}`

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

  getRoomToken: (roomId: string) => read(tokenKey(roomId)),
  setRoomToken: (roomId: string, token: string) => write(tokenKey(roomId), token),
  clearRoomToken: (roomId: string) => write(tokenKey(roomId), null),
}
