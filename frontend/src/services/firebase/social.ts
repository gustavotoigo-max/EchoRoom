import {
  endAt,
  get,
  limitToFirst,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  serverTimestamp,
  set,
  startAt,
  update,
} from 'firebase/database'
import { createStore } from '../../stores/createStore'
import { storage } from '../../utils/storage'
import type { DiscordProfile } from '../discordAuth'
import { ensureSignedIn, getDb, isDiscordUid } from './app'

/**
 * Perfis, "Minhas salas" e convites (só para quem entrou com Discord).
 *
 *   /profiles/{uid}              { name, u (usuário em minúsculas), avatar }  — busca de pessoas
 *   /users/{uid}/rooms/{roomId}  { key, name, role, lastAt }                  — privado
 *   /invites/{paraUid}/{id}      { fromUid, fromName, fromAvatar, roomId, roomKey, roomName, createdAt, expiresAt }
 *
 * As regras do banco garantem que o perfil bate com o login do Discord,
 * que só quem é da sala convida e que só o convidado lê o convite.
 */

export const INVITE_TTL_MS = 60 * 60 * 1000

export interface PublicProfile {
  uid: string
  name: string
  username: string
  avatar: string
}

export interface MyRoom {
  roomId: string
  key: string
  name: string
  role: 'owner' | 'member'
  lastAt: number
}

export interface Invite {
  id: string
  fromUid: string
  fromName: string
  fromAvatar: string
  roomId: string
  roomKey: string
  roomName: string
  createdAt: number
  expiresAt: number
}

// ---- relógio do servidor (para a validade dos convites) ---------------------------

let offset = 0
let offsetWatching = false
export function serverNow(): number {
  if (!offsetWatching) {
    offsetWatching = true
    try {
      onValue(ref(getDb(), '.info/serverTimeOffset'), (s) => (offset = Number(s.val()) || 0))
    } catch {
      /* sem Firebase */
    }
  }
  return Date.now() + offset
}

// ---- perfil ------------------------------------------------------------------------

export async function publishProfile(p: DiscordProfile): Promise<void> {
  try {
    await set(ref(getDb(), `profiles/${p.uid}`), {
      name: p.name,
      u: p.username.toLowerCase(),
      avatar: p.avatarUrl,
      at: serverTimestamp(),
    })
  } catch {
    /* o perfil público é atualizado no próximo acesso */
  }
}

/** Busca por nome de usuário do Discord (começo do nome, mínimo 2 letras). */
export async function searchProfiles(text: string): Promise<PublicProfile[]> {
  const q = text.trim().replace(/^@/, '').toLowerCase()
  if (q.length < 2) return []
  const snap = await get(query(ref(getDb(), 'profiles'), orderByChild('u'), startAt(q), endAt(q + ''), limitToFirst(8)))
  const v = (snap.val() ?? {}) as Record<string, { name?: string; u?: string; avatar?: string }>
  return Object.entries(v)
    .map(([uid, p]) => ({ uid, name: p.name || p.u || 'Discord', username: p.u || '', avatar: p.avatar || '' }))
    .sort((a, b) => a.username.localeCompare(b.username))
}

// ---- minhas salas ----------------------------------------------------------------------

export function subscribeMyRooms(uid: string, cb: (rooms: MyRoom[]) => void, onError: () => void): () => void {
  return onValue(
    ref(getDb(), `users/${uid}/rooms`),
    (snap) => {
      const v = (snap.val() ?? {}) as Record<string, Partial<MyRoom>>
      cb(
        Object.entries(v)
          .filter(([, r]) => typeof r.key === 'string')
          .map(([roomId, r]): MyRoom => ({
            roomId,
            key: r.key!,
            name: r.name || `Sala ${roomId}`,
            role: r.role === 'owner' ? 'owner' : 'member',
            lastAt: Number(r.lastAt) || 0,
          }))
          .sort((a, b) => b.lastAt - a.lastAt),
      )
    },
    onError,
  )
}

/** Tira a sala da lista do perfil (sem mexer na sala). */
export async function forgetMyRoom(roomId: string): Promise<void> {
  const uid = await ensureSignedIn()
  if (!isDiscordUid(uid)) return
  await remove(ref(getDb(), `users/${uid}/rooms/${roomId}`))
}

