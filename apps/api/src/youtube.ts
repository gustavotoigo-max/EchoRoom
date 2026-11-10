/**
 * Dados públicos do YouTube: oEmbed oficial (sem chave) e YouTube Data API v3
 * (com a chave em YOUTUBE_API_KEY). Só título e autor; nada de vídeo ou áudio.
 */

const OEMBED = 'https://www.youtube.com/oembed'
const DATA_API = 'https://www.googleapis.com/youtube/v3'

export const isVideoId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id)
export const isPlaylistId = (id: string) => /^[A-Za-z0-9_-]{10,64}$/.test(id)

export interface VideoMeta {
  title: string
  author: string
}

/** Erro do YouTube que não é "não existe" (cota, chave errada, fora do ar…). */
export class YoutubeError extends Error {}

/** Playlist inexistente ou privada. */
export class NotFoundError extends Error {}

/**
 * oEmbed de um vídeo (ou de uma playlist, com `kind: 'playlist'`).
 * null = não existe, é privado ou não pode ser incorporado.
 */
export async function oembed(id: string, kind: 'video' | 'playlist' = 'video'): Promise<VideoMeta | null> {
  const target = kind === 'video' ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/playlist?list=${id}`
  const res = await fetch(`${OEMBED}?${new URLSearchParams({ url: target, format: 'json' })}`)
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return null
  if (!res.ok) throw new YoutubeError(`oEmbed respondeu ${res.status}.`)
  const data = (await res.json()) as { title?: unknown; author_name?: unknown }
  return { title: String(data.title ?? ''), author: String(data.author_name ?? '') }
}

async function dataApi<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const res = await fetch(`${DATA_API}/${path}?${new URLSearchParams({ ...params, key })}`)
  if (res.ok) return (await res.json()) as T
  // Playlist que não existe (404) ou é privada (403 playlistItemsNotAccessible).
  if (res.status === 404) throw new NotFoundError()
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null
    if (body?.error?.errors?.some((e) => e.reason === 'playlistItemsNotAccessible')) throw new NotFoundError()
  }
  throw new YoutubeError(`YouTube Data API respondeu ${res.status} em ${path}.`)
}

interface SnippetList {
  items?: { id?: string; snippet?: { title?: string; channelTitle?: string } }[]
}

/**
 * Título e autor de até 50 vídeos por chamada (videos.list, 1 unidade de cota).
 * Vídeos apagados ou privados não aparecem no resultado.
 */
export async function videosMeta(ids: string[], key: string): Promise<Map<string, VideoMeta>> {
  const out = new Map<string, VideoMeta>()
  for (let i = 0; i < ids.length; i += 50) {
    const data = await dataApi<SnippetList>('videos', { part: 'snippet', id: ids.slice(i, i + 50).join(','), maxResults: '50' }, key)
    for (const v of data.items ?? []) {
      if (v.id && v.snippet) out.set(v.id, { title: v.snippet.title ?? '', author: v.snippet.channelTitle ?? '' })
    }
  }
  return out
}

/** Título e canal de até 50 playlists por chamada (playlists.list, 1 unidade). Inexistentes não aparecem. */
export async function playlistsMeta(ids: string[], key: string): Promise<Map<string, VideoMeta>> {
  const out = new Map<string, VideoMeta>()
  for (let i = 0; i < ids.length; i += 50) {
    const data = await dataApi<SnippetList>('playlists', { part: 'snippet', id: ids.slice(i, i + 50).join(','), maxResults: '50' }, key)
    for (const p of data.items ?? []) {
      if (p.id && p.snippet) out.set(p.id, { title: p.snippet.title ?? '', author: p.snippet.channelTitle ?? '' })
    }
  }
  return out
}

export const PLAYLIST_MAX_ITEMS = 200

interface PlaylistItemsPage {
  nextPageToken?: string
  items?: {
    snippet?: { title?: string; videoOwnerChannelTitle?: string; resourceId?: { videoId?: string } }
    contentDetails?: { videoId?: string }
  }[]
}

export interface PlaylistContent {
  title: string
  items: ({ videoId: string } & VideoMeta)[]
}

/**
 * Título e músicas de uma playlist (lê no máximo 4 páginas = 200 itens), pulando vídeos privados ou apagados
 * (eles vêm sem o canal do dono e com título "Private video"/"Deleted video").
 * Lança NotFoundError se a playlist não existir.
 */
export async function playlistContent(listId: string, key: string): Promise<PlaylistContent> {
  const meta = (await playlistsMeta([listId], key)).get(listId)
  if (!meta) throw new NotFoundError()
  const items: PlaylistContent['items'] = []
  let pageToken = ''
  // Até 4 páginas de 50 (cada uma custa 1 unidade de cota).
  for (let page = 0; page < PLAYLIST_MAX_ITEMS / 50; page++) {
    const params: Record<string, string> = { part: 'snippet,contentDetails', playlistId: listId, maxResults: '50' }
    if (pageToken) params.pageToken = pageToken
    const data = await dataApi<PlaylistItemsPage>('playlistItems', params, key)
    for (const it of data.items ?? []) {
      const videoId = it.contentDetails?.videoId ?? it.snippet?.resourceId?.videoId ?? ''
      const owner = it.snippet?.videoOwnerChannelTitle
      if (!isVideoId(videoId) || !owner) continue
      items.push({ videoId, title: it.snippet?.title ?? '', author: owner })
      if (items.length >= PLAYLIST_MAX_ITEMS) break
    }
    if (items.length >= PLAYLIST_MAX_ITEMS || !data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return { title: meta.title, items }
}
