import type {
  AccessMode,
  AdminRequest,
  AdminRoom,
  AdminUser,
  AdminUserDetail,
  AuditEntry,
} from '@echoroom/shared'
import { mapLimit, type Db } from '../db'
import { adminUids, type Env } from '../env'
import { HttpError, json, readJson } from '../http'
import { activityByDay, lastDays, onlineNow, overview, type UserRecord } from '../stats'

/**
 * API de administração. Toda chamada exige o token de login do Firebase de
 * alguém listado em ADMIN_UIDS. Não expõe o conteúdo das salas (fila, músicas):
 * só dados gerais para acompanhar o uso e moderar.
 */

export interface Admin {
  uid: string
  name: string
}

interface Ctx {
  db: Db
  env: Env
  admin: Admin
}

async function audit(ctx: Ctx, action: string, target: string, detail = ''): Promise<void> {
  await ctx.db.push('admin/audit', { at: Date.now(), by: ctx.admin.uid, byName: ctx.admin.name, action, target, detail }).catch(() => {})
}

// ---- pessoas --------------------------------------------------------------------

async function listUsers(ctx: Ctx): Promise<AdminUser[]> {
  const [users, suspended, activity] = await Promise.all([
    ctx.db.get<Record<string, UserRecord>>('admin/users'),
    ctx.db.get<Record<string, { at?: number; reason?: string }>>('admin/suspended'),
    activityByDay(ctx.db, lastDays(30)),
  ])
  const lastActive = new Map<string, string>()
  for (const [day, uids] of activity) for (const u of uids) lastActive.set(u, day) // dias em ordem: fica o último
  const admins = adminUids(ctx.env)
  return Object.entries(users ?? {})
    .map(([uid, u]) => ({
      uid,
      name: u.name ?? '',
      username: u.username ?? '',
      avatar: u.avatar ?? '',
      firstAt: u.firstAt ?? 0,
      lastLoginAt: u.lastLoginAt ?? 0,
      logins: u.logins ?? 0,
      lastActiveDay: lastActive.get(uid) ?? null,
      suspended: suspended?.[uid] ? { at: suspended[uid].at ?? 0, reason: suspended[uid].reason ?? '' } : null,
      admin: admins.includes(uid),
    }))
    .sort((a, b) => b.lastLoginAt - a.lastLoginAt)
}

async function userDetail(ctx: Ctx, uid: string): Promise<AdminUserDetail> {
  const all = await listUsers(ctx)
  const base = all.find((u) => u.uid === uid)
  if (!base) throw new HttpError(404, 'not_found')
  const [rooms, playlists] = await Promise.all([
    ctx.db.get<Record<string, { name?: string; role?: string }>>(`users/${uid}/rooms`),
    ctx.db.keys(`users/${uid}/playlists`),
  ])
  return {
    ...base,
    rooms: Object.entries(rooms ?? {}).map(([roomId, r]) => ({ roomId, name: r.name ?? roomId, role: r.role === 'owner' ? 'owner' : 'member' })),
    playlists: playlists.length,
  }
}

async function suspend(ctx: Ctx, uid: string, reason: string): Promise<void> {
  if (adminUids(ctx.env).includes(uid)) throw new HttpError(400, 'cannot_suspend_admin')
  const u = await ctx.db.get<UserRecord>(`admin/users/${uid}`)
  await ctx.db.set(`admin/suspended/${uid}`, { at: Date.now(), reason: reason.slice(0, 200), by: ctx.admin.uid, name: u?.name ?? '' })
  await audit(ctx, 'suspender', uid, reason)
}

async function unsuspend(ctx: Ctx, uid: string): Promise<void> {
  await ctx.db.remove(`admin/suspended/${uid}`)
  await audit(ctx, 'reativar', uid)
}

