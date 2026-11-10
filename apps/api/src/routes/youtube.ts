import type { Env } from '../env'
import { HttpError, json } from '../http'
import { isPlaylistId, isVideoId, NotFoundError, oembed, playlistContent } from '../youtube'

/**
 * Rotas públicas de metadados do YouTube (o site usa para mostrar título e autor).
 *
 *   GET /yt/video?id=<11 caracteres>   { title, author }               (oEmbed, sem chave)
 *   GET /yt/playlist?list=<id>         { title, items:[{videoId, title, author}] }   (Data API, até 200)
 */

const VIDEO_TTL = 86_400
const PLAYLIST_TTL = 3_600

/** Cache do Worker (Cache API). Fora do Cloudflare (testes) não existe e é ignorado. */
async function cached(key: string, ttl: number, make: () => Promise<unknown>): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined
  const req = new Request(key)
  const hit = await cache?.match(req).catch(() => undefined)
  if (hit) return new Response(hit.body, hit)
  const res = json(await make(), 200, { 'Cache-Control': `public, max-age=${ttl}` })
  await cache?.put(req, res.clone()).catch(() => {})
  return res
}

export async function ytVideo(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? ''
  if (!isVideoId(id)) throw new HttpError(400, 'bad_request')
  return cached(`${url.origin}/yt/video?id=${id}`, VIDEO_TTL, async () => {
    let meta
    try {
      meta = await oembed(id)
    } catch {
      throw new HttpError(502, 'youtube_error')
    }
    if (!meta) throw new HttpError(404, 'not_found')
    return meta
  })
}

export async function ytPlaylist(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const list = url.searchParams.get('list') ?? ''
  if (!isPlaylistId(list)) throw new HttpError(400, 'bad_request')
  const key = env.YOUTUBE_API_KEY
  if (!key) throw new HttpError(503, 'not_configured')
  return cached(`${url.origin}/yt/playlist?list=${list}`, PLAYLIST_TTL, async () => {
    try {
      return await playlistContent(list, key)
    } catch (err) {
      if (err instanceof NotFoundError) throw new HttpError(404, 'not_found')
      throw new HttpError(502, 'youtube_error')
    }
  })
}
