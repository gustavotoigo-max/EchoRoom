/**
 * Versão do celular de services/youtube/playlist: lê os vídeos de uma
 * playlist do YouTube sem chave de API.
 *
 * No site isso usa um player escondido; no app (sem DOM, mas também sem
 * bloqueio de CORS) basta ler a página pública da playlist e pegar os ids
 * na ordem em que aparecem. Mixes automáticos ("RD…") são lidos da página
 * de vídeo com a lista ao lado.
 */

const TIMEOUT_MS = 15_000
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal })
    if (!res.ok) throw new Error(String(res.status))
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/** Ids na ordem, cada um uma vez, logo depois de cada marcador. */
function idsAfter(html: string, marker: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const parts = html.split(marker).slice(1)
  for (const part of parts) {
    const m = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(part.slice(0, 4000))
    if (m && !seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

export async function loadPlaylistVideoIds(playlistId: string): Promise<string[]> {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(playlistId)) throw new Error('Playlist inválida.')
  let ids: string[] = []
  if (playlistId.startsWith('RD') && playlistId.length === 13) {
    // Mix automático de um vídeo: página do vídeo com a lista ao lado.
    const html = await fetchText(`https://www.youtube.com/watch?v=${playlistId.slice(2)}&list=${playlistId}`)
    ids = idsAfter(html, '"playlistPanelVideoRenderer":')
  } else {
    const html = await fetchText(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`)
    ids = idsAfter(html, '"playlistVideoRenderer":')
    if (!ids.length) ids = idsAfter(html, '"playlistPanelVideoRenderer":')
  }
  if (!ids.length) throw new Error('Não foi possível ler esta playlist. Ela é pública ou não listada?')
  return ids
}