/** Apaga os dados da pessoa (perfil, salas da lista, playlists, convites, cadastro). */
async function deleteUser(ctx: Ctx, uid: string): Promise<void> {
  if (adminUids(ctx.env).includes(uid)) throw new HttpError(400, 'cannot_delete_admin')
  const [rooms, playlists] = await Promise.all([
    ctx.db.get<Record<string, { key?: string; role?: string }>>(`users/${uid}/rooms`),
    ctx.db.get<Record<string, { sharedIn?: Record<string, string> }>>(`users/${uid}/playlists`),
  ])
  const patch: Record<string, null | string> = {
    [`users/${uid}`]: null,
    [`profiles/${uid}`]: null,
    [`invites/${uid}`]: null,
    [`admin/users/${uid}`]: null,
    [`admin/requests/${uid}`]: null,
    [`admin/approved/${uid}`]: null,
  }
  for (const r of Object.values(rooms ?? {})) {
    if (!r.key || !/^[0-9a-f]{64}$/.test(r.key)) continue
    patch[`rooms/${r.key}/members/${uid}`] = null
    patch[`rooms/${r.key}/participants/${uid}`] = null
  }
  for (const [pid, p] of Object.entries(playlists ?? {})) {
    for (const key of Object.values(p.sharedIn ?? {})) if (/^[0-9a-f]{64}$/.test(key)) patch[`rooms/${key}/playlists/${pid}`] = null
  }
  // Salas em que era dono ficam sem dono (alguém pode assumir).
  for (const r of Object.values(rooms ?? {})) {
    if (r.role === 'owner' && r.key && /^[0-9a-f]{64}$/.test(r.key)) {
      const owner = await ctx.db.get<string>(`rooms/${r.key}/meta/ownerUid`)
      if (owner === uid) {
        patch[`rooms/${r.key}/meta/ownerUid`] = null
        patch[`rooms/${r.key}/meta/ownerName`] = ''
      }
    }
  }
  await ctx.db.update('', patch)
  await audit(ctx, 'apagar cadastro', uid)
}

// ---- salas ------------------------------------------------------------------------

interface MetaRecord {
  roomId?: string
  name?: string
  ownerUid?: string
  ownerName?: string
  createdAt?: number
}

async function roomMetas(ctx: Ctx): Promise<{ key: string; meta: MetaRecord }[]> {
  const keys = await ctx.db.keys('rooms')
  const metas = await mapLimit(keys, 8, (k) => ctx.db.get<MetaRecord>(`rooms/${k}/meta`))
  return keys.map((key, i) => ({ key, meta: metas[i] ?? {} })).filter((r) => r.meta.roomId)
}

async function listRooms(ctx: Ctx): Promise<AdminRoom[]> {
  const [metas, online] = await Promise.all([roomMetas(ctx), onlineNow(ctx.db)])
  const extra = await mapLimit(metas, 8, async ({ key }) => {
    const [members, guests] = await Promise.all([
      ctx.db.keys(`rooms/${key}/members`),
      ctx.db.get<boolean>(`rooms/${key}/settings/allowGuests`),
    ])
    return { members: members.length, allowGuests: guests !== false }
  })
  return metas
    .map(({ key, meta }, i) => ({
      roomId: meta.roomId!,
      name: meta.name ?? `Sala ${meta.roomId}`,
      ownerUid: meta.ownerUid ?? null,
      ownerName: meta.ownerName ?? '',
      createdAt: meta.createdAt ?? 0,
      members: extra[i].members,
      online: online.perRoom.get(key) ?? 0,
      allowGuests: extra[i].allowGuests,
    }))
    .sort((a, b) => b.online - a.online || b.createdAt - a.createdAt)
}

async function roomKeyOf(ctx: Ctx, roomId: string): Promise<string> {
  const found = (await roomMetas(ctx)).find((r) => r.meta.roomId === roomId)
  if (!found) throw new HttpError(404, 'not_found')
  return found.key
}

async function closeRoom(ctx: Ctx, roomId: string): Promise<void> {
  const key = await roomKeyOf(ctx, roomId)
  await ctx.db.update('', { [`rooms/${key}`]: null, [`roomIndex/${roomId}`]: null })
  await audit(ctx, 'encerrar sala', roomId)
}

async function transferRoom(ctx: Ctx, roomId: string, uid: string): Promise<void> {
  const key = await roomKeyOf(ctx, roomId)
  const u = await ctx.db.get<UserRecord>(`admin/users/${uid}`)
  if (!u) throw new HttpError(404, 'user_not_found')
  await ctx.db.update(`rooms/${key}/meta`, { ownerUid: uid, ownerName: (u.name ?? '').slice(0, 32) })
  await ctx.db.update(`roomIndex/${roomId}`, { ownerUid: uid })
  await audit(ctx, 'trocar dono', roomId, `${u.name ?? uid} (${uid})`)
}

// ---- acesso -----------------------------------------------------------------------

