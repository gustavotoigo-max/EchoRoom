import {
  HEARD_OPTIONS,
  isAccountUid,
  REF_LINK_TTL_MS,
  type AdminArrival,
  type AdminUserOrigin,
  type ArrivalVia,
  type FirstVisit,
  type HeardAnswer,
} from '@echoroom/shared'
import { Db } from '../db'
import { readServiceAccount, type Env, type ServiceAccount } from '../env'
import { verifyIdToken } from '../google'
import { HttpError, json, readJson } from '../http'
import type { UserRecord } from '../stats'
import { checkOrigin } from './email'

/**
 * De onde vêm as pessoas (só o admin vê; tudo fica em /admin, fora do alcance do site).
 *
 *   /admin/refLinks/{token}          link pessoal de sala: { uid, name, roomId, roomKey, createdAt, expiresAt }
 *   /admin/arrivals/{uid}/{roomId}   primeira entrada na sala: { at, roomName, via, fromUid, fromName, sentAt, present }
 *   /admin/origins/{uid}             conta nova: { firstVisit, invitedBy, heard, heardDetail, heardSkipped, at }
 *   /admin/refCount/{dia}/{uid}      quantos links a pessoa gerou no dia (limite)
 *
 * Rotas:
 *   POST /ref/link     { roomId, roomKey }  quem é da sala gera o próprio link (24 h)
 *   GET  /ref/link?t=  confere um link (público): sala e quem gerou, ou vencido
 *   POST /ref/arrival  { roomId, roomKey, ref?, invite? }  primeira entrada numa sala
 *   POST /ref/origin   { firstVisit?, ref? }  conta nova: primeira visita e link de quem trouxe
 *   POST /ref/heard    { answer?, detail? }   resposta de "Como você conheceu?" (sem answer = pulou)
 */

export const REF_LINKS_PER_DAY = 30
/** Depois de vencer, o link ainda vale para registrar quem já tinha aberto antes (entrou logo depois). */
const REF_GRACE_MS = 2 * 60 * 60 * 1000
/** Conta é "nova" (pede origem e pergunta) até 7 dias depois de criada. */
const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PRESENT = 20

const KEY_RE = /^[0-9a-f]{64}$/
const ROOM_RE = /^[A-Za-z0-9]{3,12}$/
const TOKEN_RE = /^[A-Za-z0-9]{10,16}$/

interface RefLink {
  uid: string
  name: string
  roomId: string
  roomKey: string
  createdAt: number
  expiresAt: number
}

interface OriginRecord {
  firstVisit?: FirstVisit | null
  invitedBy?: AdminUserOrigin['invitedBy']
  heard?: HeardAnswer | null
  heardDetail?: string
  heardSkipped?: boolean
  at?: number
}

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '')

/** Quem chama (conta ou convidado). */
async function who(request: Request, env: Env): Promise<{ uid: string; sa: ServiceAccount; db: Db }> {
  const sa = readServiceAccount(env)
  if (!sa) throw new HttpError(500, 'not_configured')
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  const caller = token ? await verifyIdToken(token, sa.project_id) : null
  if (!caller) throw new HttpError(401, 'unauthenticated')
  const db = new Db(sa, env)
  if (await db.get(`admin/suspended/${caller.uid}`)) throw new HttpError(403, 'suspended')
  return { uid: caller.uid, sa, db }
}

/** Confere código + chave da sala e que a pessoa já está cadastrada nela. */
async function roomOf(db: Db, uid: string, roomId: unknown, roomKey: unknown): Promise<{ roomId: string; roomKey: string; name: string; ownerUid: string | null }> {
  if (typeof roomId !== 'string' || !ROOM_RE.test(roomId) || typeof roomKey !== 'string' || !KEY_RE.test(roomKey)) throw new HttpError(400, 'bad_request')
  const [meta, member] = await Promise.all([
    db.get<{ roomId?: string; name?: string; ownerUid?: string }>(`rooms/${roomKey}/meta`),
    db.get(`rooms/${roomKey}/members/${uid}`),
  ])
  if (!meta || String(meta.roomId ?? '').toUpperCase() !== roomId.toUpperCase()) throw new HttpError(404, 'room_not_found')
  if (!member) throw new HttpError(403, 'not_member')
  return { roomId: roomId.toUpperCase(), roomKey, name: line(meta.name, 60) || `Sala ${roomId.toUpperCase()}`, ownerUid: meta.ownerUid ?? null }
}

function newToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** POST /ref/link — link pessoal da sala, válido por 24 h. */
export async function createRefLink(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, db } = await who(request, env)
  const body = await readJson<{ roomId?: unknown; roomKey?: unknown }>(request)
  const room = await roomOf(db, uid, body.roomId, body.roomKey)
  const now = Date.now()
  const countPath = `admin/refCount/${dayKey(now)}/${uid}`
  const made = (await db.get<number>(countPath)) ?? 0
  if (made >= REF_LINKS_PER_DAY) throw new HttpError(429, 'ref_limit')
  await db.set(countPath, made + 1)
  const member = await db.get<{ name?: string }>(`rooms/${room.roomKey}/members/${uid}`)
  const token = newToken()
  const link: RefLink = { uid, name: line(member?.name, 32) || 'Alguém', roomId: room.roomId, roomKey: room.roomKey, createdAt: now, expiresAt: now + REF_LINK_TTL_MS }
  await db.set(`admin/refLinks/${token}`, link)
  return json({ token, expiresAt: link.expiresAt })
}

/** GET /ref/link?t=TOKEN — o link ainda vale? (sem login: é aberto antes de entrar) */
export async function checkRefLink(request: Request, env: Env): Promise<Response> {
  const sa = readServiceAccount(env)
  if (!sa) throw new HttpError(500, 'not_configured')
  const t = new URL(request.url).searchParams.get('t') ?? ''
  if (!TOKEN_RE.test(t)) throw new HttpError(404, 'link_not_found')
  const link = await new Db(sa, env).get<RefLink>(`admin/refLinks/${t}`)
  if (!link) throw new HttpError(404, 'link_not_found')
  if (link.expiresAt <= Date.now()) return json({ error: 'link_expired', roomId: link.roomId }, 410)
  return json({ ok: true, roomId: link.roomId, fromName: link.name, expiresAt: link.expiresAt })
}

/** POST /ref/arrival — primeira entrada numa sala: por onde veio e quem estava lá. */
export async function recordArrival(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, db } = await who(request, env)
  const body = await readJson<{ roomId?: unknown; roomKey?: unknown; ref?: unknown; invite?: { fromUid?: unknown; sentAt?: unknown } }>(request)
  const room = await roomOf(db, uid, body.roomId, body.roomKey)
  const path = `admin/arrivals/${uid}/${room.roomId}`
  if (await db.get(path)) return json({ ok: true, recorded: false })
  const now = Date.now()

  let via: ArrivalVia = 'code'
  let fromUid: string | null = null
  let fromName = ''
  let sentAt: number | null = null
  if (room.ownerUid === uid) via = 'owner'
  else {
    const link = typeof body.ref === 'string' && TOKEN_RE.test(body.ref) ? await db.get<RefLink>(`admin/refLinks/${body.ref}`) : null
    if (link && link.roomKey === room.roomKey && link.uid !== uid && link.expiresAt + REF_GRACE_MS > now) {
      via = 'link'
      fromUid = link.uid
      fromName = link.name
      sentAt = link.createdAt
    } else if (body.invite && typeof body.invite.fromUid === 'string' && isAccountUid(body.invite.fromUid) && body.invite.fromUid !== uid) {
      // Convite pelo site: quem mandou precisa ser da sala (as regras já exigiram isso ao criar).
      const inviter = await db.get<{ name?: string }>(`rooms/${room.roomKey}/members/${body.invite.fromUid}`)
      if (inviter) {
        via = 'invite'
        fromUid = body.invite.fromUid
        fromName = line(inviter.name, 32)
        const s = Number(body.invite.sentAt)
        sentAt = Number.isFinite(s) && s > 0 && s <= now ? s : null
      }
    }
  }

  const participants = (await db.get<Record<string, { name?: string; conns?: Record<string, unknown> }>>(`rooms/${room.roomKey}/participants`)) ?? {}
  const present = Object.entries(participants)
    .filter(([id, p]) => id !== uid && p && p.conns && Object.keys(p.conns).length > 0)
    .slice(0, MAX_PRESENT)
    .map(([id, p]) => ({ uid: id, name: line(p.name, 32) || 'Convidado' }))

  const arrival: Omit<AdminArrival, 'roomId'> = { roomName: room.name, at: now, via, fromUid, fromName, sentAt, present }
  await db.set(path, arrival)
  return json({ ok: true, recorded: true, via })
}

