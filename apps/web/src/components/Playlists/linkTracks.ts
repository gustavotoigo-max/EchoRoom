import { fetchManyVideoMeta, fetchPlaylistTitle, fetchVideoMeta } from '../../services/youtube/metadata'
import { loadPlaylistVideoIds } from '../../services/youtube/playlist'
import { importMyPlaylist, MAX_PLAYLIST_TRACKS, type TrackInput } from '../../services/firebase/playlists'
import { parseYouTubeLink } from '../../utils/youtubeUrlParser'

/** Músicas de um link do YouTube (vídeo ou playlist inteira) para guardar numa playlist do EchoRoom. */
export async function tracksFromLink(url: string, limit: number): Promise<TrackInput[]> {
  const link = parseYouTubeLink(url)
  if (link.kind === 'invalid') throw new Error('Link do YouTube inválido. Use um link de vídeo ou de playlist.')
  if (link.kind === 'video') {
    const m = await fetchVideoMeta(link.videoId)
    return [{ videoId: link.videoId, title: m.title, author: m.author }]
  }
  return playlistTracks(link.playlistId, limit)
}

async function playlistTracks(listId: string, limit: number, onProgress?: (text: string) => void): Promise<TrackInput[]> {
  onProgress?.('Lendo a playlist…')
  const ids = (await loadPlaylistVideoIds(listId)).slice(0, Math.max(0, limit))
  const metas = await fetchManyVideoMeta(ids, (done, n) => onProgress?.(`Buscando títulos… ${done}/${n}`))
  return ids.map((videoId, i) => ({ videoId, title: metas[i]?.title || `youtu.be/${videoId}`, author: metas[i]?.author ?? '' }))
}

/**
 * Importa uma playlist do YouTube ou do YouTube Music (pelo link) para a
 * biblioteca da pessoa. Aceita também um vídeo aberto dentro de uma playlist.
 */
export async function importPlaylistFromLink(
  url: string,
  onProgress?: (text: string) => void,
): Promise<{ id: string; name: string; added: number; skipped: number }> {
  const link = parseYouTubeLink(url)
  const listId = link.kind === 'playlist' ? link.playlistId : link.kind === 'video' ? link.playlistId : null
  if (!listId) throw new Error('Cole o link de uma playlist do YouTube ou do YouTube Music.')
  const [title, tracks] = await Promise.all([fetchPlaylistTitle(listId), playlistTracks(listId, MAX_PLAYLIST_TRACKS + 1, onProgress)])
  const name = title || `Playlist de ${tracks[0]?.title ?? 'YouTube'}`
  onProgress?.('Salvando…')
  const kind = /(^|\/\/)music\.youtube\.com\//i.test(url.trim()) ? 'youtubeMusic' : 'youtube'
  const res = await importMyPlaylist(name, tracks, { kind, listId })
  return { ...res, name }
}
