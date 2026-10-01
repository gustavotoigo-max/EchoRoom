/**
 * Normaliza links do YouTube e extrai o videoId (11 caracteres).
 * Função única — usada pelo campo "Adicionar música" e por qualquer
 * futura busca. O servidor revalida com a mesma regra.
 *
 * Aceita: youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/…,
 * /embed/…, /live/…, m.youtube.com, music.youtube.com e o próprio ID.
 */
const ID_RE = /^[A-Za-z0-9_-]{11}$/

export function extractVideoId(raw: string): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  if (ID_RE.test(text)) return text

  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '')
  let candidate: string | null = null

  if (host === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') candidate = url.searchParams.get('v')
    else if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) candidate = parts[1]
  }
  return candidate && ID_RE.test(candidate) ? candidate : null
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}
