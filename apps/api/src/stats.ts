import { dayKey, type AccessMode, type AdminDay, type AdminOverview } from '@echoroom/shared'
import { mapLimit, type Db } from './db'

/** Estatísticas de uso a partir do que já existe no banco (sem ler o conteúdo das salas). */

export const DAY_MS = 86_400_000
export const isDiscord = (uid: string) => uid.startsWith('discord_')

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

/** Quem usou o site em cada dia (/activity/{dia}/{uid}). */
export async function activityByDay(db: Db, days: string[]): Promise<Map<string, string[]>> {
  const lists = await mapLimit(days, 6, (d) => db.keys(`activity/${d}`))
  return new Map(days.map((d, i) => [d, lists[i]]))
}

interface ParticipantRecord {
  conns?: Record<string, boolean>
}

/** Salas com alguém conectado agora e quantas pessoas (e convidados) estão online. */
export async function onlineNow(db: Db): Promise<{ roomsActive: number; peopleOnline: number; guestsOnline: number; perRoom: Map<string, number> }> {
  const keys = await db.keys('rooms')
  const perRoom = new Map<string, number>()
  let people = 0
  let guests = 0
  await mapLimit(keys, 8, async (k) => {
    const parts = (await db.get<Record<string, ParticipantRecord>>(`rooms/${k}/participants`)) ?? {}
    const online = Object.entries(parts).filter(([, p]) => p?.conns && Object.keys(p.conns).length > 0)
    perRoom.set(k, online.length)
    people += online.length
    guests += online.filter(([uid]) => !isDiscord(uid)).length
  })
  return { roomsActive: [...perRoom.values()].filter((n) => n > 0).length, peopleOnline: people, guestsOnline: guests, perRoom }
}

export async function overview(db: Db): Promise<AdminOverview> {
  const days = lastDays(30)
  const [users, suspended, requests, roomIndex, counters, snapshots, config, activity, now] = await Promise.all([
    db.get<Record<string, UserRecord>>('admin/users'),
    db.keys('admin/suspended'),
    db.keys('admin/requests'),
    db.get<Record<string, { createdAt?: number }>>('roomIndex'),
    db.get<Record<string, Record<string, number>>>('stats/daily'),
    db.get<Record<string, { usersTotal?: number; roomsTotal?: number }>>('admin/stats/daily'),
    db.get<{ access?: AccessMode }>('admin/config'),
    activityByDay(db, days),
    onlineNow(db),
  ])
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
      active: act.filter(isDiscord).length,
      activeGuests: act.filter((u) => !isDiscord(u)).length,
      roomsCreated: roomsCreated.get(date) ?? 0,
      adds: Number(c.adds) || 0,
      extension: Number(c.extension) || 0,
      playlistSaves: Number(c.playlistSaves) || 0,
      usersTotal: snap?.usersTotal ?? null,
      roomsTotal: snap?.roomsTotal ?? null,
    }
  })
  const distinct = (ds: string[]) => new Set(ds.flatMap((d) => (activity.get(d) ?? []).filter(isDiscord))).size

  return {
    generatedAt: Date.now(),
    access: config?.access === 'approval' ? 'approval' : 'open',
    totals: { users: userList.length, rooms: rooms.length, suspended: suspended.length, pending: requests.length },
    now: { roomsActive: now.roomsActive, peopleOnline: now.peopleOnline, guestsOnline: now.guestsOnline },
    active: { today: distinct(days.slice(-1)), week: distinct(days.slice(-7)), month: distinct(days) },
    days: dayRows,
  }
}

/** Rotina diária: guarda os totais do dia e apaga atividade antiga (mais de 90 dias). */
export async function dailyRoutine(db: Db, now = Date.now()): Promise<void> {
  const [users, rooms] = await Promise.all([db.keys('admin/users'), db.keys('roomIndex')])
  await db.set(`admin/stats/daily/${dayKey(now)}`, { usersTotal: users.length, roomsTotal: rooms.length, at: now })
  const limit = dayKey(now - 90 * DAY_MS)
  const oldActivity = (await db.keys('activity')).filter((d) => d < limit)
  const oldCounters = (await db.keys('stats/daily')).filter((d) => d < dayKey(now - 400 * DAY_MS))
  const patch: Record<string, null> = {}
  for (const d of oldActivity) patch[`activity/${d}`] = null
  for (const d of oldCounters) patch[`stats/daily/${d}`] = null
  if (Object.keys(patch).length) await db.update('', patch)
}

