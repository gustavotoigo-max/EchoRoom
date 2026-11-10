import { mapLimit, type Db } from './db'
import { DAY_MS } from './stats'
import { isPlaylistId, isVideoId, oembed, playlistsMeta, videosMeta, type VideoMeta } from './youtube'

/**
 * Parte da rotina diária que cuida dos dados vindos do YouTube e do bate-papo.
 *
 * 1. Títulos e autores do YouTube guardados no banco (Developer Policies III.E.4:
 *    no máximo 30 dias sem atualizar). Cada registro ganha `titledAt` (quando o
 *    título foi gravado); passou de 30 dias, o título é buscado de novo
 *    (Data API videos.list com a chave; sem chave, oEmbed com limite por execução).
 *    Vídeo que não existe mais: a sugestão da sala é apagada; nas playlists a
 *    música fica, só sem título e autor (o site mostra "youtu.be/<id>").
 *      /rooms/{chave}/library/tracks/{videoId}      { title, author, lastAt, titledAt }
 *      /rooms/{chave}/library/playlists/{listId}    { title, lastAt, titledAt }
 *      /rooms/{chave}/playlists/{id}/tracks/{tid}   { videoId, title, author, at, titledAt }
 *      /users/{uid}/playlists/{id}/tracks/{tid}     { videoId, title, author, at, titledAt }
 * 2. Bate-papo: em /rooms/{chave}/chat ficam só as últimas 200 mensagens (por `at`)
 *    e nenhuma com mais de 30 dias.
 *
 * O plano grátis do Cloudflare permite poucas requisições por execução, então
 * cada dia passa por algumas salas e pessoas, continuando de onde parou
 * (/admin/maintenance/cursor), e o resto fica para o dia seguinte.
 */

export const TITLE_MAX_AGE_MS = 30 * DAY_MS
export const CHAT_KEEP = 200
export const CHAT_MAX_AGE_MS = 30 * DAY_MS

export interface MaintenanceOptions {
  /** Chave da YouTube Data API (sem ela, usa o oEmbed). */
  apiKey?: string
  now?: number
  /** Salas + pessoas lidas por execução (cada uma é uma leitura no banco). */
  entitiesPerRun?: number
  /** Vídeos e playlists atualizados por execução, com a chave. */
  videosPerRun?: number
  /** Chamadas ao oEmbed por execução, sem a chave. */
  oembedPerRun?: number
}

export interface MaintenanceReport {
  at: number
  entities: number
  refreshed: number
  gone: number
  /** Registros vencidos que ficaram para a próxima execução. */
  pending: number
  chatDeleted: number
}

const CURSOR = 'admin/maintenance/cursor'

/** Data em ms plausível (depois de 2001); números pequenos são a ordem das músicas, não datas. */
const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 1e12 ? v : null)
const hasTitle = (v: unknown) => typeof v === 'string' && v.length > 0

interface TitledRecord {
  /** Caminho do registro no banco. */
  path: string
  kind: 'video' | 'playlist'
  /** videoId ou id da playlist no YouTube. */
  id: string
  /** Quando o título foi gravado (null = não se sabe). */
  base: number | null
  hasTitledAt: boolean
  /** O que fazer se o vídeo não existir mais. */
  onGone: 'delete' | 'clear'
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})

function playlistTracks(prefix: string, playlists: unknown, out: TitledRecord[]): void {
  for (const [pid, p] of Object.entries(obj(playlists))) {
    for (const [tid, raw] of Object.entries(obj(obj(p).tracks))) {
      const t = obj(raw)
      if (typeof t.videoId !== 'string' || !isVideoId(t.videoId) || !hasTitle(t.title)) continue
      out.push({
        path: `${prefix}/${pid}/tracks/${tid}`,
        kind: 'video',
        id: t.videoId,
        base: time(t.titledAt) ?? time(t.at),
        hasTitledAt: time(t.titledAt) !== null,
        onGone: 'clear',
      })
    }
  }
}

/** Registros com título do YouTube dentro de uma sala. */
export function roomRecords(roomPath: string, room: unknown): TitledRecord[] {
  const out: TitledRecord[] = []
  const library = obj(obj(room).library)
  for (const [vid, raw] of Object.entries(obj(library.tracks))) {
    const t = obj(raw)
    if (!isVideoId(vid) || !hasTitle(t.title)) continue
    out.push({ path: `${roomPath}/library/tracks/${vid}`, kind: 'video', id: vid, base: time(t.titledAt) ?? time(t.lastAt), hasTitledAt: time(t.titledAt) !== null, onGone: 'delete' })
  }
  for (const [lid, raw] of Object.entries(obj(library.playlists))) {
    const p = obj(raw)
    if (!isPlaylistId(lid) || !hasTitle(p.title)) continue
    out.push({ path: `${roomPath}/library/playlists/${lid}`, kind: 'playlist', id: lid, base: time(p.titledAt) ?? time(p.lastAt), hasTitledAt: time(p.titledAt) !== null, onGone: 'delete' })
  }
  playlistTracks(`${roomPath}/playlists`, obj(room).playlists, out)
  return out
}

