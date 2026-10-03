import { fetchManyVideoMeta, fetchVideoMeta } from '../../services/youtube/metadata'
import { loadPlaylistVideoIds } from '../../services/youtube/playlist'
import type { TrackInput } from '../../services/firebase/playlists'
import { parseYouTubeLink } from '../../utils/youtubeUrlParser'

/** Músicas de um link do YouTube (vídeo ou playlist inteira) para guardar numa playlist do EchoRoom. */
export async function tracksFromLink(url: string, limit: number): Promise<TrackInput[]> {
  const link = parseYouTubeLink(url)
  if (link.kind === 'invalid') throw new Error('Link do YouTube inválido. Use um link de vídeo ou de playlist.')
  if (link.kind === 'video') {
    const m = await fetchVideoMeta(link.videoId)
    return [{ videoId: link.videoId, title: m.title, author: m.author }]
  }
  const ids = (await loadPlaylistVideoIds(link.playlistId)).slice(0, Math.max(0, limit))
  const metas = await fetchManyVideoMeta(ids)
  return ids.map((videoId, i) => ({ videoId, title: metas[i]?.title || `youtu.be/${videoId}`, author: metas[i]?.author ?? '' }))
}
