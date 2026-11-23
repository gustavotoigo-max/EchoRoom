import { dayKey, isAccountUid, type AccessMode, type AdminDay, type AdminOverview } from '@echoroom/shared'
import type { Db } from './db'

/** Estatísticas de uso a partir do que já existe no banco (sem ler o conteúdo das salas). */

export const DAY_MS = 86_400_000
/** Quem tem conta (Discord ou e-mail); o resto é convidado. */
export const isAccount = isAccountUid

export interface UserRecord {
  name?: string
  username?: string
  avatar?: string
  firstAt?: number
  lastLoginAt?: number
  logins?: number
}

export function lastDays(n: number, now = Date.now()): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * DAY_MS))
}

/**
 * Quem usou o site em cada dia (/activity/{dia}/{uid}), numa leitura só.
 * (Uma leitura por dia gastava 30 das 50 subrequisições que o Worker grátis permite.)
 */
export async function activityByDay(db: Db, days: string[]): Promise<Map<string, string[]>> {
  const all = days.length ? ((await db.rangeByKey<Record<string, unknown>>('activity', days[0], days[days.length - 1])) ?? {}) : {}
  return new Map(days.map((d) => [d, all[d] && typeof all[d] === 'object' ? Object.keys(all[d]) : []]))
}

/** O que o painel usa de cada sala. */
export interface RoomRecord {
  meta?: { roomId?: string; name?: string; ownerUid?: string; ownerName?: string; createdAt?: number }
  members?: Record<string, unknown>
  participants?: Record<string, { conns?: Record<string, boolean> } | null>
  settings?: { allowGuests?: boolean }
}

/**
 * Todas as salas numa leitura só. Ler sala por sala fazia uma subrequisição por sala
 * (quatro na aba Salas) e, passando de ~10 salas, o Worker estourava o limite e
 * respondia "internal". O conteúdo (fila, bate-papo) é lido, mas nunca devolvido.
 */
export async function allRooms(db: Db): Promise<Record<string, RoomRecord>> {
  const v = await db.get<Record<string, RoomRecord | null>>('rooms')
  const out: Record<string, RoomRecord> = {}
  for (const [k, r] of Object.entries(v ?? {})) if (r && typeof r === 'object') out[k] = r
  return out
}

/** Salas com alguém conectado agora e quantas pessoas (e convidados) estão online. */
export function onlineNow(rooms: Record<string, RoomRecord>): { roomsActive: number; peopleOnline: number; guestsOnline: number; perRoom: Map<string, number> } {
  const perRoom = new Map<string, number>()
  let people = 0
  let guests = 0
  for (const [k, r] of Object.entries(rooms)) {
    const online = Object.entries(r.participants ?? {}).filter(([, p]) => p?.conns && Object.keys(p.conns).length > 0)
    perRoom.set(k, online.length)
    people += online.length
    guests += online.filter(([uid]) => !isAccount(uid)).length
  }
  return { roomsActive: [...perRoom.values()].filter((n) => n > 0).length, peopleOnline: people, guestsOnline: guests, perRoom }
}

export async function overview(db: Db): Promise<AdminOverview> {
  const days = lastDays(30)
  const [users, suspended, requests, roomIndex, counters, snapshots, config, activity, rooms_] = await Promise.all([
    db.get<Record<string, UserRecord>>('admin/users'),
    db.keys('admin/suspended'),
    db.keys('admin/requests'),
    db.get<Record<string, { createdAt?: number }>>('roomIndex'),
    db.get<Record<string, Record<string, number>>>('stats/daily'),
    db.get<Record<string, { usersTotal?: number; roomsTotal?: number }>>('admin/stats/daily'),
    db.get<{ access?: AccessMode }>('admin/config'),
    activityByDay(db, days),
    allRooms(db),
  ])
  const now = onlineNow(rooms_)
  const userList = Object.values(users ?? {})
  const rooms = Object.values(roomIndex ?? {})
  const countBy = (times: (number | undefined)[]) => {
    const m = new Map<string, number>()
    for (const t of times) if (t) m.set(dayKey(t), (m.get(dayKey(t)) ?? 0) + 1)
    return m
  }
  const newUsers = countBy(userList.map((u) => u.firstAt))
  const roomsCreated = countBy(rooms.map((r) => r.createdAt))

  const dayRows: AdminDay[] = days.map((date) => {
    const act = activity.get(date) ?? []
    const c = counters?.[date] ?? {}
    const snap = snapshots?.[date]
    return {
      date,
      newUsers: newUsers.get(date) ?? 0,
      active: act.filter(isAccount).length,
      activeGuests: act.filter((u) => !isAccount(u)).length,
      roomsCreated: roomsCreated.get(date) ?? 0,
      adds: Number(c.adds) || 0,
      extension: Number(c.extension) || 0,
      playlistSaves: Number(c.playlistSaves) || 0,
      usersTotal: snap?.usersTotal ?? null,
      roomsTotal: snap?.roomsTotal ?? null,
    }
  })
  const distinct = (ds: string[]) => new Set(ds.flatMap((d) => (activity.get(d) ?? []).filter(isAccount))).size

  return {
    generatedAt: Date.now(),
    access: config?.access === 'approval' ? 'approval' : 'open',
    totals: { users: userList.length, rooms: rooms.length, suspended: suspended.length, pending: requests.length },
    now: { roomsActive: now.roomsActive, peopleOnline: now.peopleOnline, guestsOnline: now.guestsOnline },
    active: { today: distinct(days.slice(-1)), week: distinct(days.slice(-7)), month: distinct(days) },
    days: dayRows,
  }
}

/** Rotina diária: guarda os totais do dia e apaga atividade antiga (mais de 90 dias)
 * e os contadores de sugestões dos dias anteriores. */
export async function dailyRoutine(db: Db, now = Date.now()): Promise<void> {
  const [users, rooms] = await Promise.all([db.keys('admin/users'), db.keys('roomIndex')])
  await db.set(`admin/stats/daily/${dayKey(now)}`, { usersTotal: users.length, roomsTotal: rooms.length, at: now })
  const limit = dayKey(now - 90 * DAY_MS)
  const oldActivity = (await db.keys('activity')).filter((d) => d < limit)
  const oldCounters = (await db.keys('stats/daily')).filter((d) => d < dayKey(now - 400 * DAY_MS))
  const oldFeedbackCounts = (await db.keys('admin/feedbackCount')).filter((d) => d < dayKey(now - 2 * DAY_MS))
  const patch: Record<string, null> = {}
  for (const d of oldFeedbackCounts) patch[`admin/feedbackCount/${d}`] = null
  for (const d of oldActivity) patch[`activity/${d}`] = null
  for (const d of oldCounters) patch[`stats/daily/${d}`] = null
  if (Object.keys(patch).length) await db.update('', patch)
}

