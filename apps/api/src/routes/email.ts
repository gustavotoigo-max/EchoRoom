import { isAccountUid } from '@echoroom/shared'
import { accountFor, caller, defaultUid, enterAccount, methodsOf, ownMethod, type AccountRecord, type Provider } from '../accounts'
import { Db } from '../db'
import { allowedOrigins, readServiceAccount, type Env, type ServiceAccount } from '../env'
import { verifyIdToken } from '../google'
import { HttpError, json, readJson } from '../http'

/**
 * Login por e-mail (link enviado pelo próprio Firebase, sem senha).
 *
 * O site entra com o link num app secundário do Firebase e manda o token desse
 * usuário de e-mail para cá. Daqui sai o token da conta EchoRoom: a conta
 * vinculada a esse e-mail, ou uma conta nova "acct_<uid do e-mail>".
 */

/** Usuário de e-mail do Firebase a partir do token (só e-mail confirmado pelo link). */
async function emailUser(token: unknown, sa: ServiceAccount): Promise<string> {
  const who = typeof token === 'string' ? await verifyIdToken(token, sa.project_id) : null
  if (!who) throw new HttpError(401, 'unauthenticated')
  const fb = who.claims.firebase as { sign_in_provider?: string } | undefined
  if (fb?.sign_in_provider !== 'password' || who.claims.email_verified !== true || isAccountUid(who.uid)) {
    throw new HttpError(401, 'email_unverified')
  }
  return who.uid
}

/** O app do celular não tem origem; o site precisa ser um dos permitidos. */
export function checkOrigin(request: Request, env: Env): void {
  const origin = request.headers.get('Origin')
  if (origin && !allowedOrigins(env).includes(origin)) throw new HttpError(403, 'origin_not_allowed')
}

/** POST /email { idToken, name?, username? } — entra (ou cria a conta) com o e-mail. */
export async function emailLogin(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const sa = readServiceAccount(env)
  if (!sa) throw new HttpError(500, 'not_configured')
  const body = await readJson<{ idToken?: unknown; name?: unknown; username?: unknown }>(request)
  const emailUid = await emailUser(body.idToken, sa)
  const db = new Db(sa, env)
  const uid = (await accountFor(db, 'email', emailUid)) ?? defaultUid('email', emailUid)
  return enterAccount(db, env, sa, uid, body)
}

/** POST /link/email { idToken } — vincula o e-mail à conta de quem está logado. */
export async function linkEmail(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, sa } = await caller(request, env)
  const body = await readJson<{ idToken?: unknown }>(request)
  const emailUid = await emailUser(body.idToken, sa)
  const db = new Db(sa, env)
  const own = defaultUid('email', emailUid)
  const mapped = await db.get<string | false>(`admin/identities/email/${emailUid}`)
  if (typeof mapped === 'string' && mapped !== uid) throw new HttpError(409, 'email_in_use')
  // Esse e-mail já tem a própria conta: não dá para levar para outra.
  if (own !== uid && (await db.get(`admin/users/${own}`))) throw new HttpError(409, 'email_in_use')
  await db.update('', {
    [`admin/identities/email/${emailUid}`]: own === uid ? null : uid,
    [`admin/users/${uid}/links/email`]: own === uid ? null : { uid: emailUid },
  })
  return json({ linked: 'email' })
}

/** GET /account — formas de entrar da conta de quem está logado. */
export async function accountInfo(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, sa } = await caller(request, env)
  const rec = await new Db(sa, env).get<AccountRecord>(`admin/users/${uid}`)
  return json({ methods: methodsOf(uid, rec) })
}

const PROVIDERS: Provider[] = ['discord', 'email', 'google']

/** POST /unlink { provider } — tira uma forma de entrar (sempre sobra pelo menos uma). */
export async function unlink(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const { uid, sa } = await caller(request, env)
  const body = await readJson<{ provider?: unknown }>(request)
  const provider = PROVIDERS.find((p) => p === body.provider)
  if (!provider) throw new HttpError(400, 'bad_request')
  const db = new Db(sa, env)
  const rec = await db.get<AccountRecord>(`admin/users/${uid}`)
  const methods = methodsOf(uid, rec)
  const has = { discord: !!methods.discord, email: methods.email, google: !!methods.google }
  if (!has[provider]) return json({ methods })
  if (PROVIDERS.filter((p) => has[p]).length < 2) throw new HttpError(409, 'last_method')

  const link = rec?.links?.[provider]
  // Vinculado de outra conta: some o vínculo. Próprio da conta (o Discord da conta
  // antiga, o e-mail da conta por e-mail, o Google da conta pelo Google): fica
  // marcado como desvinculado.
  const id = !link
    ? ownMethod(uid).id
    : 'id' in link
      ? link.id
      : 'sub' in link
        ? link.sub
        : link.uid
  await db.update('', {
    [`admin/identities/${provider}/${id}`]: link ? null : false,
    [`admin/users/${uid}/links/${provider}`]: link ? null : false,
  })
  const next = await db.get<AccountRecord>(`admin/users/${uid}`)
  return json({ methods: methodsOf(uid, next) })
}

const safeParam = (v: string | null) => (v && /^[A-Za-z0-9._~-]{1,2048}$/.test(v) ? v : null)

/**
 * GET /email/app — o link do e-mail aberto no celular cai aqui e segue para o
 * app (echoroom://email?…), que termina o login com esses parâmetros.
 */
export function emailAppCallback(request: Request): Response {
  const url = new URL(request.url)
  const params = new URLSearchParams()
  for (const k of ['apiKey', 'oobCode', 'mode', 'lang']) {
    const v = safeParam(url.searchParams.get(k))
    if (v) params.set(k, v)
  }
  const query = params.toString()
  const deepLink = `echoroom://email?${query}`
  const intent = `intent://email?${query}#Intent;scheme=echoroom;package=com.echoroom.app;end`
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
  <h1 style="font-size:20px">Link de acesso do EchoRoom</h1>
  <p>Abrindo o app do EchoRoom…</p>
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
