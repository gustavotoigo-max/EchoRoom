import { Db } from './db'
import { adminUids, allowedOrigins, readServiceAccount, type Env } from './env'
import { verifyIdToken } from './google'
import { corsHeaders, HttpError, json } from './http'
import { adminRoute } from './routes/admin'
import { accountInfo, emailAppCallback, emailLogin, linkEmail, unlink } from './routes/email'
import { sendFeedback } from './routes/feedback'
import { googleLogin } from './routes/google'
import { handoff } from './routes/handoff'
import { APP_CALLBACK_PATH, appCallback, login } from './routes/login'
import { youtubeMaintenance } from './maintenance'
import { ytPlaylist, ytVideo } from './routes/youtube'
import { dailyRoutine } from './stats'

/**
 * Backend do EchoRoom (Cloudflare Worker).
 *
 *   GET  /              diagnóstico (o que falta configurar)
 *   POST /discord       login com Discord → token do Firebase (site e app); link:true vincula
 *   POST /google      login com Google (ID token) → token da conta; link:true vincula
 *   POST /email         login por e-mail (token do usuário de e-mail) → token da conta
 *   GET  /email/app     link do e-mail aberto no celular → app (echoroom://email)
 *   POST /link/email    vincula um e-mail à conta de quem está logado
 *   GET  /account       formas de entrar da conta
 *   POST /unlink        tira uma forma de entrar
 *   POST /handoff       app do Windows entra com a conta já logada no navegador
 *   POST /feedback      sugestão enviada pelo app (vai por e-mail para o dono)
 *   GET  /discord/app   retorno do Discord para o app do celular (echoroom://auth)
 *   GET  /yt/video      título e autor de um vídeo do YouTube (oEmbed)
 *   GET  /yt/playlist   título e músicas de uma playlist do YouTube (Data API)
 *   *    /admin/...     administração (exige login de um admin)
 *   cron (diário)       fotografia dos totais, limpeza de dados antigos, títulos do
 *                       YouTube com mais de 30 dias e bate-papo antigo
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
      else if (request.method === 'POST' && path === '/google') res = await googleLogin(request, env)
      else if (request.method === 'POST' && path === '/email') res = await emailLogin(request, env)
      else if (request.method === 'GET' && path === '/email/app') return emailAppCallback(request)
      else if (request.method === 'POST' && path === '/link/email') res = await linkEmail(request, env)
      else if (request.method === 'GET' && path === '/account') res = await accountInfo(request, env)
      else if (request.method === 'POST' && path === '/unlink') res = await unlink(request, env)
      else if (request.method === 'POST' && path === '/handoff') res = await handoff(request, env)
      else if (request.method === 'GET' && path === '/yt/video') res = await ytVideo(request)
      else if (request.method === 'GET' && path === '/yt/playlist') res = await ytPlaylist(request, env)
      else if (request.method === 'POST' && path === '/feedback') res = await sendFeedback(request, env)
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
    if (!sa) return
    const db = new Db(sa, env)
    // Uma parte não impede a outra; o erro aparece no registro do cron no fim.
    const results = await Promise.allSettled([dailyRoutine(db), youtubeMaintenance(db, { apiKey: env.YOUTUBE_API_KEY })])
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
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
      GOOGLE_CLIENT_ID: !!env.GOOGLE_CLIENT_ID,
      YOUTUBE_API_KEY: !!env.YOUTUBE_API_KEY,
      RESEND_API_KEY: !!env.RESEND_API_KEY,
      FEEDBACK_TO: !!env.FEEDBACK_TO,
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
