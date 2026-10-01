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

const LIST_RE = /^[A-Za-z0-9_-]{10,64}$/

/** Extrai o id de playlist (?list=...) de um link do YouTube. */
export function extractPlaylistId(raw: string): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, '')
  if (!['youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) return null
  const list = url.searchParams.get('list')
  return list && LIST_RE.test(list) ? list : null
}

export type ParsedYouTubeLink =
  | { kind: 'video'; videoId: string; playlistId: string | null }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'invalid' }

/**
 * Classifica um link colado:
 * - /playlist?list=…            → playlist inteira
 * - watch?v=…&list=…            → vídeo (com opção de adicionar a playlist)
 * - watch?v=…, youtu.be/…, etc. → vídeo
 */
export function parseYouTubeLink(raw: string): ParsedYouTubeLink {
  const videoId = extractVideoId(raw)
  const playlistId = extractPlaylistId(raw)
  if (videoId) return { kind: 'video', videoId, playlistId }
  if (playlistId) return { kind: 'playlist', playlistId }
  return { kind: 'invalid' }
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}
