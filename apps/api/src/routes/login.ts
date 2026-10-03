import { CLAIMS, DISCORD_UID_PREFIX, type AccessMode } from '@echoroom/shared'
import { Db } from '../db'
import { discordProfileFromCode } from '../discord'
import { adminUids, allowedOrigins, readServiceAccount, type Env } from '../env'
import { createCustomToken } from '../google'
import { HttpError, json, readJson } from '../http'
import type { UserRecord } from '../stats'

/**
 * POST /discord — troca o `code` do Discord por um token do Firebase.
 * Confere suspensão e o modo de acesso, e registra o login (cadastro do admin).
 */
export async function login(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin') || ''
  const origins = allowedOrigins(env)
  if (!origins.includes(origin)) throw new HttpError(403, 'origin_not_allowed')

  const body = await readJson<{ code?: unknown; redirectUri?: unknown }>(request)
  const code = typeof body.code === 'string' ? body.code : ''
  const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : ''
  // O endereço de retorno precisa ser do próprio site.
  if (!code || !origins.some((o) => redirectUri.startsWith(o + '/'))) throw new HttpError(400, 'bad_request')

  const sa = readServiceAccount(env)
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !sa) throw new HttpError(500, 'not_configured')

  const profile = await discordProfileFromCode(env, code, redirectUri)
  const uid = `${DISCORD_UID_PREFIX}${profile.id}`
  const isAdmin = adminUids(env).includes(uid)

  // Suspensão e modo de acesso. Se o banco falhar, o login segue (as regras do
  // banco continuam bloqueando quem estiver suspenso).
  const db = new Db(sa, env)
  try {
    const [suspended, config] = await Promise.all([
      db.get(`admin/suspended/${uid}`),
      db.get<{ access?: AccessMode }>('admin/config'),
    ])
    if (suspended && !isAdmin) throw new HttpError(403, 'suspended')
    if (config?.access === 'approval' && !isAdmin && !(await db.get(`admin/approved/${uid}`))) {
      await db.set(`admin/requests/${uid}`, { name: profile.name, username: profile.username, avatar: profile.avatarUrl, at: Date.now() })
      throw new HttpError(403, 'pending')
    }
    const prev = await db.get<UserRecord>(`admin/users/${uid}`)
    const now = Date.now()
    await db.set(`admin/users/${uid}`, {
      name: profile.name,
      username: profile.username,
      avatar: profile.avatarUrl,
      firstAt: prev?.firstAt ?? now,
      lastLoginAt: now,
      logins: (prev?.logins ?? 0) + 1,
    })
  } catch (err) {
    if (err instanceof HttpError) throw err
    console.error('login: banco indisponível', err)
  }

  const firebaseToken = await createCustomToken(sa, uid, {
    [CLAIMS.displayName]: profile.name,
    [CLAIMS.username]: profile.username.toLowerCase(),
    [CLAIMS.avatar]: profile.avatarUrl,
    ...(isAdmin ? { [CLAIMS.admin]: true } : {}),
  })
  // O token do Discord não é guardado nem devolvido.
  return json({ firebaseToken, profile })
}