/** Mensagens a apagar: além das 200 mais recentes (por `at`) ou com mais de 30 dias. */
export function chatDeletes(chat: unknown, now: number, keep = CHAT_KEEP, maxAge = CHAT_MAX_AGE_MS): string[] {
  const list = Object.entries(obj(chat)).map(([id, m]) => ({ id, at: typeof obj(m).at === 'number' ? (obj(m).at as number) : 0 }))
  list.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
  return list.filter((m, i) => i >= keep || m.at < now - maxAge).map((m) => m.id)
}

/** Busca título e autor; null = não existe mais. Ids ausentes do resultado ficam para depois (erro ou limite). */
async function lookup(
  videos: string[],
  playlists: string[],
  opts: Required<Pick<MaintenanceOptions, 'oembedPerRun'>> & { apiKey?: string },
): Promise<{ videos: Map<string, VideoMeta | null>; playlists: Map<string, VideoMeta | null> }> {
  const out = { videos: new Map<string, VideoMeta | null>(), playlists: new Map<string, VideoMeta | null>() }
  if (opts.apiKey) {
    const key = opts.apiKey
    await Promise.all([
      videosMeta(videos, key)
        .then((found) => videos.forEach((id) => out.videos.set(id, found.get(id) ?? null)))
        .catch((err) => console.error('videos.list falhou:', err)),
      playlistsMeta(playlists, key)
        .then((found) => playlists.forEach((id) => out.playlists.set(id, found.get(id) ?? null)))
        .catch((err) => console.error('playlists.list falhou:', err)),
    ])
    return out
  }
  const jobs = [...videos.map((id) => ({ id, kind: 'video' as const })), ...playlists.map((id) => ({ id, kind: 'playlist' as const }))]
  await mapLimit(jobs.slice(0, opts.oembedPerRun), 4, async (j) => {
    try {
      const meta = await oembed(j.id, j.kind)
      ;(j.kind === 'video' ? out.videos : out.playlists).set(j.id, meta)
    } catch {
      /* fica para a próxima execução */
    }
  })
  return out
}

export async function youtubeMaintenance(db: Db, options: MaintenanceOptions = {}): Promise<MaintenanceReport> {
  const now = options.now ?? Date.now()
  const entitiesPerRun = options.entitiesPerRun ?? 20
  const videosPerRun = options.videosPerRun ?? 500
  const oembedPerRun = options.oembedPerRun ?? 10

  // Salas e pessoas numa fila só, continuando depois da última visitada.
  const [rooms, users, cursor] = await Promise.all([db.keys('rooms'), db.keys('users'), db.get<string>(CURSOR)])
  const all = [...rooms.map((k) => `rooms/${k}`), ...users.map((u) => `users/${u}`)].sort()
  const start = cursor ? all.findIndex((e) => e > cursor) : 0
  const ordered = start > 0 ? [...all.slice(start), ...all.slice(0, start)] : all
  const chosen = ordered.slice(0, entitiesPerRun)
  const data = await mapLimit(chosen, 4, (e) => db.get<unknown>(e.startsWith('users/') ? `${e}/playlists` : e))

  const patch: Record<string, unknown> = {}
  const records: TitledRecord[] = []
  let chatDeleted = 0
  chosen.forEach((e, i) => {
    const v = data[i]
    if (!v) return
    if (e.startsWith('rooms/')) {
      const old = chatDeletes(obj(v).chat, now)
      for (const id of old) patch[`${e}/chat/${id}`] = null
      chatDeleted += old.length
      records.push(...roomRecords(e, v))
    } else {
      playlistTracks(`${e}/playlists`, v, records)
    }
  })

  // Registros antigos sem `titledAt` ganham a data que já se conhece.
  const cutoff = now - TITLE_MAX_AGE_MS
  const stale: TitledRecord[] = []
  for (const r of records) {
    if (r.base === null || r.base < cutoff) stale.push(r)
    else if (!r.hasTitledAt) patch[`${r.path}/titledAt`] = r.base
  }

  // Os mais antigos primeiro, até o limite da execução.
  stale.sort((a, b) => (a.base ?? 0) - (b.base ?? 0))
  const videoIds = new Set<string>()
  const listIds = new Set<string>()
  for (const r of stale) {
    if (videoIds.size + listIds.size >= videosPerRun) break
    ;(r.kind === 'video' ? videoIds : listIds).add(r.id)
  }
  const found = await lookup([...videoIds], [...listIds], { apiKey: options.apiKey, oembedPerRun })

  let refreshed = 0
  let gone = 0
  let pending = 0
  for (const r of stale) {
    const map = r.kind === 'video' ? found.videos : found.playlists
    if (!map.has(r.id)) {
      pending++
      continue
    }
    const meta = map.get(r.id)
    if (meta) {
      refreshed++
      patch[`${r.path}/title`] = meta.title.slice(0, 200)
      if (r.kind === 'video') patch[`${r.path}/author`] = meta.author.slice(0, 120)
      patch[`${r.path}/titledAt`] = now
    } else {
      gone++
      if (r.onGone === 'delete') patch[r.path] = null
      else {
        patch[`${r.path}/title`] = null
        patch[`${r.path}/author`] = null
        patch[`${r.path}/titledAt`] = null
      }
    }
  }

  const report: MaintenanceReport = { at: now, entities: chosen.length, refreshed, gone, pending, chatDeleted }
  patch[CURSOR] = chosen.at(-1) ?? null
  patch['admin/maintenance/lastRun'] = report
  await db.update('', patch)
  return report
}
