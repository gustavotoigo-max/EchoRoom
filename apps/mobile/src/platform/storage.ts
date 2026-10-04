import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Mesma interface do storage do site (utils/storage), guardada no AsyncStorage.
 * As leituras são síncronas: tudo é carregado para a memória ao abrir o app
 * (hydrateStorage) e as escritas vão para o disco em segundo plano.
 */

const PREFIX = 'echoroom.'
const NAME_KEY = 'echoroom.name'
const VOLUME_KEY = 'echoroom.volume'
const MUTED_KEY = 'echoroom.muted'
const LAST_ROOM_KEY = 'echoroom.lastRoom'
const PID_KEY = 'echoroom.participant'
const roomKeyKey = (roomId: string) => `echoroom.key.${roomId.toUpperCase()}`

const cache = new Map<string, string>()

export async function hydrateStorage(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX))
    for (const [k, v] of await AsyncStorage.multiGet(keys)) if (v !== null) cache.set(k, v)
  } catch {
    /* começa vazio */
  }
}

export function read(key: string): string | null {
  return cache.get(key) ?? null
}

export function write(key: string, value: string | null): void {
  if (value === null) {
    cache.delete(key)
    void AsyncStorage.removeItem(key).catch(() => {})
  } else {
    cache.set(key, value)
    void AsyncStorage.setItem(key, value).catch(() => {})
  }
}

export const storage = {
  getName: () => read(NAME_KEY) ?? '',
  setName: (name: string) => write(NAME_KEY, name.trim()),

  getParticipantId(): string {
    let id = read(PID_KEY)
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '')
      write(PID_KEY, id)
    }
    return id
  },

  getVolume(): number {
    const v = Number(read(VOLUME_KEY))
    return read(VOLUME_KEY) !== null && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100
  },
  setVolume: (v: number) => write(VOLUME_KEY, String(Math.round(v))),
  getMuted: () => read(MUTED_KEY) === '1',
  setMuted: (m: boolean) => write(MUTED_KEY, m ? '1' : '0'),

  getVideoSize: (): 'small' | 'normal' | 'max' => 'normal',
  setVideoSize: (_v: 'small' | 'normal' | 'max') => {},

  getLastRoom: () => read(LAST_ROOM_KEY),
  setLastRoom: (roomId: string) => write(LAST_ROOM_KEY, roomId.toUpperCase()),

  getRoomKey: (roomId: string) => read(roomKeyKey(roomId)),
  setRoomKey: (roomId: string, key: string) => write(roomKeyKey(roomId), key),
  clearRoomKey: (roomId: string) => write(roomKeyKey(roomId), null),
}
