/**
 * EchoRoom — serviço de login (Cloudflare Workers, plano gratuito).
 *
 * Recebe o "code" que o Discord devolve ao site, confirma com o Discord
 * (usando o Client Secret, que só existe aqui) e devolve um token do
 * Firebase. Com ele, o Firebase sabe com certeza quem é a pessoa e as
 * regras do banco conseguem proteger dono da sala, perfis e convites.
 *
 * Pede ao Discord só o escopo `identify` (id, nome, usuário e avatar).
 * Nada é guardado aqui.
 *
 * Configuração (Cloudflare → Workers → este worker → Settings → Variables):
 *   DISCORD_CLIENT_ID         (texto)   Client ID do app do Discord
 *   DISCORD_CLIENT_SECRET     (secreto) Client Secret do app do Discord
 *   FIREBASE_SERVICE_ACCOUNT  (secreto) conteúdo do JSON da conta de serviço do Firebase
 *   ALLOWED_ORIGIN            (texto)   ex.: https://gustavotoigo-max.github.io
 */

const DISCORD_API = 'https://discord.com/api/v10'
const FIREBASE_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/') {
      // Página de diagnóstico: mostra o que falta configurar (sem revelar segredos).
      return json({
        ok: true,
        service: 'echoroom-auth',
        configured: {
          DISCORD_CLIENT_ID: !!env.DISCORD_CLIENT_ID,
          DISCORD_CLIENT_SECRET: !!env.DISCORD_CLIENT_SECRET,
          FIREBASE_SERVICE_ACCOUNT: !!readServiceAccount(env),
          ALLOWED_ORIGIN: allowed.length > 0,
        },
      })
    }

    if (request.method !== 'POST' || url.pathname !== '/discord') return json({ error: 'not_found' }, 404)
    if (!allowed.includes(origin)) return json({ error: 'origin_not_allowed' }, 403)

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'bad_request' }, 400)
    }
    const code = typeof body.code === 'string' ? body.code : ''
    const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : ''
    // O endereço de retorno precisa ser do próprio site.
    if (!code || !allowed.some((o) => redirectUri.startsWith(o + '/'))) return json({ error: 'bad_request' }, 400)

    const sa = readServiceAccount(env)
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !sa) return json({ error: 'not_configured' }, 500)

    // 1) Troca o code por um token do Discord.
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })
    if (!tokenRes.ok) return json({ error: 'discord_rejected' }, 401)
    const token = await tokenRes.json()

    // 2) Lê o perfil (escopo identify).
    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `${token.token_type || 'Bearer'} ${token.access_token}` },
    })
    if (!meRes.ok) return json({ error: 'discord_profile' }, 502)
    const me = await meRes.json()

    const profile = {
      id: String(me.id),
      name: String(me.global_name || me.username).slice(0, 32),
      username: String(me.username).slice(0, 32),
      avatarUrl: avatarUrlFor(me),
    }

    // 3) Token do Firebase para o usuário "discord_<id>".
    // As claims (dn, un, av) aparecem nas regras do banco como auth.token.dn etc.
    const firebaseToken = await createCustomToken(sa, `discord_${profile.id}`, {
      dn: profile.name,
      un: profile.username.toLowerCase(),
      av: profile.avatarUrl,
    })

    // O token do Discord não é guardado nem devolvido.
    return json({ firebaseToken, profile })
  },
}

function readServiceAccount(env) {
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '')
    return sa.client_email && sa.private_key ? sa : null
  } catch {
    return null
  }
}

function avatarUrlFor(user) {
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png'
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`
  }
  let index = 0
  try {
    index =
      user.discriminator && user.discriminator !== '0'
        ? Number(user.discriminator) % 5
        : Number((BigInt(user.id) >> 22n) % 6n)
  } catch {
    index = 0
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

// ---- token personalizado do Firebase (JWT RS256 assinado com a conta de serviço) ----

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
const b64urlText = (text) => b64url(new TextEncoder().encode(text))

async function createCustomToken(sa, uid, claims) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: FIREBASE_AUDIENCE,
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  }
  const unsigned = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(payload))}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  return `${unsigned}.${b64url(sig)}`
}