function cleanVisit(v: unknown): FirstVisit | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const at = Number(o.at)
  if (!Number.isFinite(at) || at <= 0 || at > Date.now() + 60_000) return null
  const referrer = line(o.referrer, 100).toLowerCase()
  return {
    at,
    landing: line(o.landing, 120),
    referrer: /^[a-z0-9.-]*$/.test(referrer) ? referrer : '',
    source: line(o.source, 60),
    medium: line(o.medium, 60),
    campaign: line(o.campaign, 60),
  }
}

/** POST /ref/origin — conta nova: guarda a primeira visita e quem trouxe. Responde se deve perguntar "Como conheceu?". */
export async function recordOrigin(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, db } = await who(request, env)
  if (!isAccountUid(uid)) throw new HttpError(401, 'unauthenticated')
  const body = await readJson<{ firstVisit?: unknown; ref?: unknown }>(request)
  const [user, prev] = await Promise.all([db.get<UserRecord>(`admin/users/${uid}`), db.get<OriginRecord>(`admin/origins/${uid}`)])
  const now = Date.now()
  const isNew = !!user?.firstAt && now - user.firstAt < NEW_ACCOUNT_MS
  if (!isNew) return json({ ok: true, ask: false })
  if (!prev) {
    const rec: OriginRecord = { firstVisit: cleanVisit(body.firstVisit), at: now }
    const link = typeof body.ref === 'string' && TOKEN_RE.test(body.ref) ? await db.get<RefLink>(`admin/refLinks/${body.ref}`) : null
    // O link tem que ter sido aberto antes da conta existir (ou logo depois).
    if (link && link.uid !== uid && link.createdAt <= now && link.expiresAt + REF_GRACE_MS > (user?.firstAt ?? now)) {
      rec.invitedBy = { uid: link.uid, name: link.name, via: 'link', roomId: link.roomId, sentAt: link.createdAt, at: user?.firstAt ?? now }
    }
    await db.set(`admin/origins/${uid}`, rec)
  }
  const answered = !!prev?.heard || !!prev?.heardSkipped
  return json({ ok: true, ask: !answered })
}

/** POST /ref/heard — "Como você conheceu o SpectraCast?" (opcional; sem resposta = pulou). */
export async function recordHeard(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, db } = await who(request, env)
  if (!isAccountUid(uid)) throw new HttpError(401, 'unauthenticated')
  const body = await readJson<{ answer?: unknown; detail?: unknown }>(request)
  const answer = HEARD_OPTIONS.find((o) => o === body.answer) ?? null
  if (body.answer != null && !answer) throw new HttpError(400, 'bad_request')
  const prev = await db.get<OriginRecord>(`admin/origins/${uid}`)
  if (prev?.heard) return json({ ok: true })
  await db.update(`admin/origins/${uid}`, {
    heard: answer,
    heardDetail: answer ? line(body.detail, 80) : '',
    heardSkipped: !answer,
    heardAt: Date.now(),
    ...(prev ? {} : { at: Date.now() }),
  })
  return json({ ok: true })
}

/** Origem para a tela da pessoa no admin. */
export async function originFor(db: Db, uid: string): Promise<AdminUserOrigin | undefined> {
  const [rec, arrivals] = await Promise.all([
    db.get<OriginRecord>(`admin/origins/${uid}`),
    db.get<Record<string, Omit<AdminArrival, 'roomId'>>>(`admin/arrivals/${uid}`),
  ])
  const list: AdminArrival[] = Object.entries(arrivals ?? {})
    .map(([roomId, a]) => ({
      roomId,
      roomName: a.roomName ?? roomId,
      at: a.at ?? 0,
      via: a.via ?? 'code',
      fromUid: a.fromUid ?? null,
      fromName: a.fromName ?? '',
      sentAt: a.sentAt ?? null,
      present: (Array.isArray(a.present) ? a.present : Object.values(a.present ?? {})) as AdminArrival['present'],
    }))
    .sort((a, b) => a.at - b.at)
  if (!rec && !list.length) return undefined
  const first = list.find((a) => a.via === 'link' || a.via === 'invite')
  const invitedBy =
    rec?.invitedBy ??
    (first && first.fromUid
      ? { uid: first.fromUid, name: first.fromName, via: first.via as 'link' | 'invite', roomId: first.roomId, sentAt: first.sentAt, at: first.at }
      : null)
  return {
    firstVisit: rec?.firstVisit ?? null,
    heard: rec?.heard ?? null,
    heardDetail: rec?.heardDetail ?? '',
    heardSkipped: !!rec?.heardSkipped,
    invitedBy,
    arrivals: list,
  }
}
