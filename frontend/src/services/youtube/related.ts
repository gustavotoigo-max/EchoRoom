import { fetchManyVideoMeta } from './metadata'
import { loadPlaylistVideoIds } from './playlist'

/**
 * Músicas parecidas com um vídeo, tiradas do "Mix" automático do YouTube
 * (playlist "RD" + id do vídeo) — a mesma fonte das sugestões que o YouTube
 * mostra no fim do vídeo. Sem chave de API: lido por um player escondido.
 */

export interface RelatedTrack {
  videoId: string
  title: string
  author: string
}

const cache = new Map<string, Promise<RelatedTrack[]>>()
const MAX = 12

export function getRelated(videoId: string): Promise<RelatedTrack[]> {
  let p = cache.get(videoId)
  if (!p) {
    p = load(videoId).catch(() => {
      cache.delete(videoId) // tenta de novo numa próxima vez
      return []
    })
    cache.set(videoId, p)
  }
  return p
}

async function load(videoId: string): Promise<RelatedTrack[]> {
  const ids = (await loadPlaylistVideoIds(`RD${videoId}`)).filter((id) => id !== videoId)
  const unique = [...new Set(ids)].slice(0, MAX)
  const metas = await fetchManyVideoMeta(unique)
  // Sem título (serviço de títulos fora do ar) ainda vale: a miniatura identifica a música.
  return unique.map((id, i) => ({ videoId: id, title: metas[i]?.title || `youtu.be/${id}`, author: metas[i]?.author ?? '' }))
}
