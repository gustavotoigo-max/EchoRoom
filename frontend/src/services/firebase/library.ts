import {
  get,
  increment,
  limitToLast,
  onValue,
  orderByChild,
  query,
  ref,
  remove,
  serverTimestamp,
  update,
} from 'firebase/database'
import { ensureSignedIn, getDb } from './app'

/**
 * Biblioteca de sugestões, compartilhada entre todas as salas do site.
 *
 *   /library/tracks/{videoId}      { title, author, count, lastAt, lastBy }
 *   /library/playlists/{listId}    { title, size, firstVideoId, count, lastAt, lastBy }
 *
 * Cada vez que alguém adiciona uma música (ou playlist), o contador sobe e a
 * data é atualizada. Falhas aqui nunca atrapalham a sala: são silenciosas.
 */

export const LIBRARY_LIMIT = 300

export interface LibraryTrack {
  kind: 'track'
  id: string
  title: string
  author: string
  count: number
  lastAt: number
  lastBy: string
}

export interface LibraryPlaylist {
  kind: 'playlist'
  id: string
  title: string
  size: number
  firstVideoId: string
  count: number
  lastAt: number
  lastBy: string
}

export type LibraryEntry = LibraryTrack | LibraryPlaylist

const isProvisional = (title: string) => !title || title.startsWith('youtu.be/') || title.startsWith('Playlist ')

export async function recordTrack(videoId: string, title: string, author: string, by: string): Promise<void> {
  try {
    await ensureSignedIn()
    const r = ref(getDb(), `library/tracks/${videoId}`)
    // Não troca um título bom por um provisório.
    const current = (await get(r)).val() as { title?: string } | null
    const keepTitle = current?.title && !isProvisional(current.title) && isProvisional(title)
    await update(r, {
      ...(keepTitle ? {} : { title: title.slice(0, 200), author: author.slice(0, 120) }),
      count: increment(1),
      lastAt: serverTimestamp(),
      lastBy: by.slice(0, 32),
    })
  } catch {
    /* sugestões são opcionais */
  }
}

export async function recordPlaylist(
  listId: string,
  title: string,
  size: number,
  firstVideoId: string,
  by: string,
): Promise<void> {
  try {
    await ensureSignedIn()
    const r = ref(getDb(), `library/playlists/${listId}`)
    const current = (await get(r)).val() as { title?: string } | null
    const keepTitle = current?.title && !isProvisional(current.title) && isProvisional(title)
    await update(r, {
      ...(keepTitle ? {} : { title: title.slice(0, 200) }),
      size,
      firstVideoId,
      count: increment(1),
      lastAt: serverTimestamp(),
      lastBy: by.slice(0, 32),
    })
  } catch {
    /* sugestões são opcionais */
  }
}

/** Corrige um título provisório quando o player descobre o título real. */
export async function fixTrackTitle(videoId: string, title: string): Promise<void> {
  if (isProvisional(title)) return
  try {
    const r = ref(getDb(), `library/tracks/${videoId}`)
    const current = (await get(r)).val() as { title?: string } | null
    if (current && isProvisional(current.title ?? '')) await update(r, { title: title.slice(0, 200) })
  } catch {
    /* ignora */
  }
}

export async function removeEntry(entry: LibraryEntry): Promise<void> {
  await remove(ref(getDb(), `library/${entry.kind === 'track' ? 'tracks' : 'playlists'}/${entry.id}`))
}

/**
 * Acompanha a biblioteca em tempo real (as mais recentes, até LIBRARY_LIMIT
 * de cada tipo). `onError` recebe a mensagem se as regras não permitirem.
 */
export function subscribeLibrary(
  onData: (entries: LibraryEntry[]) => void,
  onError: (message: string) => void,
): () => void {
  let tracks: LibraryEntry[] = []
  let playlists: LibraryEntry[] = []
  const emit = () => onData([...tracks, ...playlists])
  const unsubs: (() => void)[] = []
  let cancelled = false

  ensureSignedIn()
    .then(() => {
      if (cancelled) return
      const db = getDb()
      const fail = () =>
        onError('As sugestões precisam das regras novas do Firebase (database.rules.json). Peça para quem cuida do site atualizar.')
      unsubs.push(
        onValue(
          query(ref(db, 'library/tracks'), orderByChild('lastAt'), limitToLast(LIBRARY_LIMIT)),
          (snap) => {
            const v = (snap.val() ?? {}) as Record<string, Omit<LibraryTrack, 'kind' | 'id'>>
            tracks = Object.entries(v).map(([id, t]) => ({
              kind: 'track' as const,
              id,
              title: t.title || `youtu.be/${id}`,
              author: t.author || '',
              count: Number(t.count) || 1,
              lastAt: Number(t.lastAt) || 0,
              lastBy: t.lastBy || '',
            }))
            emit()
          },
          fail,
        ),
        onValue(
          query(ref(db, 'library/playlists'), orderByChild('lastAt'), limitToLast(LIBRARY_LIMIT)),
          (snap) => {
            const v = (snap.val() ?? {}) as Record<string, Omit<LibraryPlaylist, 'kind' | 'id'>>
            playlists = Object.entries(v).map(([id, p]) => ({
              kind: 'playlist' as const,
              id,
              title: p.title || 'Playlist',
              size: Number(p.size) || 0,
              firstVideoId: p.firstVideoId || '',
              count: Number(p.count) || 1,
              lastAt: Number(p.lastAt) || 0,
              lastBy: p.lastBy || '',
            }))
            emit()
          },
          fail,
        ),
      )
    })
    .catch(() => onError('Não foi possível carregar as sugestões.'))

  return () => {
    cancelled = true
    unsubs.forEach((u) => u())
  }
}
