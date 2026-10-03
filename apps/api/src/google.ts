import { decodeJwt, signJwt, verifyJwtSignature, type Jwk } from './crypto'
import type { ServiceAccount } from './env'

/**
 * Integração com o Google/Firebase usando a conta de serviço:
 * - token personalizado (login do site)
 * - token de acesso OAuth (backend lendo/escrevendo o banco como administrador)
 * - verificação do token de quem chama a API de administração
 */

const IDENTITY_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SECURETOKEN_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
const DB_SCOPES = 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'

const nowSec = () => Math.floor(Date.now() / 1000)

/** Token para o site entrar no Firebase como `uid`, com claims visíveis nas regras. */
export function createCustomToken(sa: ServiceAccount, uid: string, claims: Record<string, unknown>): Promise<string> {
  const iat = nowSec()
  return signJwt({ iss: sa.client_email, sub: sa.client_email, aud: IDENTITY_AUD, iat, exp: iat + 3600, uid, claims }, sa.private_key)
}

let access: { token: string; exp: number; email: string } | null = null

/** Token OAuth da conta de serviço (acesso total ao banco). Fica em cache até perto de expirar. */
export async function serviceAccessToken(sa: ServiceAccount): Promise<string> {
  if (access && access.email === sa.client_email && access.exp - 120 > nowSec()) return access.token
  const iat = nowSec()
  const assertion = await signJwt(
    { iss: sa.client_email, scope: DB_SCOPES, aud: OAUTH_TOKEN_URL, iat, exp: iat + 3600 },
    sa.private_key,
  )
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`Google OAuth recusou a conta de serviço (${res.status}).`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  access = { token: data.access_token, exp: iat + (data.expires_in || 3600), email: sa.client_email }
  return access.token
}

let jwks: { keys: Jwk[]; exp: number } | null = null

async function publicKeys(): Promise<Jwk[]> {
  if (jwks && jwks.exp > Date.now()) return jwks.keys
  const res = await fetch(SECURETOKEN_JWKS)
  if (!res.ok) throw new Error('Não foi possível obter as chaves públicas do Firebase.')
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 3600)
  jwks = { keys: ((await res.json()) as { keys: Jwk[] }).keys, exp: Date.now() + maxAge * 1000 }
  return jwks.keys
}

/** Confere o token de login (ID token) do Firebase e devolve o uid, ou null. */
export async function verifyIdToken(token: string, projectId: string): Promise<{ uid: string; claims: Record<string, unknown> } | null> {
  try {
    const { header, payload } = decodeJwt(token)
    if (header.alg !== 'RS256') return null
    const key = (await publicKeys()).find((k) => k.kid === header.kid)
    if (!key || !(await verifyJwtSignature(token, key))) return null
    const t = nowSec()
    if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) return null
    if (typeof payload.exp !== 'number' || payload.exp < t) return null
    if (typeof payload.iat !== 'number' || payload.iat > t + 60) return null
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    return { uid: payload.sub, claims: payload }
  } catch {
    return null
  }
}
