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

  const body = await readJson<{ code?: unknown; redirectUri?: unknown }>(request)
  const code = typeof body.code === 'string' ? body.code : ''
  const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : ''
  // O app do celular não tem "origem": vale quando o retorno foi a página de
  // retorno do app neste mesmo serviço (o Discord confere o redirect_uri).
  const fromApp = redirectUri === appCallbackUrl(request)
  if (!fromApp && !origins.includes(origin)) throw new HttpError(403, 'origin_not_allowed')
  // O endereço de retorno precisa ser do próprio site (ou do app).
  if (!code || !(fromApp || origins.some((o) => redirectUri.startsWith(o + '/')))) throw new HttpError(400, 'bad_request')

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

// ---- retorno do Discord para o app do celular ------------------------------------------

/** Caminho cadastrado no Discord como endereço de retorno do app. */
export const APP_CALLBACK_PATH = '/discord/app'
/** Esquema e pacote do app Android (app.json). */
export const APP_SCHEME = 'echoroom'
export const APP_PACKAGE = 'com.echoroom.app'

export function appCallbackUrl(request: Request): string {
  return new URL(request.url).origin + APP_CALLBACK_PATH
}

const safeParam = (v: string | null) => (v && /^[A-Za-z0-9._~-]{1,512}$/.test(v) ? v : null)

/**
 * GET /discord/app — o Discord volta aqui depois da autorização feita no
 * celular. A página só repassa o `code` e o `state` para o app
 * (echoroom://auth); a troca pelo token acontece depois, no POST /discord.
 */
export function appCallback(request: Request): Response {
  const url = new URL(request.url)
  const params = new URLSearchParams()
  for (const k of ['code', 'state', 'error']) {
    const v = safeParam(url.searchParams.get(k))
    if (v) params.set(k, v)
  }
  const query = params.toString()
  const deepLink = `${APP_SCHEME}://auth?${query}`
  // No Android, o link "intent:" abre o app mesmo quando o navegador bloqueia esquemas próprios.
  const intent = `intent://auth?${query}#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};end`
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EchoRoom</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b14;color:#f1f0ff;font:16px/1.5 system-ui,sans-serif;text-align:center}
  main{padding:24px;max-width:340px}
  a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:10px;background:#7c5cff;color:#fff;font-weight:700;text-decoration:none}
  p{color:#a9a6c4}
</style></head>
<body><main>
  <h1 style="font-size:20px">Login com Discord concluído</h1>
  <p>Voltando para o app do EchoRoom…</p>
  <a id="go" href="${intent}">Abrir o EchoRoom</a>
</main>
<script>
  var isAndroid = /Android/i.test(navigator.userAgent);
  var go = document.getElementById('go');
  if (!isAndroid) go.href = ${JSON.stringify(deepLink)};
  location.replace(go.href);
</script>
</body></html>`
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    },
  })
}
