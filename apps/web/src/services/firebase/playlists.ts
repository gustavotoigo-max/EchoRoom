import { onValue, push, ref, remove, serverTimestamp, set, update } from 'firebase/database'
import { toFirebase } from '../../rooms/roomLogic'
import type { DiscordProfile } from '../discordAuth'
import { ensureSignedIn, getDb } from './app'

/**
 * Playlists do EchoRoom.
 *
 * - Da sala:    /rooms/{chave}/playlists/{id}  { kind:'room', name, createdBy, createdByName, tracks }
 *   Qualquer um na sala põe músicas; quem criou (ou o dono da sala) edita e apaga.
 * - Pessoais:   /users/{uid}/playlists/{id}    { name, tracks, sharedIn: { roomId: chave } }
 *   Só a pessoa vê. Ao "sugerir na sala", uma cópia vai para /rooms/{chave}/playlists/{id}
 *   com kind:'personal' — e é atualizada quando a pessoa edita a playlist.
 */

export const MAX_PLAYLIST_TRACKS = 200
export const MAX_PLAYLIST_NAME = 60

export interface PlaylistTrack {
  id: string
  videoId: string
  title: string
  author: string
  at: number
}

export interface Playlist {
  id: string
  name: string
  kind: 'room' | 'personal'
  createdBy: string
  createdByName: string
  createdByAvatar: string
  tracks: PlaylistTrack[]
  updatedAt: number
  /** Só nas pessoais: salas em que está sugerida (roomId → chave). */
  sharedIn: Record<string, string>
}

type RawTrack = Partial<Omit<PlaylistTrack, 'id'>>
type RawPlaylist = Partial<Omit<Playlist, 'id' | 'tracks'>> & { tracks?: Record<string, RawTrack> }

