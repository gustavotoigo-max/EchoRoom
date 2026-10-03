import type {
  AccessMode,
  AdminOverview,
  AdminRequest,
  AdminRoom,
  AdminUser,
  AdminUserDetail,
  AuditEntry,
} from '@echoroom/shared'
import { AUTH_URL } from './discordAuth'
import { getFirebaseAuth } from './firebase/app'

/** Cliente da API de administração (backend). Envia o token de login do Firebase. */

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

const MESSAGES: Record<string, string> = {
  unauthenticated: 'Entre com Discord para usar o painel.',
  not_admin: 'Sua conta não é administradora.',
  not_configured: 'O backend ainda não está configurado.',
  origin_not_allowed: 'O backend não reconhece este site (ALLOWED_ORIGIN).',
  cannot_suspend_admin: 'Não dá para suspender um administrador.',
  cannot_delete_admin: 'Não dá para apagar um administrador.',
  not_found: 'Não encontrado (talvez já tenha sido removido).',
  user_not_found: 'Essa pessoa não tem cadastro.',
}
export const adminErrorMessage = (err: unknown) =>
  err instanceof AdminApiError ? MESSAGES[err.code] ?? `Erro do backend (${err.code}).` : 'Sem conexão com o backend.'

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new AdminApiError(401, 'unauthenticated')
  const token = await user.getIdToken()
  let res: Response
  try {
    res = await fetch(`${AUTH_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new AdminApiError(0, 'network')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new AdminApiError(res.status, data.error ?? String(res.status))
  return data
}

export const adminApi = {
  me: () => call<{ uid: string; name: string }>('GET', '/admin/me'),
  overview: () => call<AdminOverview>('GET', '/admin/overview'),
  users: () => call<AdminUser[]>('GET', '/admin/users'),
  user: (uid: string) => call<AdminUserDetail>('GET', `/admin/users/${uid}`),
  suspend: (uid: string, reason: string) => call('POST', `/admin/users/${uid}/suspend`, { reason }),
  unsuspend: (uid: string) => call('POST', `/admin/users/${uid}/unsuspend`, {}),
  deleteUser: (uid: string) => call('POST', `/admin/users/${uid}/delete`, {}),
  rooms: () => call<AdminRoom[]>('GET', '/admin/rooms'),
  closeRoom: (roomId: string) => call('POST', `/admin/rooms/${roomId}/close`, {}),
  transferRoom: (roomId: string, uid: string) => call('POST', `/admin/rooms/${roomId}/owner`, { uid }),
  access: () => call<{ mode: AccessMode; requests: AdminRequest[] }>('GET', '/admin/access'),
  setAccess: (mode: AccessMode) => call<{ mode: AccessMode; requests: AdminRequest[] }>('POST', '/admin/access', { mode }),
  decide: (uid: string, approve: boolean) => call('POST', `/admin/requests/${uid}/${approve ? 'approve' : 'deny'}`, {}),
  audit: () => call<AuditEntry[]>('GET', '/admin/audit'),
}
