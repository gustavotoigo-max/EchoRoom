import { GOOGLE_CLIENT_ID, loadGoogle } from '../googleAuth'
import type { TrackInput } from '../firebase/playlists'

/**
 * Playlists da conta Google da pessoa (YouTube e YouTube Music).
 *
 * O acesso (só leitura) é pedido na hora, numa janela do Google, e o token fica
 * só na memória desta aba: não é guardado nem enviado ao EchoRoom. Cada página
 * da API do YouTube custa 1 unidade da cota diária.
 */

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'
const API = 'https://www.googleapis.com/youtube/v3'

let token: { value: string; exp: number } | null = null

/** Pede (ou reaproveita) o acesso de leitura ao YouTube. Precisa vir de um clique. */
export async function youtubeAccess(): Promise<string> {
  if (token && token.exp > Date.now()) return token.value
  const google = await loadGoogle()
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return reject(new Error('O Google não liberou o acesso às suas playlists.'))
        token = { value: r.access_token, exp: Date.now() + 50 * 60_000 }
        resolve(r.access_token)
      },
      error_callback: (e) =>
        reject(new Error(e?.type === 'popup_closed' ? 'Janela do Google fechada antes de terminar.' : 'Não foi possível abrir a janela do Google.')),
    })
    client.requestAccessToken({ prompt: '' })
  })
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const access = await youtubeAccess()
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${access}` } })
  if (res.status === 401) token = null
  if (!res.ok) {
    const reason = ((await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } }).error?.errors?.[0]?.reason
    if (reason === 'quotaExceeded') throw new Error('A cota diária do YouTube acabou. Tente amanhã.')
    if (reason === 'youtubeSignupRequired') throw new Error('Essa conta Google não tem canal do YouTube, então não tem playlists.')
    throw new Error('O YouTube recusou o pedido. Tente de novo.')
  }
  return (await res.json()) as T
}

export interface AccountPlaylist {
  id: string
  title: string
  count: number
  thumb: string
}

interface Page<T> {
  items?: T[]
  nextPageToken?: string
}

/** Playlists da conta (até 200). */
export async function listMyYouTubePlaylists(): Promise<AccountPlaylist[]> {
  const out: AccountPlaylist[] = []
  let pageToken = ''
  do {
    const page = await get<
      Page<{ id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } }; contentDetails?: { itemCount?: number } }>
    >('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '50', ...(pageToken ? { pageToken } : {}) })
    for (const p of page.items ?? []) {
      out.push({ id: p.id, title: p.snippet?.title || 'Sem nome', count: p.contentDetails?.itemCount ?? 0, thumb: p.snippet?.thumbnails?.default?.url ?? '' })
    }
    pageToken = page.nextPageToken ?? ''
  } while (pageToken && out.length < 200)
  return out
}

/** Músicas de uma playlist da conta (inclusive privadas), sem vídeos apagados ou privados. */
export async function myPlaylistTracks(playlistId: string, limit: number): Promise<TrackInput[]> {
  const out: TrackInput[] = []
  let pageToken = ''
  do {
    const page = await get<
      Page<{ snippet?: { title?: string; videoOwnerChannelTitle?: string }; contentDetails?: { videoId?: string } }>
    >('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) })
    for (const it of page.items ?? []) {
      const videoId = it.contentDetails?.videoId
      // Vídeo apagado ou privado: o YouTube manda sem dono.
      if (!videoId || !it.snippet?.videoOwnerChannelTitle) continue
      out.push({ videoId, title: it.snippet.title || `youtu.be/${videoId}`, author: it.snippet.videoOwnerChannelTitle.replace(/ - Topic$/, '') })
    }
    pageToken = page.nextPageToken ?? ''
  } while (pageToken && out.length < limit)
  return out.slice(0, limit)
}