async function setAccess(ctx: Ctx, mode: AccessMode): Promise<void> {
  if (mode === 'approval') {
    // Quem já tem cadastro continua entrando.
    const users = await ctx.db.keys('admin/users')
    if (users.length) await ctx.db.update('admin/approved', Object.fromEntries(users.map((u) => [u, true])))
  }
  await ctx.db.update('admin/config', { access: mode })
  await audit(ctx, 'modo de acesso', mode)
}

async function listRequests(ctx: Ctx): Promise<AdminRequest[]> {
  const v = (await ctx.db.get<Record<string, Omit<AdminRequest, 'uid'>>>('admin/requests')) ?? {}
  return Object.entries(v)
    .map(([uid, r]) => ({ uid, name: r.name ?? '', username: r.username ?? '', avatar: r.avatar ?? '', at: r.at ?? 0 }))
    .sort((a, b) => b.at - a.at)
}

async function decide(ctx: Ctx, uid: string, approve: boolean): Promise<void> {
  await ctx.db.update('', { [`admin/requests/${uid}`]: null, ...(approve ? { [`admin/approved/${uid}`]: true } : {}) })
  await audit(ctx, approve ? 'aprovar acesso' : 'recusar acesso', uid)
}

async function listAudit(ctx: Ctx): Promise<AuditEntry[]> {
  const v = (await ctx.db.lastByKey<Omit<AuditEntry, 'id'>>('admin/audit', 200)) ?? {}
  return Object.entries(v)
    .map(([id, a]) => ({ id, at: a.at ?? 0, by: a.by ?? '', byName: a.byName ?? '', action: a.action ?? '', target: a.target ?? '', detail: a.detail ?? '' }))
    .sort((a, b) => b.at - a.at)
}

// ---- roteamento ---------------------------------------------------------------------

const uidRe = /^[A-Za-z0-9_]{6,64}$/
const roomRe = /^[A-Z2-9]{5}$/

export async function adminRoute(request: Request, path: string, ctx: Ctx): Promise<Response> {
  const m = request.method
  let r: RegExpExecArray | null

  if (m === 'GET' && path === '/admin/me') return json(ctx.admin)
  if (m === 'GET' && path === '/admin/overview') return json(await overview(ctx.db))
  if (m === 'GET' && path === '/admin/users') return json(await listUsers(ctx))
  if (m === 'GET' && (r = /^\/admin\/users\/([^/]+)$/.exec(path)) && uidRe.test(r[1])) return json(await userDetail(ctx, r[1]))
  if (m === 'POST' && (r = /^\/admin\/users\/([^/]+)\/(suspend|unsuspend|delete)$/.exec(path)) && uidRe.test(r[1])) {
    if (r[2] === 'suspend') await suspend(ctx, r[1], String((await readJson<{ reason?: string }>(request)).reason ?? ''))
    else if (r[2] === 'unsuspend') await unsuspend(ctx, r[1])
    else await deleteUser(ctx, r[1])
    return json({ ok: true })
  }
  if (m === 'GET' && path === '/admin/rooms') return json(await listRooms(ctx))
  if (m === 'POST' && (r = /^\/admin\/rooms\/([^/]+)\/(close|owner)$/.exec(path)) && roomRe.test(r[1])) {
    if (r[2] === 'close') await closeRoom(ctx, r[1])
    else {
      const uid = String((await readJson<{ uid?: string }>(request)).uid ?? '')
      if (!uidRe.test(uid)) throw new HttpError(400, 'bad_request')
      await transferRoom(ctx, r[1], uid)
    }
    return json({ ok: true })
  }
  if (path === '/admin/access') {
    if (m === 'POST') {
      const mode = (await readJson<{ mode?: string }>(request)).mode
      if (mode !== 'open' && mode !== 'approval') throw new HttpError(400, 'bad_request')
      await setAccess(ctx, mode)
    }
    const cfg = await ctx.db.get<{ access?: AccessMode }>('admin/config')
    return json({ mode: cfg?.access === 'approval' ? 'approval' : 'open', requests: await listRequests(ctx) })
  }
  if (m === 'POST' && (r = /^\/admin\/requests\/([^/]+)\/(approve|deny)$/.exec(path)) && uidRe.test(r[1])) {
    await decide(ctx, r[1], r[2] === 'approve')
    return json({ ok: true })
  }
  if (m === 'GET' && path === '/admin/audit') return json(await listAudit(ctx))
  throw new HttpError(404, 'not_found')
}
