import {
  isAccountUid,
  SUPPORT_DEFAULT_GOAL,
  type AdminSupport,
  type AdminSupporter,
  type PublicSupporter,
  type SupportInfo,
  type SupportMeter,
} from '@echoroom/shared'
import { Db } from '../db'
import { readServiceAccount, type Env } from '../env'
import { verifyIdToken } from '../google'
import { HttpError, json, readJson } from '../http'
import type { UserRecord } from '../stats'

/**
 * Apoio por Pix: o Pix não avisa o sistema, então o admin marca quem apoiou e
 * digita o valor do mês. Tudo fica em /admin (fora do alcance do site).
 *
 *   /admin/support/meter              { goal, raised, month, updatedAt }  (reais; mês AAAA-MM)
 *   /admin/support/supporters/{uid}   { name, avatar, since, public }
 *
 * Rotas:
 *   GET  /support          público: medidor do mês e apoiadores que aceitaram aparecer;
 *                          com login, também os uids com selo e a situação de quem chamou
 *   POST /support/public   { show }  o próprio apoiador escolhe aparecer (ou não) na página
 *   GET  /admin/support            (admin) medidor e todos os apoiadores
 *   POST /admin/support/meter      (admin) { goal, raised }
 *   POST /admin/support/supporter  (admin) { uid, on }
 */

interface MeterRecord {
  goal?: number
  raised?: number
  month?: string
  updatedAt?: number
}

interface SupporterRecord {
  name?: string
  avatar?: string
  since?: number
  public?: boolean
}

const MAX_MONEY = 1_000_000

/** Mês atual no horário de Brasília (AAAA-MM). */
export function currentMonth(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date(now))
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  return `${y}-${m}`
}

/** Medidor do mês atual: o valor arrecadado volta a zero quando o mês vira. */
export function meterNow(rec: MeterRecord | null, now = Date.now()): SupportMeter {
  const month = currentMonth(now)
  const goal = typeof rec?.goal === 'number' && rec.goal >= 0 ? rec.goal : SUPPORT_DEFAULT_GOAL
  const raised = rec?.month === month && typeof rec.raised === 'number' && rec.raised >= 0 ? rec.raised : 0
  return { goal, raised, month }
}

const money = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) throw new HttpError(400, 'bad_request')
  return Math.round(n * 100) / 100
}

function publicList(all: Record<string, SupporterRecord> | null): PublicSupporter[] {
  return Object.values(all ?? {})
    .filter((s) => s.public)
    .map((s) => ({ name: s.name ?? '', avatar: s.avatar ?? '', since: s.since ?? 0 }))
    .filter((s) => s.name)
    .sort((a, b) => a.since - b.since)
}

/** GET /support — público; o login (opcional) libera os selos. */
export async function supportInfo(request: Request, env: Env): Promise<Response> {
  const sa = readServiceAccount(env)
  if (!sa) throw new HttpError(500, 'not_configured')
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  const caller = token ? await verifyIdToken(token, sa.project_id) : null
  const db = new Db(sa, env)
  // Uma leitura só para tudo (limite de subrequisições do plano grátis).
  const support = await db.get<{ meter?: MeterRecord; supporters?: Record<string, SupporterRecord> }>('admin/support')
  const meter = meterNow(support?.meter ?? null)
  const body: SupportInfo = {
    meter: meter.goal > 0 ? meter : null,
    supporters: publicList(support?.supporters ?? null),
  }
  if (caller) {
    const all = support?.supporters ?? {}
    body.uids = Object.keys(all)
    const mine = all[caller.uid]
    body.me = { supporter: !!mine, public: !!mine?.public }
    return json(body, 200, { 'Cache-Control': 'private, no-store' })
  }
  return json(body, 200, { 'Cache-Control': 'public, max-age=300' })
}

/** POST /support/public — o apoiador escolhe aparecer na página de apoiadores. */
export async function setSupportPublic(request: Request, env: Env): Promise<Response> {
  const sa = readServiceAccount(env)
  if (!sa) throw new HttpError(500, 'not_configured')
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  const caller = token ? await verifyIdToken(token, sa.project_id) : null
  if (!caller || !isAccountUid(caller.uid)) throw new HttpError(401, 'unauthenticated')
  const show = (await readJson<{ show?: unknown }>(request)).show === true
  const db = new Db(sa, env)
  const [mine, user] = await Promise.all([
    db.get<SupporterRecord>(`admin/support/supporters/${caller.uid}`),
    db.get<UserRecord>(`admin/users/${caller.uid}`),
  ])
  if (!mine) throw new HttpError(403, 'not_supporter')
  // Atualiza nome e foto ao aceitar (podem ter mudado desde que foi marcado).
  await db.update(`admin/support/supporters/${caller.uid}`, {
    public: show,
    name: String(user?.name ?? mine.name ?? '').slice(0, 40),
    avatar: String(user?.avatar ?? mine.avatar ?? ''),
  })
  return json({ ok: true, public: show })
}

// ---- admin ---------------------------------------------------------------------------

export async function adminSupport(db: Db): Promise<AdminSupport> {
  const support = await db.get<{ meter?: MeterRecord; supporters?: Record<string, SupporterRecord> }>('admin/support')
  const supporters: AdminSupporter[] = Object.entries(support?.supporters ?? {})
    .map(([uid, s]) => ({ uid, name: s.name ?? '', avatar: s.avatar ?? '', since: s.since ?? 0, public: !!s.public }))
    .sort((a, b) => b.since - a.since)
  return { meter: meterNow(support?.meter ?? null), supporters }
}

export async function setMeter(db: Db, body: { goal?: unknown; raised?: unknown }): Promise<SupportMeter> {
  const rec = { goal: money(body.goal), raised: money(body.raised), month: currentMonth(), updatedAt: Date.now() }
  await db.set('admin/support/meter', rec)
  return { goal: rec.goal, raised: rec.raised, month: rec.month }
}

/** Liga ou desliga o selo. Devolve o nome da pessoa (para o registro de ações). */
export async function setSupporter(db: Db, uid: string, on: boolean): Promise<string> {
  const user = await db.get<UserRecord>(`admin/users/${uid}`)
  if (on && !user) throw new HttpError(404, 'user_not_found')
  if (!on) {
    await db.remove(`admin/support/supporters/${uid}`)
    return user?.name ?? uid
  }
  const current = await db.get<SupporterRecord>(`admin/support/supporters/${uid}`)
  await db.set(`admin/support/supporters/${uid}`, {
    name: String(user?.name ?? '').slice(0, 40),
    avatar: String(user?.avatar ?? ''),
    since: current?.since ?? Date.now(),
    public: current?.public ?? false,
  })
  return user?.name ?? uid
}
