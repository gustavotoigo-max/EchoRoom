import { Db } from './db'
import { adminUids, allowedOrigins, readServiceAccount, type Env } from './env'
import { verifyIdToken } from './google'
import { corsHeaders, HttpError, json } from './http'
import { adminRoute } from './routes/admin'
import { APP_CALLBACK_PATH, appCallback, login } from './routes/login'
import { dailyRoutine } from './stats'

/**
 * Backend do EchoRoom (Cloudflare Worker).
 *
 *   GET  /              diagnóstico (o que falta configurar)
 *   POST /discord       login com Discord → token do Firebase (site e app)
 *   GET  /discord/app   retorno do Discord para o app do celular (echoroom://auth)
 *   *    /admin/...     administração (exige login de um admin)
 *   cron (diário)       fotografia dos totais e limpeza de dados antigos
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/'
    try {
      let res: Response
      if (request.method === 'GET' && path === '/') res = diagnostics(env)
      else if (request.method === 'POST' && (path === '/discord' || path === '/auth/discord')) res = await login(request, env)
      else if (request.method === 'GET' && path === APP_CALLBACK_PATH) return appCallback(request)
      else if (path.startsWith('/admin/')) res = await admin(request, path, env)
      else throw new HttpError(404, 'not_found')
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
      return res
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code }, err.status, cors)
      console.error(err)
      return json({ error: 'internal' }, 500, cors)
    }
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    const sa = readServiceAccount(env)
    if (sa) await dailyRoutine(new Db(sa, env))
  },
}

function diagnostics(env: Env): Response {
  return json({
    ok: true,
    service: 'echoroom-api',
    configured: {
      DISCORD_CLIENT_ID: !!env.DISCORD_CLIENT_ID,
      DISCORD_CLIENT_SECRET: !!env.DISCORD_CLIENT_SECRET,
      FIREBASE_SERVICE_ACCOUNT: !!readServiceAccount(env),
      ALLOWED_ORIGIN: allowedOrigins(env).length > 0,
      ADMIN_UIDS: adminUids(env).length > 0,
    },
  })
}

async function admin(request: Request, path: string, env: Env): Promise<Response> {
  const sa = readServiceAccount(env)
  if (!sa) throw new HttpError(500, 'not_configured')
  const origin = request.headers.get('Origin') || ''
  if (!allowedOrigins(env).includes(origin)) throw new HttpError(403, 'origin_not_allowed')
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  const who = token ? await verifyIdToken(token, sa.project_id) : null
  if (!who) throw new HttpError(401, 'unauthenticated')
  if (!adminUids(env).includes(who.uid)) throw new HttpError(403, 'not_admin')
  return adminRoute(request, path, { db: new Db(sa, env), env, admin: { uid: who.uid, name: String(who.claims.dn ?? 'Admin') } })
}
