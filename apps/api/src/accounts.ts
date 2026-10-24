import { ACCOUNT_UID_PREFIX, CLAIMS, DISCORD_UID_PREFIX, isAccountUid, MAX_ACCOUNTS, type AccessMode, type AccountMethods } from '@echoroom/shared'
import type { Db } from './db'
import { adminUids, readServiceAccount, type Env, type ServiceAccount } from './env'
import { createCustomToken, verifyIdToken } from './google'
import { HttpError } from './http'
import type { UserRecord } from './stats'

/**
 * Contas do EchoRoom.
 *
 * O uid do Firebase é o ID interno da conta:
 *   discord_<id>    contas antigas, nascidas do login com Discord
 *   acct_<uid>      contas criadas por e-mail (<uid> = usuário de e-mail no Firebase)
 *
 * Formas de entrar ligadas a outra conta ficam em
 *   /admin/identities/{discord|email}/{id}   uid da conta, ou false (desvinculada)
 * e o que cada conta tem vinculado, em /admin/users/{uid}/links.
 */

export interface AccountRecord extends UserRecord {
  links?: {
    /** Discord vinculado; false = a conta antiga desvinculou o próprio Discord. */
    discord?: { id: string; username: string } | false
    /** Usuário de e-mail do Firebase vinculado; false = desvinculado. */
    email?: { uid: string } | false
  }
}

export type Provider = 'discord' | 'email'

export interface AccountProfile {
  name: string
  username: string
  avatar: string
}

/** Conta a que uma forma de entrar leva (null = nenhuma conta ainda). */
export async function accountFor(db: Db, provider: Provider, id: string): Promise<string | null> {
  const mapped = await db.get<string | false>(`admin/identities/${provider}/${id}`)
  if (mapped === false) throw new HttpError(403, 'unlinked')
  if (typeof mapped === 'string' && isAccountUid(mapped)) return mapped
  return null
}

/** uid padrão de quem entra pela primeira vez por esse caminho. */
export const defaultUid = (provider: Provider, id: string) =>
  provider === 'discord' ? `${DISCORD_UID_PREFIX}${id}` : `${ACCOUNT_UID_PREFIX}${id}`

/** Formas de entrar que a conta tem hoje. */
export function methodsOf(uid: string, rec: AccountRecord | null): AccountMethods {
  const links = rec?.links ?? {}
  const discord =
    links.discord === false
      ? null
      : links.discord
        ? { username: links.discord.username }
        : uid.startsWith(DISCORD_UID_PREFIX)
          ? { username: rec?.username ?? '' }
          : null
  const email = links.email === false ? false : !!links.email || uid.startsWith(ACCOUNT_UID_PREFIX)
  return { discord, email }
}

/**
 * Confere suspensão, modo de acesso e o limite de contas. Conta nova que não
 * cabe vira pedido para o admin (o admin aprova acima do limite).
 */
export async function checkAccess(db: Db, env: Env, uid: string, isNew: boolean, request: AccountProfile): Promise<void> {
  const isAdmin = adminUids(env).includes(uid)
  if (isAdmin) return
  const [suspended, config, approved] = await Promise.all([
    db.get(`admin/suspended/${uid}`),
    db.get<{ access?: AccessMode }>('admin/config'),
    db.get(`admin/approved/${uid}`),
  ])
  if (suspended) throw new HttpError(403, 'suspended')
  if (approved) return
  const ask = async (code: 'pending' | 'full') => {
    await db.set(`admin/requests/${uid}`, { name: request.name, username: request.username, avatar: request.avatar, at: Date.now() })
    throw new HttpError(403, code)
  }
  if (config?.access === 'approval') await ask('pending')
  if (isNew && (await db.keys('admin/users')).length >= MAX_ACCOUNTS) await ask('full')
}

/** Registra o login (cadastro visto no admin) e devolve o registro novo. */
export async function recordLogin(db: Db, uid: string, prev: AccountRecord | null, profile: AccountProfile): Promise<AccountRecord> {
  const now = Date.now()
  const rec: AccountRecord = {
    ...prev,
    name: profile.name,
    username: profile.username,
    avatar: profile.avatar,
    firstAt: prev?.firstAt ?? now,
    lastLoginAt: now,
    logins: (prev?.logins ?? 0) + 1,
  }
  await db.set(`admin/users/${uid}`, rec)
  return rec
}

/** Token do Firebase para a conta, com nome, usuário e avatar visíveis nas regras. */
export function accountToken(env: Env, sa: ServiceAccount, uid: string, profile: AccountProfile): Promise<string> {
  return createCustomToken(sa, uid, {
    [CLAIMS.displayName]: profile.name,
    [CLAIMS.username]: profile.username.toLowerCase(),
    [CLAIMS.avatar]: profile.avatar,
    ...(adminUids(env).includes(uid) ? { [CLAIMS.admin]: true } : {}),
  })
}

/** Quem está chamando (token de login do Firebase no cabeçalho Authorization), já com conta. */
export async function caller(request: Request, env: Env): Promise<{ uid: string; sa: ServiceAccount }> {
  const sa = readServiceAccount(env)
  if (!sa) throw new HttpError(500, 'not_configured')
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  const who = token ? await verifyIdToken(token, sa.project_id) : null
  if (!who || !isAccountUid(who.uid)) throw new HttpError(401, 'unauthenticated')
  return { uid: who.uid, sa }
}

/** Avatar padrão das contas por e-mail: a inicial do nome num quadrado colorido (SVG embutido). */
export function initialAvatar(name: string, seed: string): string {
  const colors = ['#7c5cff', '#4c8dff', '#2fb8a5', '#e0569b', '#e08a2f', '#5a9e3a']
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const letter = (name.trim()[0] ?? '?').toUpperCase().replace(/[<>&"']/g, '?')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${colors[h % colors.length]}"/><text x="32" y="42" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
