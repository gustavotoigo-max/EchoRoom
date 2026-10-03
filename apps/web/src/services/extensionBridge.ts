import { tracksFromLink } from '../components/Playlists/linkTracks'
import { authStore, type DiscordProfile } from './discordAuth'
import {
  addToMyPlaylist,
  createMyPlaylist,
  MAX_PLAYLIST_TRACKS,
  subscribeMyPlaylists,
  type Playlist,
} from './firebase/playlists'

/**
 * Pedidos da extensão do Chrome que precisam do login do site:
 *   LIST_PLAYLISTS   → playlists pessoais de quem está logado
 *   ADD_TO_PLAYLIST  → salva a música (ou playlist do YouTube) numa playlist pessoal
 *   NEW_PLAYLIST     → cria uma playlist pessoal já com a música
 *
 * A extensão (echoroom.js) manda { source:'echoroom-extension', type, requestId, ... }
 * por postMessage e recebe { source:'echoroom-page', requestId, ... } de volta.
 */

type Request =
  | { type: 'LIST_PLAYLISTS'; requestId: string }
  | { type: 'ADD_TO_PLAYLIST'; requestId: string; playlistId: string; url: string; title?: string }
  | { type: 'NEW_PLAYLIST'; requestId: string; name: string; url: string; title?: string }

function reply(requestId: string, data: Record<string, unknown>) {
  window.postMessage({ source: 'echoroom-page', requestId, ...data }, window.location.origin)
}

/** Espera a sessão do site ser conferida (até 8 s). */
async function whoAmI(): Promise<DiscordProfile | null> {
  const started = Date.now()
  while (!authStore.get().ready && Date.now() - started < 8000) await new Promise((r) => setTimeout(r, 100))
  return authStore.get().profile
}

function myPlaylistsOnce(uid: string): Promise<Playlist[]> {
  return new Promise((resolve, reject) => {
    let off: (() => void) | null = null
    off = subscribeMyPlaylists(
      uid,
      (lists) => {
        off?.()
        resolve(lists)
      },
      () => reject(new Error('Não foi possível ler suas playlists.')),
    )
  })
}

async function handle(req: Request): Promise<Record<string, unknown>> {
  const me = await whoAmI()
  if (!me) return { ok: false, error: 'login' }
  if (req.type === 'LIST_PLAYLISTS') {
    const lists = await myPlaylistsOnce(me.uid)
    return { ok: true, user: me.name, playlists: lists.map((p) => ({ id: p.id, name: p.name, count: p.tracks.length })) }
  }
  if (req.type === 'NEW_PLAYLIST') {
    const tracks = await tracksFromLink(req.url, MAX_PLAYLIST_TRACKS)
    const first = tracks[0]
    if (first && req.title && tracks.length === 1 && first.title.startsWith('youtu.be/')) first.title = req.title
    const id = await createMyPlaylist(req.name, first)
    const lists = await myPlaylistsOnce(me.uid)
    const pl = lists.find((p) => p.id === id)
    if (pl) for (const t of tracks.slice(1)) await addToMyPlaylist(me, pl, t).catch(() => {})
    return { ok: true, name: req.name.trim(), added: tracks.length }
  }
  // ADD_TO_PLAYLIST
  const lists = await myPlaylistsOnce(me.uid)
  const pl = lists.find((p) => p.id === req.playlistId)
  if (!pl) return { ok: false, error: 'Essa playlist não existe mais.' }
  const tracks = await tracksFromLink(req.url, MAX_PLAYLIST_TRACKS - pl.tracks.length)
  if (tracks.length === 1 && req.title && tracks[0].title.startsWith('youtu.be/')) tracks[0].title = req.title
  let added = 0
  let lastError = ''
  const current = { ...pl, tracks: [...pl.tracks] }
  for (const t of tracks) {
    try {
      await addToMyPlaylist(me, current, t)
      current.tracks.push({ id: t.videoId, videoId: t.videoId, title: t.title, author: t.author ?? '', at: 0 })
      added++
    } catch (err) {
      lastError = (err as Error).message
    }
  }
  if (!added) return { ok: false, error: lastError || 'Essa música já está na playlist.' }
  return { ok: true, name: pl.name, added }
}

export function initExtensionBridge(): void {
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return
    const data = ev.data as Partial<Request> & { source?: string }
    if (data?.source !== 'echoroom-extension' || typeof data.requestId !== 'string') return
    if (data.type !== 'LIST_PLAYLISTS' && data.type !== 'ADD_TO_PLAYLIST' && data.type !== 'NEW_PLAYLIST') return
    const requestId = data.requestId
    handle(data as Request)
      .then((res) => reply(requestId, res))
      .catch((err: Error) => reply(requestId, { ok: false, error: err.message || 'Erro no EchoRoom.' }))
  })
}
