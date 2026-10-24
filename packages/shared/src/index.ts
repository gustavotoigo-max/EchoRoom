/**
 * Contratos compartilhados entre o site (apps/web) e o backend (apps/api).
 */

/** Claims que o backend coloca no token do Firebase (visíveis nas regras como auth.token.*). */
export const CLAIMS = {
  displayName: 'dn',
  username: 'un',
  avatar: 'av',
  admin: 'adm',
} as const

/** Prefixo do uid das contas antigas, criadas pelo login com Discord. */
export const DISCORD_UID_PREFIX = 'discord_'
/** Prefixo do uid das contas criadas por e-mail (ID interno, independente do provedor). */
export const ACCOUNT_UID_PREFIX = 'acct_'
/** Prefixo das contas criadas pelo login com Google (também começa com acct_). */
export const GOOGLE_UID_PREFIX = 'acct_g_'

/** true para quem tem conta EchoRoom (Discord, e-mail ou Google); o resto é convidado. */
export const isAccountUid = (uid: string | null | undefined) =>
  !!uid && (uid.startsWith(DISCORD_UID_PREFIX) || uid.startsWith(ACCOUNT_UID_PREFIX))

/** Máximo de contas no site (margem abaixo do limite do Google para apps não verificados). */
export const MAX_ACCOUNTS = 90

/** Nome de usuário das contas por e-mail (o Discord usa o mesmo formato). */
export const USERNAME_RE = /^[a-z0-9_.]{2,32}$/

/** Erros que o login pode devolver ao site. */
export type LoginError =
  | 'not_configured'
  | 'origin_not_allowed'
  | 'discord_rejected'
  | 'discord_profile'
  | 'suspended'
  | 'pending'
  | 'bad_request'
  | 'full'
  | 'needs_profile'
  | 'username_taken'
  | 'bad_profile'
  | 'email_unverified'
  | 'unlinked'
  | 'discord_in_use'
  | 'email_in_use'
  | 'google_rejected'
  | 'google_in_use'
  | 'last_method'
  | 'unauthenticated'

/** Formas de entrar numa conta (GET /account). */
export interface AccountMethods {
  discord: { username: string } | null
  email: boolean
  google: { name: string } | null
}

/** Cadastro aberto (qualquer um entra com Discord) ou só com aprovação do admin. */
export type AccessMode = 'open' | 'approval'

/** Contadores diários gravados pelos navegadores em /stats/daily/{data}/{contador} (só +1). */
export const USAGE_COUNTERS = ['adds', 'roomsCreated', 'extension', 'playlistSaves'] as const
export type UsageCounter = (typeof USAGE_COUNTERS)[number]

/** Data no formato das chaves de estatística (UTC). */
export const dayKey = (ms: number = Date.now()) => new Date(ms).toISOString().slice(0, 10)

// ---- API de administração ----------------------------------------------------------

export interface AdminDay {
  date: string
  newUsers: number
  active: number
  activeGuests: number
  roomsCreated: number
  adds: number
  extension: number
  playlistSaves: number
  /** Totais do dia (fotografia tirada pela rotina diária; null antes de existir). */
  usersTotal: number | null
  roomsTotal: number | null
}

export interface AdminOverview {
  generatedAt: number
  access: AccessMode
  totals: {
    users: number
    rooms: number
    suspended: number
    pending: number
  }
  now: {
    roomsActive: number
    peopleOnline: number
    guestsOnline: number
  }
  active: { today: number; week: number; month: number }
  days: AdminDay[]
}

export interface AdminUser {
  uid: string
  name: string
  username: string
  avatar: string
  firstAt: number
  lastLoginAt: number
  logins: number
  lastActiveDay: string | null
  suspended: { at: number; reason: string } | null
  admin: boolean
}

export interface AdminUserDetail extends AdminUser {
  rooms: { roomId: string; name: string; role: 'owner' | 'member' }[]
  playlists: number
}

export interface AdminRoom {
  roomId: string
  name: string
  ownerUid: string | null
  ownerName: string
  createdAt: number
  members: number
  online: number
  allowGuests: boolean
}

export interface AdminRequest {
  uid: string
  name: string
  username: string
  avatar: string
  at: number
}

export interface AuditEntry {
  id: string
  at: number
  by: string
  byName: string
  action: string
  target: string
  detail: string
}