function readPlaylist(id: string, p: RawPlaylist, kind?: Playlist['kind']): Playlist {
  const tracks = Object.entries(p.tracks ?? {})
    .filter(([, t]) => t && typeof t.videoId === 'string')
    .map(([tid, t]) => ({
      id: tid,
      videoId: t.videoId!,
      title: t.title || `youtu.be/${t.videoId}`,
      author: t.author || '',
      at: Number(t.at) || 0,
    }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  return {
    id,
    name: p.name || 'Playlist',
    kind: kind ?? (p.kind === 'personal' ? 'personal' : 'room'),
    createdBy: p.createdBy || '',
    createdByName: p.createdByName || '',
    createdByAvatar: p.createdByAvatar || '',
    tracks,
    updatedAt: Number(p.updatedAt) || 0,
    sharedIn: (p.sharedIn as Record<string, string>) ?? {},
  }
}

const cleanName = (name: string) => {
  const n = name.trim().slice(0, MAX_PLAYLIST_NAME)
  if (!n) throw new Error('Dê um nome para a playlist.')
  return n
}

export interface TrackInput {
  videoId: string
  title: string
  author?: string
}

function trackRecord(t: TrackInput) {
  return { videoId: t.videoId, title: t.title.slice(0, 200), author: (t.author ?? '').slice(0, 120), at: serverTimestamp() }
}

function checkAdd(pl: Playlist, t: TrackInput): void {
  if (pl.tracks.some((x) => x.videoId === t.videoId)) throw new Error(`Essa música já está em "${pl.name}".`)
  if (pl.tracks.length >= MAX_PLAYLIST_TRACKS) throw new Error(`A playlist chegou ao limite de ${MAX_PLAYLIST_TRACKS} músicas.`)
}

// ---- playlists da sala ---------------------------------------------------------------

export function subscribeRoomPlaylists(roomKey: string, cb: (lists: Playlist[]) => void, onError: () => void): () => void {
  return onValue(
    ref(getDb(), `rooms/${roomKey}/playlists`),
    (snap) => {
      const v = (snap.val() ?? {}) as Record<string, RawPlaylist>
      cb(
        Object.entries(v)
          .map(([id, p]) => readPlaylist(id, p))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      )
    },
    onError,
  )
}

export async function createRoomPlaylist(
  roomKey: string,
  name: string,
  me: { name: string; avatar: string | null },
  first?: TrackInput,
): Promise<string> {
  const uid = await ensureSignedIn()
  const r = push(ref(getDb(), `rooms/${roomKey}/playlists`))
  await set(
    r,
    toFirebase({
      kind: 'room',
      name: cleanName(name),
      createdBy: uid,
      createdByName: me.name.slice(0, 32),
      createdByAvatar: me.avatar ?? '',
      updatedAt: serverTimestamp(),
      tracks: first ? { t0: trackRecord(first) } : undefined,
    }),
  )
  return r.key!
}

export async function addToRoomPlaylist(roomKey: string, pl: Playlist, t: TrackInput): Promise<void> {
  checkAdd(pl, t)
  const base = `rooms/${roomKey}/playlists/${pl.id}`
  await set(push(ref(getDb(), `${base}/tracks`)), trackRecord(t))
  await set(ref(getDb(), `${base}/updatedAt`), serverTimestamp()).catch(() => {})
}

export async function removeFromRoomPlaylist(roomKey: string, pl: Playlist, trackId: string): Promise<void> {
  await remove(ref(getDb(), `rooms/${roomKey}/playlists/${pl.id}/tracks/${trackId}`))
}

export async function renameRoomPlaylist(roomKey: string, pl: Playlist, name: string): Promise<void> {
  await update(ref(getDb(), `rooms/${roomKey}/playlists/${pl.id}`), { name: cleanName(name), updatedAt: serverTimestamp() })
}

/** Apaga da sala (playlist da sala) ou tira a sugestão (cópia de playlist pessoal). */
export async function removeRoomPlaylist(roomKey: string, roomId: string, pl: Playlist): Promise<void> {
  await remove(ref(getDb(), `rooms/${roomKey}/playlists/${pl.id}`))
  if (pl.kind === 'personal') {
    const uid = await ensureSignedIn()
    if (uid === pl.createdBy) await remove(ref(getDb(), `users/${uid}/playlists/${pl.id}/sharedIn/${roomId}`)).catch(() => {})
  }
}

// ---- playlists pessoais ------------------------------------------------------------------

export function subscribeMyPlaylists(uid: string, cb: (lists: Playlist[]) => void, onError: () => void): () => void {
  return onValue(
    ref(getDb(), `users/${uid}/playlists`),
    (snap) => {
      const v = (snap.val() ?? {}) as Record<string, RawPlaylist>
      cb(
        Object.entries(v)
          .map(([id, p]) => ({ ...readPlaylist(id, p, 'personal'), createdBy: uid }))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      )
    },
    onError,
  )
}

export async function createMyPlaylist(name: string, first?: TrackInput): Promise<string> {
  const uid = await ensureSignedIn()
  const r = push(ref(getDb(), `users/${uid}/playlists`))
  await set(
    r,
    toFirebase({ name: cleanName(name), updatedAt: serverTimestamp(), tracks: first ? { t0: trackRecord(first) } : undefined }),
  )
  return r.key!
}

/** Cópia que vai para as salas onde a playlist está sugerida. */
function roomCopy(pl: Playlist, me: DiscordProfile) {
  return {
    kind: 'personal',
    name: pl.name,
    createdBy: me.uid,
    createdByName: me.name,
    createdByAvatar: me.avatarUrl,
    updatedAt: serverTimestamp(),
    tracks: Object.fromEntries(
      pl.tracks.map((t) => [t.id, { videoId: t.videoId, title: t.title, author: t.author, at: t.at || 0 }]),
    ),
  }
}

/** Atualiza as cópias nas salas (melhor esforço: se uma sala sumiu, tira da lista). */
async function syncCopies(pl: Playlist, me: DiscordProfile): Promise<void> {
  const db = getDb()
  await Promise.all(
    Object.entries(pl.sharedIn).map(([roomId, key]) =>
      set(ref(db, `rooms/${key}/playlists/${pl.id}`), toFirebase(roomCopy(pl, me))).catch(() =>
        remove(ref(db, `users/${me.uid}/playlists/${pl.id}/sharedIn/${roomId}`)).catch(() => {}),
      ),
    ),
  )
}

/** Lê a versão mais nova da playlist pessoal (depois de uma alteração). */
function latest(uid: string, id: string): Promise<Playlist> {
  return new Promise((resolve) => {
    const off = onValue(ref(getDb(), `users/${uid}/playlists/${id}`), (snap) => {
      off()
      resolve({ ...readPlaylist(id, (snap.val() ?? {}) as RawPlaylist, 'personal'), createdBy: uid })
    })
  })
}

export async function addToMyPlaylist(me: DiscordProfile, pl: Playlist, t: TrackInput): Promise<void> {
  checkAdd(pl, t)
  await set(push(ref(getDb(), `users/${me.uid}/playlists/${pl.id}/tracks`)), trackRecord(t))
  await set(ref(getDb(), `users/${me.uid}/playlists/${pl.id}/updatedAt`), serverTimestamp())
  if (Object.keys(pl.sharedIn).length) await syncCopies(await latest(me.uid, pl.id), me)
}

export async function removeFromMyPlaylist(me: DiscordProfile, pl: Playlist, trackId: string): Promise<void> {
  await remove(ref(getDb(), `users/${me.uid}/playlists/${pl.id}/tracks/${trackId}`))
  if (Object.keys(pl.sharedIn).length) await syncCopies(await latest(me.uid, pl.id), me)
}

export async function renameMyPlaylist(me: DiscordProfile, pl: Playlist, name: string): Promise<void> {
  await update(ref(getDb(), `users/${me.uid}/playlists/${pl.id}`), { name: cleanName(name), updatedAt: serverTimestamp() })
  if (Object.keys(pl.sharedIn).length) await syncCopies({ ...pl, name: cleanName(name) }, me)
}

export async function deleteMyPlaylist(me: DiscordProfile, pl: Playlist): Promise<void> {
  const db = getDb()
  await Promise.all(Object.values(pl.sharedIn).map((key) => remove(ref(db, `rooms/${key}/playlists/${pl.id}`)).catch(() => {})))
  await remove(ref(db, `users/${me.uid}/playlists/${pl.id}`))
}

/** Sugere a playlist pessoal numa sala (a sala passa a ver uma cópia, sempre atualizada). */
export async function shareToRoom(me: DiscordProfile, pl: Playlist, roomId: string, roomKey: string): Promise<void> {
  const db = getDb()
  await set(ref(db, `rooms/${roomKey}/playlists/${pl.id}`), toFirebase(roomCopy(pl, me)))
  await set(ref(db, `users/${me.uid}/playlists/${pl.id}/sharedIn/${roomId}`), roomKey)
}

export async function unshareFromRoom(me: DiscordProfile, pl: Playlist, roomId: string): Promise<void> {
  const key = pl.sharedIn[roomId]
  if (key) await remove(ref(getDb(), `rooms/${key}/playlists/${pl.id}`)).catch(() => {})
  await remove(ref(getDb(), `users/${me.uid}/playlists/${pl.id}/sharedIn/${roomId}`))
}
