import { Db } from '../db'
import { accountToken, checkAccess, caller, recordLogin, type AccountRecord } from '../accounts'
import { HttpError, json } from '../http'
import type { Env } from '../env'
import { checkOrigin } from './email'

/** Validade do token entregue ao app. */
export const HANDOFF_TTL_SEC = 300

/**
 * POST /handoff — "Continuar com a conta do navegador" do app SpectraCast para Windows.
 *
 * O site, aberto no navegador onde a pessoa já entrou, chama esta rota com o login dela
 * (Authorization: Bearer <ID token do Firebase>) e recebe um token novo da mesma conta.
 * O site entrega esse token só ao próprio computador (http://127.0.0.1:<porta> aberto
 * pelo app), então ninguém de fora consegue pegá-lo. Mesmo controle de acesso do login
 * normal: conta suspensa ou à espera de aprovação não passa.
 */
export async function handoff(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  if (!request.headers.get('Origin')) throw new HttpError(403, 'origin_not_allowed')
  const { uid, sa } = await caller(request, env)
  const db = new Db(sa, env)
  const rec = await db.get<AccountRecord>(`admin/users/${uid}`)
  if (!rec) throw new HttpError(404, 'no_account')
  const profile = { name: rec.name || 'SpectraCast', username: rec.username || '', avatar: rec.avatar || '' }
  await checkAccess(db, env, uid, false, profile)
  // Aparece no painel do admin como um login normal.
  await recordLogin(db, uid, rec, profile)
  // O app usa o token na hora: vale só 5 minutos (um token esquecido em algum lugar não abre a conta depois).
  const firebaseToken = await accountToken(env, sa, uid, profile, HANDOFF_TTL_SEC)
  return json({ firebaseToken, profile: { uid, name: profile.name, username: profile.username, avatarUrl: profile.avatar } })
}