/** Sair da sala: some do perfil e da lista de membros da sala. */
export async function leaveRoom(room: MyRoom): Promise<void> {
  const uid = await ensureSignedIn()
  const db = getDb()
  await remove(ref(db, `rooms/${room.key}/members/${uid}`)).catch(() => {})
  await remove(ref(db, `users/${uid}/rooms/${room.roomId}`))
  storage.clearRoomKey(room.roomId)
}

// ---- convites ----------------------------------------------------------------------------

export async function sendInvite(
  from: DiscordProfile,
  to: PublicProfile,
  room: { roomId: string; roomKey: string; roomName: string },
): Promise<void> {
  if (to.uid === from.uid) throw new Error('Você já está nesta sala.')
  const db = getDb()
  // Já está na sala? Não precisa de convite.
  const member = await get(ref(db, `rooms/${room.roomKey}/members/${to.uid}`)).catch(() => null)
  if (member?.exists()) throw new Error(`${to.name} já faz parte desta sala.`)
  await set(push(ref(db, `invites/${to.uid}`)), {
    fromUid: from.uid,
    fromName: from.name,
    fromAvatar: from.avatarUrl,
    roomId: room.roomId,
    roomKey: room.roomKey,
    roomName: room.roomName.slice(0, 60),
    createdAt: serverTimestamp(),
    expiresAt: Math.round(serverNow() + INVITE_TTL_MS),
  })
}

function readInvites(v: Record<string, Partial<Invite>> | null): Invite[] {
  return Object.entries(v ?? {})
    .filter(([, i]) => i && typeof i.roomKey === 'string' && typeof i.roomId === 'string')
    .map(([id, i]) => ({
      id,
      fromUid: i.fromUid || '',
      fromName: i.fromName || 'Alguém',
      fromAvatar: i.fromAvatar || '',
      roomId: i.roomId!,
      roomKey: i.roomKey!,
      roomName: i.roomName || `Sala ${i.roomId}`,
      createdAt: Number(i.createdAt) || 0,
      expiresAt: Number(i.expiresAt) || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Convites recebidos, já sem os expirados (que são apagados). */
export const inviteStore = createStore<{ invites: Invite[]; uid: string | null }>({ invites: [], uid: null })

let stopInvites: (() => void) | null = null
let expiryTimer: ReturnType<typeof setInterval> | null = null

export function watchInvites(uid: string | null): void {
  if (inviteStore.get().uid === uid) return
  stopInvites?.()
  stopInvites = null
  if (expiryTimer) clearInterval(expiryTimer)
  expiryTimer = null
  inviteStore.set({ uid, invites: [] })
  if (!uid) return
  let all: Invite[] = []
  const publish = () => {
    const now = serverNow()
    const live = all.filter((i) => i.expiresAt > now)
    // Convites vencidos são apagados (o destinatário pode apagar).
    for (const i of all) if (i.expiresAt <= now) void remove(ref(getDb(), `invites/${uid}/${i.id}`)).catch(() => {})
    inviteStore.set({ invites: live })
  }
  stopInvites = onValue(
    ref(getDb(), `invites/${uid}`),
    (snap) => {
      all = readInvites(snap.val())
      publish()
    },
    () => inviteStore.set({ invites: [] }),
  )
  expiryTimer = setInterval(publish, 30_000)
}

/** Aceita: a sala entra no perfil e a chave fica salva neste navegador. */
export async function acceptInvite(inv: Invite): Promise<void> {
  if (inv.expiresAt <= serverNow()) {
    await declineInvite(inv)
    throw new Error('Este convite expirou.')
  }
  const uid = await ensureSignedIn()
  const db = getDb()
  await update(ref(db, `users/${uid}/rooms/${inv.roomId}`), {
    key: inv.roomKey,
    name: inv.roomName,
    role: 'member',
    lastAt: serverTimestamp(),
  })
  storage.setRoomKey(inv.roomId, inv.roomKey)
  await remove(ref(db, `invites/${uid}/${inv.id}`)).catch(() => {})
}

export async function declineInvite(inv: Invite): Promise<void> {
  const uid = await ensureSignedIn()
  await remove(ref(getDb(), `invites/${uid}/${inv.id}`))
}

/** "expira em 42 min" */
export function expiresIn(inv: Invite): string {
  const min = Math.max(0, Math.ceil((inv.expiresAt - serverNow()) / 60_000))
  return min <= 1 ? 'expira em menos de 1 min' : `expira em ${min} min`
}
