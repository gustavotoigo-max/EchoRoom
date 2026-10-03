import { describe, expect, it, beforeEach } from 'vitest'
import { generateKeyPairSync, createSign } from 'node:crypto'
import worker from '../src/index'
import type { Env } from '../src/env'

// ---- chaves de teste ---------------------------------------------------------------
const sa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const firebaseKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const SA = {
  project_id: 'echoroom-test',
  client_email: 'svc@echoroom-test.iam.gserviceaccount.com',
  private_key: sa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
}
const ORIGIN = 'https://gustavotoigo-max.github.io'
const ADMIN = 'discord_111111111111111111'
const env: Env = {
  DISCORD_CLIENT_ID: '1234567890123456789',
  DISCORD_CLIENT_SECRET: 's3cret',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA),
  ALLOWED_ORIGIN: ORIGIN,
  ADMIN_UIDS: ADMIN,
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
/** Token de login do Firebase (o que o site manda para a API de admin). */
function idToken(uid: string, opts: { aud?: string; exp?: number } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))
  const body = b64u(
    JSON.stringify({ aud: opts.aud ?? SA.project_id, iss: `https://securetoken.google.com/${opts.aud ?? SA.project_id}`, sub: uid, iat: now, exp: opts.exp ?? now + 3600, dn: 'Gustavo' }),
  )
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(firebaseKeys.privateKey)
  return `${head}.${body}.${b64u(sig)}`
}

// ---- banco falso (REST do Realtime Database) ------------------------------------------
let tree: Record<string, unknown> = {}
const split = (p: string) => p.split('/').filter(Boolean)
function getAt(parts: string[]): unknown {
  let n: unknown = tree
  for (const k of parts) {
    if (!n || typeof n !== 'object') return null
    n = (n as Record<string, unknown>)[k]
  }
  return n ?? null
}
function prune(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v
  const o: Record<string, unknown> = {}
  for (const [k, c] of Object.entries(v)) {
    const p = prune(c)
    if (p !== null && p !== undefined) o[k] = p
  }
  return Object.keys(o).length ? o : null
}
function setAt(parts: string[], v: unknown) {
  if (!parts.length) {
    tree = (prune(v) as Record<string, unknown>) ?? {}
    return
  }
  let n = tree as Record<string, unknown>
  for (const k of parts.slice(0, -1)) {
    if (!n[k] || typeof n[k] !== 'object') n[k] = {}
    n = n[k] as Record<string, unknown>
  }
  n[parts.at(-1)!] = v
  tree = (prune(tree) as Record<string, unknown>) ?? {}
}
let pushN = 0
const discordUser = { id: '222222222222222222', username: 'ana.lima', global_name: 'Ana', avatar: null }

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  const method = init?.method ?? 'GET'
  if (url.hostname === 'discord.com' && url.pathname.endsWith('/oauth2/token')) {
    const body = new URLSearchParams(String(init?.body))
    return body.get('code') === 'ok' ? Response.json({ access_token: 'dtok', token_type: 'Bearer' }) : new Response('no', { status: 400 })
  }
  if (url.hostname === 'discord.com' && url.pathname.endsWith('/users/@me')) return Response.json(discordUser)
  if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'gtok', expires_in: 3600 })
  if (url.hostname === 'www.googleapis.com') {
    const jwk = firebaseKeys.publicKey.export({ format: 'jwk' })
    return Response.json({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }, { headers: { 'Cache-Control': 'max-age=60' } })
  }
  if (url.hostname.endsWith('firebaseio.com')) {
    if (url.searchParams.get('access_token') !== 'gtok') return new Response('401', { status: 401 })
    const parts = split(url.pathname.replace(/\.json$/, ''))
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method === 'GET') {
      const v = getAt(parts)
      if (url.searchParams.get('shallow') && v && typeof v === 'object') return Response.json(Object.fromEntries(Object.keys(v).map((k) => [k, true])))
      if (url.searchParams.get('limitToLast') && v && typeof v === 'object') {
        const n = Number(url.searchParams.get('limitToLast'))
        return Response.json(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).slice(-n)))
      }
      return Response.json(v)
    }
    if (method === 'PUT') setAt(parts, body)
    if (method === 'DELETE') setAt(parts, null)
    if (method === 'PATCH') for (const [k, v] of Object.entries(body)) setAt([...parts, ...split(k)], v)
    if (method === 'POST') {
      const id = `-N${String(++pushN).padStart(6, '0')}`
      setAt([...parts, id], body)
      return Response.json({ name: id })
    }
    return Response.json(body ?? null)
  }
  throw new Error('fetch inesperado: ' + url)
}) as typeof fetch

