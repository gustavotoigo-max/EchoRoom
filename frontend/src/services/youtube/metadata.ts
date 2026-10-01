/**
 * Título/autor de um vídeo sem chave de API, via noembed (CORS liberado).
 * Se falhar, a música entra com título provisório e o primeiro navegador
 * que carregar o vídeo envia o título real (TRACK_META).
 */
export interface VideoMeta {
  title: string
  author: string
  resolved: boolean
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

/** Busca títulos de vários vídeos com poucas requisições simultâneas. */
export async function fetchManyVideoMeta(
  videoIds: string[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 6,
): Promise<VideoMeta[]> {
  const out: VideoMeta[] = new Array(videoIds.length)
  let next = 0
  let done = 0
  let resolved = 0
  async function worker() {
    while (next < videoIds.length) {
      const i = next++
      // Se as primeiras buscas falharam todas, o serviço está fora: não insiste.
      const giveUp = done >= concurrency && resolved === 0
      out[i] = giveUp
        ? { title: `youtu.be/${videoIds[i]}`, author: '', resolved: false }
        : await fetchVideoMeta(videoIds[i], 4000)
      if (out[i].resolved) resolved++
      onProgress?.(++done, videoIds.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, videoIds.length) }, worker))
  return out
}

export async function fetchVideoMeta(videoId: string, timeoutMs = 3000): Promise<VideoMeta> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const url = `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
    const res = await fetch(url, { signal: ctrl.signal })
    const data = (await res.json()) as { title?: string; author_name?: string; error?: string }
    if (data.title && !data.error) {
      return { title: data.title.slice(0, 200), author: (data.author_name ?? '').slice(0, 120), resolved: true }
    }
  } catch {
    /* rede ou bloqueio: usa o provisório */
  } finally {
    clearTimeout(timer)
  }
  return { title: `youtu.be/${videoId}`, author: '', resolved: false }
}
