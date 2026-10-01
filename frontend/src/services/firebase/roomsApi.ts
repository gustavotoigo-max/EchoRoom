import { get, ref, runTransaction, serverTimestamp, set } from 'firebase/database'
import { emptyRoom, toFirebase } from '../../rooms/roomLogic'
import { describeDbError, ensureSignedIn, getDb } from './app'
import { deriveRoomKey } from './roomCrypto'

/** Criação e entrada em salas (equivalente ao antigo POST /rooms e /join). */

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem 0/O, 1/I
export const MIN_PASSWORD = 4

export class RoomAccessError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_found' | 'wrong_password' | 'other',
  ) {
    super(message)
  }
}

function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('')
}

export interface RoomAccess {
  roomId: string
  roomKey: string
}

export async function createRoom(password: string): Promise<RoomAccess> {
  if (password.length < MIN_PASSWORD) {
    throw new RoomAccessError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`, 'other')
  }
  try {
    await ensureSignedIn()
    const db = getDb()
    for (let attempt = 0; attempt < 10; attempt++) {
      const roomId = newRoomId()
      // Reserva o código: só grava se ainda não existir.
      const res = await runTransaction(ref(db, `roomIndex/${roomId}`), (cur) =>
        cur === null ? { createdAt: serverTimestamp() } : undefined,
      )
      if (!res.committed) continue
      const roomKey = await deriveRoomKey(roomId, password)
      await set(
        ref(db, `rooms/${roomKey}`),
        toFirebase({ meta: { roomId, createdAt: serverTimestamp() }, state: emptyRoom(roomId) }),
      )
      return { roomId, roomKey }
    }
    throw new RoomAccessError('Não foi possível gerar um código de sala livre. Tente de novo.', 'other')
  } catch (err) {
    if (err instanceof RoomAccessError) throw err
    throw new RoomAccessError(describeDbError(err), 'other')
  }
}

export async function roomExists(roomId: string): Promise<boolean> {
  try {
    await ensureSignedIn()
    return (await get(ref(getDb(), `roomIndex/${roomId.toUpperCase()}`))).exists()
  } catch (err) {
    throw new RoomAccessError(describeDbError(err), 'other')
  }
}

/** Valida a senha calculando a chave e conferindo se a sala existe nesse caminho. */
export async function joinRoom(roomId: string, password: string): Promise<RoomAccess> {
  const id = roomId.toUpperCase()
  try {
    await ensureSignedIn()
    const roomKey = await deriveRoomKey(id, password)
    const meta = await get(ref(getDb(), `rooms/${roomKey}/meta`))
    if (meta.exists()) return { roomId: id, roomKey }
    const exists = await roomExists(id)
    throw exists
      ? new RoomAccessError('Senha incorreta.', 'wrong_password')
      : new RoomAccessError('A sala não existe mais.', 'not_found')
  } catch (err) {
    if (err instanceof RoomAccessError) throw err
    throw new RoomAccessError(describeDbError(err), 'other')
  }
}

/** Confere uma chave já salva no navegador. */
export async function checkRoomKey(roomKey: string): Promise<boolean> {
  await ensureSignedIn()
  return (await get(ref(getDb(), `rooms/${roomKey}/meta`))).exists()
}