const call = (method: string, path: string, opts: { body?: unknown; token?: string; origin?: string } = {}) =>
  worker.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers: {
        Origin: opts.origin ?? ORIGIN,
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env,
  )
const loginAs = (code = 'ok') => call('POST', '/discord', { body: { code, redirectUri: `${ORIGIN}/EchoRoom/` } })
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).claims

describe('login', () => {
  beforeEach(() => {
    tree = {}
  })

  it('cria o token do Firebase e registra o cadastro', async () => {
    const res = await loginAs()
    expect(res.status).toBe(200)
    const data = (await res.json()) as { firebaseToken: string }
    expect(claimsOf(data.firebaseToken).dn).toBe('Ana')
    expect(claimsOf(data.firebaseToken).adm).toBe(undefined)
    const rec = getAt(['admin', 'users', 'discord_222222222222222222']) as { logins: number; firstAt: number }
    expect(rec.logins).toBe(1)
    await loginAs()
    expect((getAt(['admin', 'users', 'discord_222222222222222222']) as { logins: number }).logins).toBe(2)
  })

  it('recusa quem está suspenso', async () => {
    setAt(['admin', 'suspended', 'discord_222222222222222222'], { at: 1, reason: 'spam' })
    const res = await loginAs()
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('suspended')
  })

  it('modo aprovação: cria pedido; depois de aprovado, entra', async () => {
    setAt(['admin', 'config'], { access: 'approval' })
    const res = await loginAs()
    expect(((await res.json()) as { error: string }).error).toBe('pending')
    expect(!!getAt(['admin', 'requests', 'discord_222222222222222222'])).toBe(true)
    setAt(['admin', 'approved', 'discord_222222222222222222'], true)
    expect((await loginAs()).status).toBe(200)
  })

  it('recusa origem estranha e code inválido', async () => {
    expect((await call('POST', '/discord', { origin: 'https://evil.com', body: { code: 'ok', redirectUri: `${ORIGIN}/x` } })).status).toBe(403)
    expect((await loginAs('ruim')).status).toBe(401)
  })
})

