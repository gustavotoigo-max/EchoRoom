import { get, ref, runTransaction, serverTimestamp, set, update } from 'firebase/database'
import { emptyRoom, toFirebase } from '../../rooms/roomLogic'
import { DEFAULT_SETTINGS, type RoomSettings } from '../../types/room'
import { describeDbError, ensureSignedIn, getDb, isDiscordUid, isPermissionDenied } from './app'
import { deriveRoomKey } from './roomCrypto'

/** Criação e entrada em salas (equivalente ao antigo POST /rooms e /join). */

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem 0/O, 1/I
export const MIN_PASSWORD = 4
export const MAX_ROOM_NAME = 40

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

/**
 * Cria uma sala com nome e senha. Só quem entrou com Discord pode criar:
 * o dono precisa de uma conta fixa para administrar a sala de qualquer lugar.
 */
export async function createRoom(name: string, password: string, ownerName: string): Promise<RoomAccess> {
  const roomName = name.trim().slice(0, MAX_ROOM_NAME)
  if (!roomName) throw new RoomAccessError('Dê um nome para a sala.', 'other')
  if (password.length < MIN_PASSWORD) {
    throw new RoomAccessError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`, 'other')
  }
  try {
    const uid = await ensureSignedIn()
    if (!isDiscordUid(uid)) throw new RoomAccessError('Entre com Discord para criar uma sala.', 'other')
    const db = getDb()
    for (let attempt = 0; attempt < 10; attempt++) {
      const roomId = newRoomId()
      // Reserva o código: só grava se ainda não existir.
      const res = await runTransaction(ref(db, `roomIndex/${roomId}`), (cur) =>
        cur === null ? { createdAt: serverTimestamp(), ownerUid: uid } : undefined,
      )
      if (!res.committed) continue
      const roomKey = await deriveRoomKey(roomId, password)
      await update(
        ref(db, `rooms/${roomKey}`),
        toFirebase({
          meta: { roomId, name: roomName, ownerUid: uid, ownerName: ownerName.slice(0, 32), createdAt: serverTimestamp() },
          settings: DEFAULT_SETTINGS,
          state: emptyRoom(roomId),
        }),
      )
      return { roomId, roomKey }
    }
    throw new RoomAccessError('Não foi possível gerar um código de sala livre. Tente de novo.', 'other')
  } catch (err) {
    if (err instanceof RoomAccessError) throw err
    throw new RoomAccessError(describeDbError(err), 'other')
  }
}

/**
 * Por que o banco recusou o acesso à sala: bloqueio do dono ou sala só para
 * quem entra com Discord. Retorna null se não for nenhum dos dois.
 */
export async function explainAccessDenied(roomKey: string): Promise<string | null> {
  const uid = await ensureSignedIn()
  const db = getDb()
  const banned = await get(ref(db, `rooms/${roomKey}/banned/${uid}`)).catch(() => null)
  if (banned?.exists()) return 'O dono da sala bloqueou a sua entrada.'
  if (!isDiscordUid(uid)) {
    const guests = await get(ref(db, `rooms/${roomKey}/settings/allowGuests`)).catch(() => null)
    if (guests?.val() === false) return 'Esta sala aceita só quem entra com Discord.'
  }
  return null
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
    let meta
    try {
      meta = await get(ref(getDb(), `rooms/${roomKey}/meta`))
    } catch (err) {
      if (!isPermissionDenied(err)) throw err
      // Sem permissão: senha certa, mas bloqueado ou sala só para Discord.
      const why = await explainAccessDenied(roomKey)
      if (why) throw new RoomAccessError(why, 'other')
      throw err
    }
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

// ---- ações do dono --------------------------------------------------------------

const roomPath = (roomKey: string, sub = '') => `rooms/${roomKey}${sub ? `/${sub}` : ''}`

export async function updateSettings(roomKey: string, patch: Partial<RoomSettings>): Promise<void> {
  await update(ref(getDb(), roomPath(roomKey, 'settings')), toFirebase(patch))
}

export async function renameRoom(roomKey: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, MAX_ROOM_NAME)
  if (!clean) throw new Error('O nome não pode ficar vazio.')
  await set(ref(getDb(), roomPath(roomKey, 'meta/name')), clean)
}

/** Sala antiga (sem dono): quem entrou com Discord pode assumir. */
export async function claimRoom(roomKey: string, ownerName: string): Promise<void> {
  const uid = await ensureSignedIn()
  if (!isDiscordUid(uid)) throw new Error('Entre com Discord para assumir a sala.')
  await update(ref(getDb(), roomPath(roomKey, 'meta')), { ownerUid: uid, ownerName: ownerName.slice(0, 32) })
}

/** Remove da sala agora (a pessoa pode voltar com a senha). */
export async function kickParticipant(roomKey: string, uid: string): Promise<void> {
  await update(ref(getDb(), roomPath(roomKey)), {
    [`kicks/${uid}`]: serverTimestamp(),
    [`participants/${uid}`]: null,
    [`members/${uid}`]: null,
  })
}

/** Remove e impede de voltar (até o dono desbloquear). */
export async function banParticipant(roomKey: string, uid: string, name: string): Promise<void> {
  await update(ref(getDb(), roomPath(roomKey)), {
    [`banned/${uid}`]: { name: name.slice(0, 32), at: serverTimestamp() },
    [`participants/${uid}`]: null,
    [`members/${uid}`]: null,
  })
}

export async function unbanParticipant(roomKey: string, uid: string): Promise<void> {
  await set(ref(getDb(), roomPath(roomKey, `banned/${uid}`)), null)
}

/** Apaga a sala inteira (dados, fila, sugestões) e libera o código. */
export async function deleteRoom(roomId: string, roomKey: string): Promise<void> {
  const db = getDb()
  await set(ref(db, `roomIndex/${roomId}`), null)
  await set(ref(db, roomPath(roomKey)), null)
}
