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