describe('admin', () => {
  beforeEach(() => {
    tree = {
      admin: {
        users: {
          [ADMIN]: { name: 'Gustavo', username: 'gustoigo', firstAt: Date.now() - 86_400_000 * 3, lastLoginAt: Date.now(), logins: 5 },
          discord_222222222222222222: { name: 'Ana', username: 'ana', firstAt: Date.now(), lastLoginAt: Date.now(), logins: 1 },
        },
      },
      roomIndex: { ABCDE: { createdAt: Date.now(), ownerUid: ADMIN } },
      rooms: {
        ['a'.repeat(64)]: {
          meta: { roomId: 'ABCDE', name: 'Sexta', ownerUid: ADMIN, ownerName: 'Gustavo', createdAt: Date.now() },
          members: { [ADMIN]: { name: 'Gustavo' }, discord_222222222222222222: { name: 'Ana' } },
          participants: { [ADMIN]: { conns: { c1: true } }, guestAAAAAAAAAAAAAAAAAAAAAAAAAA: { conns: { c2: true } } },
          state: { queue: { 0: { title: 'segredo' } } },
        },
      },
      activity: { [new Date().toISOString().slice(0, 10)]: { [ADMIN]: true, guestAAAAAAAAAAAAAAAAAAAAAAAAAA: true } },
      stats: { daily: { [new Date().toISOString().slice(0, 10)]: { adds: 7, extension: 2 } } },
      users: { discord_222222222222222222: { rooms: { ABCDE: { key: 'a'.repeat(64), name: 'Sexta', role: 'member' } } } },
      profiles: { discord_222222222222222222: { name: 'Ana' } },
    }
  })

  it('exige login de admin', async () => {
    expect((await call('GET', '/admin/overview')).status).toBe(401)
    expect((await call('GET', '/admin/overview', { token: idToken('discord_222222222222222222') })).status).toBe(403)
    expect((await call('GET', '/admin/overview', { token: idToken(ADMIN, { aud: 'outro' }) })).status).toBe(401)
    expect((await call('GET', '/admin/overview', { token: idToken(ADMIN, { exp: 10 }) })).status).toBe(401)
    expect((await call('GET', '/admin/overview', { token: idToken(ADMIN) + 'x' })).status).toBe(401)
  })

  it('visão geral sem conteúdo das salas', async () => {
    const res = await call('GET', '/admin/overview', { token: idToken(ADMIN) })
    expect(res.status).toBe(200)
    const o = (await res.json()) as Record<string, any>
    expect(o.totals.users).toBe(2)
    expect(o.totals.rooms).toBe(1)
    expect(o.now.peopleOnline).toBe(2)
    expect(o.now.guestsOnline).toBe(1)
    expect(o.active.today).toBe(1)
    expect(o.days.at(-1).adds).toBe(7)
    expect(o.days.at(-1).activeGuests).toBe(1)
    expect(JSON.stringify(o).includes('segredo')).toBe(false)
  })

  it('pessoas: lista, detalhe, suspender, reativar', async () => {
    const t = idToken(ADMIN)
    const users = (await (await call('GET', '/admin/users', { token: t })).json()) as any[]
    expect(users.length).toBe(2)
    const ana = 'discord_222222222222222222'
    const detail = (await (await call('GET', `/admin/users/${ana}`, { token: t })).json()) as any
    expect(detail.rooms[0].roomId).toBe('ABCDE')
    expect((await call('POST', `/admin/users/${ana}/suspend`, { token: t, body: { reason: 'spam' } })).status).toBe(200)
    expect((getAt(['admin', 'suspended', ana]) as any).reason).toBe('spam')
    expect((await call('POST', `/admin/users/${ADMIN}/suspend`, { token: t, body: {} })).status).toBe(400)
    await call('POST', `/admin/users/${ana}/unsuspend`, { token: t })
    expect(getAt(['admin', 'suspended', ana])).toBe(null)
  })

  it('apagar cadastro remove perfil, salas da lista e presença', async () => {
    const ana = 'discord_222222222222222222'
    await call('POST', `/admin/users/${ana}/delete`, { token: idToken(ADMIN) })
    expect(getAt(['users', ana])).toBe(null)
    expect(getAt(['profiles', ana])).toBe(null)
    expect(getAt(['rooms', 'a'.repeat(64), 'members', ana])).toBe(null)
    expect(!!getAt(['rooms', 'a'.repeat(64), 'members', ADMIN])).toBe(true)
  })

  it('salas: lista (sem fila), trocar dono, encerrar', async () => {
    const t = idToken(ADMIN)
    const rooms = (await (await call('GET', '/admin/rooms', { token: t })).json()) as any[]
    expect(rooms[0].members).toBe(2)
    expect(rooms[0].online).toBe(2)
    expect(JSON.stringify(rooms).includes('segredo')).toBe(false)
    await call('POST', '/admin/rooms/ABCDE/owner', { token: t, body: { uid: 'discord_222222222222222222' } })
    expect((getAt(['rooms', 'a'.repeat(64), 'meta']) as any).ownerName).toBe('Ana')
    await call('POST', '/admin/rooms/ABCDE/close', { token: t })
    expect(getAt(['rooms', 'a'.repeat(64)])).toBe(null)
    expect(getAt(['roomIndex', 'ABCDE'])).toBe(null)
  })

  it('acesso por aprovação e registro de ações', async () => {
    const t = idToken(ADMIN)
    await call('POST', '/admin/access', { token: t, body: { mode: 'approval' } })
    expect((getAt(['admin', 'config']) as any).access).toBe('approval')
    expect(getAt(['admin', 'approved', 'discord_222222222222222222'])).toBe(true) // quem já tinha cadastro continua
    setAt(['admin', 'requests', 'discord_333333333333333333'], { name: 'João', at: 1 })
    const acc = (await (await call('GET', '/admin/access', { token: t })).json()) as any
    expect(acc.requests.length).toBe(1)
    await call('POST', '/admin/requests/discord_333333333333333333/approve', { token: t })
    expect(getAt(['admin', 'approved', 'discord_333333333333333333'])).toBe(true)
    const log = (await (await call('GET', '/admin/audit', { token: t })).json()) as any[]
    expect(log.map((l) => l.action).join(',')).toBe('aprovar acesso,modo de acesso')
  })

  it('rotina diária grava totais e apaga atividade antiga', async () => {
    setAt(['activity', '2020-01-01'], { x: true })
    await worker.scheduled({}, env)
    const today = new Date().toISOString().slice(0, 10)
    expect((getAt(['admin', 'stats', 'daily', today]) as any).usersTotal).toBe(2)
    expect(getAt(['activity', '2020-01-01'])).toBe(null)
  })
})
