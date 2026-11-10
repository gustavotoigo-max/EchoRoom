import { dayKey } from '@echoroom/shared'
import { caller, type AccountRecord } from '../accounts'
import { Db } from '../db'
import type { Env } from '../env'
import { HttpError, json, readJson } from '../http'
import { checkOrigin } from './email'

/**
 * Sugestões enviadas pelo app (botão "Sugestões").
 *
 * Só quem está logado envia, até FEEDBACK_PER_DAY por conta por dia. Cada
 * sugestão fica guardada em /admin/feedback (cópia caso o e-mail falhe) e vai
 * por e-mail (Resend) para FEEDBACK_TO, que só existe no Worker: o endereço
 * nunca aparece no site nem no app.
 */

export const FEEDBACK_MAX_CHARS = 300
export const FEEDBACK_PER_DAY = 3

/** Texto limpo: sem caracteres de controle (exceto quebra de linha), sem espaços nas pontas. */
function cleanText(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim()
}

const cleanLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '')

/** POST /feedback { text, room?, version? } — envia uma sugestão. */
export async function sendFeedback(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, sa } = await caller(request, env)
  const body = await readJson<{ text?: unknown; room?: unknown; version?: unknown }>(request)
  const text = cleanText(body.text)
  if (!text) throw new HttpError(400, 'feedback_empty')
  if ([...text].length > FEEDBACK_MAX_CHARS) throw new HttpError(400, 'feedback_too_long')

  const db = new Db(sa, env)
  if (await db.get(`admin/suspended/${uid}`)) throw new HttpError(403, 'suspended')
  const now = Date.now()
  const day = dayKey(now)
  const countPath = `admin/feedbackCount/${day}/${uid}`
  const sent = (await db.get<number>(countPath)) ?? 0
  if (sent >= FEEDBACK_PER_DAY) throw new HttpError(429, 'feedback_limit')
  await db.set(countPath, sent + 1)

  const rec = await db.get<AccountRecord>(`admin/users/${uid}`)
  const name = cleanLine(rec?.name, 60) || uid
  const username = cleanLine(rec?.username, 40)
  const room = cleanLine(body.room, 60)
  const version = cleanLine(body.version, 20)
  const id = await db.push('admin/feedback', { uid, name, text, room: room || null, version: version || null, at: now })

  const emailed = await emailFeedback(env, { name, username, uid, text, room, version, at: now })
  if (emailed) await db.set(`admin/feedback/${id}/emailed`, true)
  return json({ ok: true, left: FEEDBACK_PER_DAY - sent - 1 })
}

interface FeedbackMail {
  name: string
  username: string
  uid: string
  text: string
  room: string
  version: string
  at: number
}

/** Manda a sugestão por e-mail (texto puro). false = não configurado ou o Resend recusou. */
async function emailFeedback(env: Env, f: FeedbackMail): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.FEEDBACK_TO) return false
  const when = new Date(f.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const who = f.username ? `${f.name} (@${f.username})` : f.name
  const lines = [
    f.text,
    '',
    '—',
    `De: ${who}`,
    `Conta: ${f.uid}`,
    f.room ? `Sala: ${f.room}` : '',
    f.version ? `App: ${f.version}` : '',
    `Quando: ${when}`,
  ].filter((l, i) => i < 3 || l)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.FEEDBACK_FROM || 'SpectraCast <onboarding@resend.dev>',
        to: env.FEEDBACK_TO.split(',').map((s) => s.trim()).filter(Boolean),
        subject: `Sugestão de ${f.name}`,
        text: lines.join('\n'),
      }),
    })
    if (!res.ok) console.error('Resend recusou a sugestão', res.status, await res.text().catch(() => ''))
    return res.ok
  } catch (err) {
    console.error('Falha ao enviar a sugestão por e-mail', err)
    return false
  }
}
